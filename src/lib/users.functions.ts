import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(2),
  role: z.enum(["admin", "usuario"]),
});

const updateSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(["admin", "usuario"]).optional(),
  is_active: z.boolean().optional(),
});

async function assertAdmin(supabase: {
  rpc: (name: "is_admin") => Promise<{ data: unknown; error: unknown }>;
}) {
  const { data, error } = await supabase.rpc("is_admin");
  if (error || data !== true) throw new Error("Acesso restrito a administradores.");
}

export const createTeamUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name, role: data.role },
    });
    if (error) throw new Error(error.message);

    const userId = created.user?.id;
    if (userId) {
      await supabaseAdmin
        .from("profiles")
        .upsert(
          {
            id: userId,
            full_name: data.full_name,
            email: data.email,
            role: data.role,
            is_active: true,
          },
          { onConflict: "id" },
        );
    }

    await context.supabase.rpc("log_activity", {
      _action: "criou usuário",
      _entity_type: "profiles",
      _entity_id: userId ?? null,
      _metadata: { email: data.email, role: data.role },
    });

    return { id: userId };
  });

export const updateTeamUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const patch: { role?: string; is_active?: boolean } = {};
    if (data.role !== undefined) patch.role = data.role;
    if (data.is_active !== undefined) patch.is_active = data.is_active;
    if (Object.keys(patch).length === 0) return { ok: true };

    if (data.user_id === context.userId && patch.role === "usuario") {
      throw new Error("Você não pode remover o próprio acesso de administrador.");
    }
    if (data.user_id === context.userId && patch.is_active === false) {
      throw new Error("Você não pode desativar o próprio usuário.");
    }

    const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", data.user_id);
    if (error) throw new Error(error.message);

    await context.supabase.rpc("log_activity", {
      _action: "atualizou usuário",
      _entity_type: "profiles",
      _entity_id: data.user_id,
      _metadata: patch,
    });

    return { ok: true };
  });
