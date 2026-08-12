import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/definir-senha")({
  ssr: false,
  component: DefinirSenhaPage,
  head: () => ({
    meta: [
      { title: "Definir senha | Rotta Financeiro" },
      {
        name: "description",
        content:
          "Defina a senha de acesso da sua conta interna no Rotta Financeiro, o ERP financeiro da Rota Alimentos.",
      },
      { property: "og:title", content: "Definir senha | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Conclua seu convite definindo a senha de acesso ao Rotta Financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function DefinirSenhaPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active || !session) return;
      setHasSession(true);
      setReady(true);
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setHasSession(Boolean(data.session));
      setReady(true);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("A senha precisa ter ao menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      toast.error("As senhas não conferem.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error("Não foi possível definir a senha", { description: error.message });
      return;
    }
    toast.success("Senha definida com sucesso");
    navigate({ to: "/dashboard", replace: true });
  }

  if (!ready) return null;

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
            <CardTitle>Definir senha</CardTitle>
            <CardDescription>
              {hasSession
                ? "Escolha a senha que você usará para entrar no sistema."
                : "Este link de convite expirou ou já foi usado."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasSession ? (
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="password">Nova senha</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo de 8 caracteres"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirmar senha</Label>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Salvando…" : "Salvar senha e entrar"}
                </Button>
              </form>
            ) : (
              <Button className="w-full" onClick={() => navigate({ to: "/login" })}>
                Ir para o login
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
