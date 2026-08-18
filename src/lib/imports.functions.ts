import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const FILE_TYPES = [
  "balancete",
  "pedido_compra",
  "nota_fiscal",
  "romaneio_abate",
  "contas_pagar",
  "contas_receber",
  "relatorio_vendas",
  "extrato_sicoob",
] as const;

const uploadSchema = z.object({
  period_id: z.string().uuid(),
  file_type: z.enum(FILE_TYPES),
  original_name: z.string().min(1).max(200),
});

const registerSchema = z.object({
  period_id: z.string().uuid(),
  file_type: z.enum(FILE_TYPES),
  original_name: z.string().min(1).max(200),
  storage_path: z.string().min(1),
  mime_type: z.string().min(1).max(200),
});

const fileIdSchema = z.object({ file_id: z.string().uuid() });

function sanitizeName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(-120);
}

export const createUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => uploadSchema.parse(input))
  .handler(async ({ data, context }) => {
    const path = `periodo/${data.period_id}/${data.file_type}/${Date.now()}-${sanitizeName(
      data.original_name,
    )}`;
    const { data: signed, error } = await context.supabase.storage
      .from("imports")
      .createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    return { path: signed.path, token: signed.token };
  });

export const registerImportedFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => registerSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("imported_files")
      .insert({
        period_id: data.period_id,
        file_type: data.file_type,
        original_name: data.original_name,
        storage_path: data.storage_path,
        mime_type: data.mime_type,
        processing_status: "pendente",
        uploaded_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.rpc("log_activity", {
      _action: "importou arquivo",
      _entity_type: "imported_files",
      _entity_id: row.id,
      _metadata: { file_type: data.file_type, original_name: data.original_name },
    });
    return { file_id: row.id };
  });

/** Cliente de serviço quando disponível; caso contrário, null (usamos a sessão do usuário). */
async function tryAdmin(): Promise<null | Record<string, never>> {
  try {
    const mod = await import("@/integrations/supabase/client.server");
    // Toca o proxy para forçar a validação das variáveis de ambiente.
    void mod.supabaseAdmin.storage;
    return mod.supabaseAdmin as unknown as Record<string, never>;
  } catch {
    return null;
  }
}

function friendly(message: string) {
  if (/SUPABASE_SERVICE_ROLE_KEY|Missing Supabase environment/i.test(message)) {
    return "A credencial de serviço do Supabase não está configurada neste ambiente. A ação foi executada com a sua sessão quando possível.";
  }
  if (/not found|does not exist|Object not found/i.test(message)) {
    return "Arquivo não encontrado no armazenamento.";
  }
  if (/permission|denied|row-level security|violates/i.test(message)) {
    return "Você não tem permissão para esta ação.";
  }
  return message;
}

export const getFileDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => fileIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: file, error } = await context.supabase
      .from("imported_files")
      .select("storage_path")
      .eq("id", data.file_id)
      .single();
    if (error) throw new Error(friendly(error.message));
    const { data: signed, error: signError } = await context.supabase.storage
      .from("imports")
      .createSignedUrl(file.storage_path, 60 * 10);
    if (signError || !signed?.signedUrl) {
      throw new Error(friendly(signError?.message ?? "Não foi possível gerar o link do arquivo."));
    }
    return { url: signed.signedUrl };
  });

export const deleteImportedFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => fileIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_admin");
    if (isAdmin !== true) throw new Error("Apenas administradores podem excluir arquivos.");

    const { data: file, error } = await context.supabase
      .from("imported_files")
      .select("storage_path, original_name")
      .eq("id", data.file_id)
      .single();
    if (error) throw new Error(friendly(error.message));

    // Limpa dependências do arquivo antes de remover o registro.
    await context.supabase.from("ledger_entries").delete().eq("file_id", data.file_id);
    await context.supabase.from("journal_legs").delete().eq("file_id", data.file_id);
    await context.supabase.from("trial_balance_lines").delete().eq("file_id", data.file_id);

    let storageRemoved = true;
    try {
      const admin = await tryAdmin();
      const client = (admin ?? context.supabase) as typeof context.supabase;
      const { error: storageError } = await client.storage
        .from("imports")
        .remove([file.storage_path]);
      if (storageError) storageRemoved = false;
    } catch {
      storageRemoved = false;
    }

    const { error: deleteError } = await context.supabase
      .from("imported_files")
      .delete()
      .eq("id", data.file_id);
    if (deleteError) throw new Error(friendly(deleteError.message));

    await context.supabase.rpc("log_activity", {
      _action: "excluiu arquivo importado",
      _entity_type: "imported_files",
      _entity_id: data.file_id,
      _metadata: { original_name: file.original_name, storage_removed: storageRemoved },
    });
    return { ok: true, storageRemoved };
  });


