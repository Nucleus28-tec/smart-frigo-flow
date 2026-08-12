import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useProfile";
import { createTeamUser, updateTeamUser } from "@/lib/users.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/PageState";
import { formatDateTime, roleLabel } from "@/lib/rotta";

export const Route = createFileRoute("/_authenticated/usuarios")({
  component: UsuariosPage,
  head: () => ({
    meta: [
      { title: "Usuários | Rotta Financeiro" },
      {
        name: "description",
        content:
          "Administração da equipe interna: criação de acessos, definição de papéis e ativação de usuários.",
      },
      { property: "og:title", content: "Usuários | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Administração de acessos e papéis no Rotta Financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function UsuariosPage() {
  const { data: profile, isLoading: loadingProfile } = useProfile();
  const queryClient = useQueryClient();
  const create = useServerFn(createTeamUser);
  const update = useServerFn(updateTeamUser);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    role: "usuario" as "admin" | "usuario",
  });

  const users = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role, is_active, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const createMutation = useMutation({
    mutationFn: () => create({ data: form }),
    onSuccess: () => {
      toast.success("Usuário criado");
      setOpen(false);
      setForm({ full_name: "", email: "", password: "", role: "usuario" });
      void queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (e: Error) => toast.error("Erro ao criar usuário", { description: e.message }),
  });

  const updateMutation = useMutation({
    mutationFn: (input: { user_id: string; role?: "admin" | "usuario"; is_active?: boolean }) =>
      update({ data: input }),
    onSuccess: () => {
      toast.success("Usuário atualizado");
      void queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (e: Error) => toast.error("Erro ao atualizar", { description: e.message }),
  });

  if (loadingProfile) return <LoadingRows rows={4} />;

  if (profile?.role !== "admin") {
    return (
      <>
        <PageHeader title="Usuários" />
        <EmptyState
          title="Acesso restrito"
          description="Somente administradores podem gerenciar os usuários do sistema."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Usuários"
        description="Equipe interna com acesso ao ERP. Não existe autocadastro."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>Novo usuário</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo usuário</DialogTitle>
                <DialogDescription>
                  O acesso é criado já confirmado. Compartilhe a senha inicial com segurança.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="full_name">Nome completo</Label>
                  <Input
                    id="full_name"
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-email">E-mail</Label>
                  <Input
                    id="new-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">Senha inicial</Label>
                  <Input
                    id="new-password"
                    type="text"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="Mínimo de 8 caracteres"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Papel</Label>
                  <Select
                    value={form.role}
                    onValueChange={(role) =>
                      setForm({ ...form, role: role as "admin" | "usuario" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="usuario">Usuário</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => createMutation.mutate()}
                  disabled={
                    createMutation.isPending ||
                    !form.full_name ||
                    !form.email ||
                    form.password.length < 8
                  }
                >
                  {createMutation.isPending ? "Criando…" : "Criar usuário"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {users.isLoading ? (
        <LoadingRows />
      ) : users.isError ? (
        <ErrorState
          message={(users.error as Error)?.message}
          onRetry={() => void users.refetch()}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Criado em</TableHead>
                  <TableHead className="text-right">Ativo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.data!.map((user) => {
                  const isSelf = user.id === profile.id;
                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">
                        {user.full_name}
                        {isSelf ? (
                          <Badge variant="secondary" className="ml-2">
                            Você
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{user.email}</TableCell>
                      <TableCell>
                        <Select
                          value={user.role}
                          disabled={isSelf || updateMutation.isPending}
                          onValueChange={(role) =>
                            updateMutation.mutate({
                              user_id: user.id,
                              role: role as "admin" | "usuario",
                            })
                          }
                        >
                          <SelectTrigger className="w-[140px]">
                            <SelectValue>{roleLabel(user.role)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="usuario">Usuário</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(user.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Switch
                          checked={user.is_active}
                          disabled={isSelf || updateMutation.isPending}
                          onCheckedChange={(checked) =>
                            updateMutation.mutate({ user_id: user.id, is_active: checked })
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
