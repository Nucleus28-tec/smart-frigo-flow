import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { ensureProfile } from "@/lib/session.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  ssr: false,
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "Entrar | Rotta Financeiro" },
      {
        name: "description",
        content:
          "Acesso restrito à equipe financeira e contábil do ERP Financeiro Inteligente para frigoríficos.",
      },
      { property: "og:title", content: "Entrar | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Acesso restrito à equipe financeira e contábil do Rotta Financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
      else setChecking(false);
    });
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setLoading(false);
      toast.error("Não foi possível entrar", { description: error.message });
      return;
    }

    try {
      const profile = await ensureProfile();
      if (!profile.is_active) {
        await supabase.auth.signOut();
        setLoading(false);
        toast.error("Acesso desativado", {
          description: "Acesso desativado. Fale com o administrador.",
        });
        return;
      }
    } catch (err) {
      await supabase.auth.signOut();
      setLoading(false);
      toast.error("Não foi possível validar seu acesso", {
        description: err instanceof Error ? err.message : "Tente novamente.",
      });
      return;
    }

    setLoading(false);
    navigate({ to: "/dashboard", replace: true });
  }

  if (checking) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-sidebar-foreground">
            Rotta Financeiro
          </h1>
          <p className="mt-1 text-sm text-sidebar-foreground/60">
            ERP Financeiro Inteligente · Rota Alimentos
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Entrar</CardTitle>
            <CardDescription>Acesso restrito à equipe interna.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="voce@rotaalimentos.com.br"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Entrando…" : "Entrar"}
              </Button>
            </form>
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Não há autocadastro. Solicite acesso ao administrador do sistema.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
