import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SessionProfile = {
  id: string;
  full_name: string;
  email: string;
  role: "admin" | "usuario" | string;
  is_active: boolean;
};

/**
 * Garante que exista um registro em `profiles` para o usuário autenticado
 * (id = auth.users.id) e devolve o papel/status usado no controle de acesso.
 */
export const ensureProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SessionProfile> => {
    const { supabase, userId } = context;

    const { data: existing, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, is_active")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (existing) return existing as SessionProfile;

    // Perfil ausente (conta criada fora do fluxo do Admin): reconcilia no 1º acesso.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
    const email = authUser.user?.email ?? "";
    const meta = (authUser.user?.user_metadata ?? {}) as Record<string, unknown>;
    const fullName =
      typeof meta["full_name"] === "string" && meta["full_name"].trim().length > 0
        ? (meta["full_name"] as string)
        : email.split("@")[0] || "Usuário";

    const { count } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true });
    const role = (count ?? 0) === 0 ? "admin" : "usuario";

    const { data: created, error: upsertError } = await supabaseAdmin
      .from("profiles")
      .upsert(
        { id: userId, full_name: fullName, email, role, is_active: true },
        { onConflict: "id" },
      )
      .select("id, full_name, email, role, is_active")
      .single();
    if (upsertError) throw new Error(upsertError.message);

    return created as SessionProfile;
  });
