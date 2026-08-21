/**
 * Popover de comentários de um lançamento — histórico com autor e data.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { addLegComment, listLegComments } from "@/lib/razao.functions";
import { formatDateTime } from "@/lib/rotta";

export function ComentariosLancamento({
  legId,
  periodId,
  count,
}: {
  legId: string;
  periodId: string;
  count: number;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const queryClient = useQueryClient();
  const runList = useServerFn(listLegComments);
  const runAdd = useServerFn(addLegComment);

  const comments = useQuery({
    queryKey: ["leg_comments", legId],
    enabled: open,
    queryFn: async () => runList({ data: { leg_id: legId } }),
  });

  const add = useMutation({
    mutationFn: async () => {
      const text = body.trim();
      if (!text) throw new Error("Escreva um comentário.");
      return runAdd({ data: { leg_id: legId, period_id: periodId, body: text } });
    },
    onSuccess: () => {
      setBody("");
      void queryClient.invalidateQueries({ queryKey: ["leg_comments", legId] });
      void queryClient.invalidateQueries({ queryKey: ["line_legs"] });
      toast.success("Comentário registrado.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          title="Comentários do lançamento"
        >
          <MessageSquare className="size-3.5" />
          {count > 0 ? count : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <p className="text-sm font-medium">Comentários</p>
        <div className="max-h-52 space-y-2 overflow-auto">
          {comments.isLoading ? (
            <p className="text-xs text-muted-foreground">Carregando...</p>
          ) : (comments.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum comentário ainda.</p>
          ) : (
            (comments.data ?? []).map((c) => (
              <div key={c.id} className="rounded-md border border-border bg-card px-2 py-1.5">
                <p className="text-xs text-muted-foreground">
                  {c.author_name} · {formatDateTime(c.created_at)}
                </p>
                <p className="whitespace-pre-wrap text-sm">{c.body}</p>
              </div>
            ))
          )}
        </div>
        <Textarea
          rows={3}
          value={body}
          placeholder="Escreva um comentário sobre este lançamento..."
          onChange={(e) => setBody(e.target.value)}
        />
        <Button size="sm" className="w-full" onClick={() => add.mutate()} disabled={add.isPending}>
          {add.isPending ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : null}
          Comentar
        </Button>
      </PopoverContent>
    </Popover>
  );
}
