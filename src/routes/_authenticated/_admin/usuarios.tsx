import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useProfile } from "@/hooks/useProfile";
import { createTeamUser, resendInvite, updateTeamUser } from "@/lib/users.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

export const Route = createFileRoute("/_authenticated/_admin/usuarios")({
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

type TeamUser = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
};

function UsuariosPage() {
  const { data: profile, isLoading: loadingProfile } = useProfile();
  const queryClient = useQueryClient();
  const create = useServerFn(createTeamUser);
  const update = useServerFn(updateTeamUser);
  const invite = useServerFn(resendInvite);

  const [open, setOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState<{ email: string; link: string } | null>(null);
  const [toDeactivate, setToDeactivate] = useState<TeamUser | null>(null);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    role: "usuario" as "admin" | "usuario",
  });

  const users = useQuery({
    queryKey: ["profiles"],
    queryFn: async (): Promise<TeamUser[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role, is_active, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TeamUser[];
    },
  });

  const createMutation = useMutation({
    mutationFn: () => create({ data: { ...form, origin: window.location.origin } }),
    onSuccess: (result) => {
      toast.success("Usuário criado");
      setInviteLink({ email: form.email, link: result.invite_link });
      setOpen(false);
      setForm({ full_name: "", email: "", role: "usuario" });
      void queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (e: Error) => toast.error("Erro ao criar usuário", { description: e.message }),
  });

  const inviteMutation = useMutation({
    mutationFn: (user: TeamUser) =>
      invite({ data: { user_id: user.id, origin: window.location.origin } }).then((r) => ({
        email: user.email,
        link: r.invite_link,
      })),
    onSuccess: (result) => {
      setInviteLink(result);
      toast.success("Novo link de convite gerado");
    },
    onError: (e: Error) => toast.error("Erro ao gerar convite", { description: e.message }),
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

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copiado");
    } catch {
      toast.error("Não foi possível copiar. Selecione o link manualmente.");
    }
  }

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
                  O acesso é criado sem senha. Ao salvar, um link de convite é gerado para o
                  usuário definir a própria senha.
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
                  disabled={createMutation.isPending || !form.full_name || !form.email}
                >
                  {createMutation.isPending ? "Criando…" : "Criar e gerar convite"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {inviteLink ? (
        <Card className="mb-6 border-primary/40">
          <CardContent className="space-y-3 p-4">
            <div>
              <p className="text-sm font-medium">Link de convite para {inviteLink.email}</p>
              <p className="text-xs text-muted-foreground">
                Envie por um canal seguro. O link permite definir a senha e expira conforme a
                política do provedor de autenticação.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input readOnly value={inviteLink.link} className="font-mono text-xs" />
              <div className="flex gap-2">
                <Button onClick={() => void copyLink(inviteLink.link)}>Copiar</Button>
                <Button variant="ghost" onClick={() => setInviteLink(null)}>
                  Fechar
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {users.isLoading ? (
        <LoadingRows />
      ) : users.isError ? (
        <ErrorState
          message={(users.error as Error)?.message}
          onRetry={() => void users.refetch()}
        />
      ) : (users.data ?? []).length === 0 ? (
        <EmptyState
          title="Nenhum usuário cadastrado"
          description="Use “Novo usuário” para criar o primeiro acesso da equipe e gerar o link de convite."
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
                  <TableHead>Status</TableHead>
                  <TableHead>Criado em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
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
                      <TableCell>
                        <Badge variant={user.is_active ? "secondary" : "outline"}>
                          {user.is_active ? "Ativo" : "Desativado"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(user.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!user.is_active || inviteMutation.isPending}
                            onClick={() => inviteMutation.mutate(user)}
                          >
                            Reenviar convite
                          </Button>
                          <Switch
                            aria-label={`Ativar ${user.full_name}`}
                            checked={user.is_active}
                            disabled={isSelf || updateMutation.isPending}
                            onCheckedChange={(checked) => {
                              if (!checked) setToDeactivate(user);
                              else updateMutation.mutate({ user_id: user.id, is_active: true });
                            }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={toDeactivate !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setToDeactivate(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar acesso?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDeactivate?.full_name} perderá o acesso ao sistema imediatamente. O histórico de
              atividades é preservado e o acesso pode ser reativado depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toDeactivate) {
                  updateMutation.mutate({ user_id: toDeactivate.id, is_active: false });
                }
                setToDeactivate(null);
              }}
            >
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