/** Equivalente à Edge Function "parse-imported-file": baixa, interpreta e grava os lançamentos. */
export const parseImportedFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => fileIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await tryAdmin();
    const supabaseAdmin = (admin ?? context.supabase) as typeof context.supabase;
    const { parseSpreadsheet, parsePdfWithAi } = await import("@/lib/imports.server");

    const { data: file, error } = await supabaseAdmin
      .from("imported_files")
      .select("id, period_id, file_type, original_name, storage_path, mime_type")
      .eq("id", data.file_id)
      .single();
    if (error) throw new Error(friendly(error.message));

    await supabaseAdmin
      .from("imported_files")
      .update({ processing_status: "processando", processing_error: null })
      .eq("id", file.id);

    try {
      const { data: blob, error: downloadError } = await supabaseAdmin.storage
        .from("imports")
        .download(file.storage_path);
      if (downloadError || !blob) throw new Error("Não foi possível baixar o arquivo do storage.");
      const bytes = await blob.arrayBuffer();
      if (!bytes.byteLength) throw new Error("Arquivo vazio.");

      const isPdf =
        file.mime_type.includes("pdf") || file.original_name.toLowerCase().endsWith(".pdf");

      if (file.file_type !== "balancete") {
        await supabaseAdmin
          .from("imported_files")
          .update({
            processing_status: "processado",
            processing_error:
              "Arquivo armazenado. A leitura automática deste tipo entra nas próximas etapas.",
          })
          .eq("id", file.id);
        return { entries: 0, status: "processado" as const };
      }

      const entries = isPdf
        ? await parsePdfWithAi(bytes, file.original_name, file.mime_type || "application/pdf")
        : parseSpreadsheet(bytes);

      if (!entries.length) {
        throw new Error(
          "Nenhum lançamento reconhecido no arquivo. Confira se é o balancete exportado do G2.",
        );
      }

      // Reprocessamento faz merge: preserva edições manuais e registra os diffs.
      const payload = entries.map((entry) => ({
        source_account_name: entry.source_account_name,
        raw_value: entry.raw_value,
        entry_date: entry.entry_date,
      }));

      const { data: mergeResult, error: mergeError } = await (
        supabaseAdmin as unknown as {
          rpc: (
            name: string,
            args: Record<string, unknown>,
          ) => Promise<{ data: unknown; error: { message: string } | null }>;
        }
      ).rpc("merge_file_entries", { _file_id: file.id, _entries: payload });
      if (mergeError) throw new Error(mergeError.message);

      const merge = (mergeResult ?? {}) as {
        inserted?: number;
        updated?: number;
        removed?: number;
        manual_preserved?: number;
        first_import?: boolean;
        total?: number;
      };

      // Alimenta o plano de contas com as contas do arquivo e vincula os lançamentos.
      const { syncAccountsForPeriod } = await import("@/lib/ledger.server");
      await syncAccountsForPeriod(context.supabase as never, file.period_id);

      await supabaseAdmin
        .from("imported_files")
        .update({ processing_status: "processado", processing_error: null })
        .eq("id", file.id);

      await context.supabase.rpc("log_activity", {
        _action: merge.first_import ? "processou arquivo importado" : "reprocessou arquivo (recálculo)",
        _entity_type: "imported_files",
        _entity_id: file.id,
        _metadata: {
          entries: merge.total ?? payload.length,
          original_name: file.original_name,
          inserted: merge.inserted ?? 0,
          updated: merge.updated ?? 0,
          removed: merge.removed ?? 0,
          manual_preserved: merge.manual_preserved ?? 0,
        },
      });

      return {
        entries: merge.total ?? payload.length,
        status: "processado" as const,
        inserted: merge.inserted ?? 0,
        updated: merge.updated ?? 0,
        removed: merge.removed ?? 0,
        manualPreserved: merge.manual_preserved ?? 0,
        firstImport: merge.first_import ?? true,
      };
    } catch (e) {
      const message = friendly(
        e instanceof Error ? e.message : "Erro desconhecido ao processar o arquivo.",
      );
      await supabaseAdmin
        .from("imported_files")
        .update({ processing_status: "erro", processing_error: message.slice(0, 500) })
        .eq("id", file.id);
      throw new Error(message);
    }
  });
