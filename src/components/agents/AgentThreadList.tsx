import { Link } from "@tanstack/react-router";
import { Calculator, LineChart, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentKey } from "@/lib/agents/personas";

export type ThreadRow = {
  id: string;
  agent: string;
  title: string;
  period_id: string | null;
  updated_at: string;
};

type Props = {
  threads: ThreadRow[];
  activeId?: string;
  creating: boolean;
  onCreate: (agent: AgentKey) => void;
  onDelete: (id: string) => void;
};

export function AgentThreadList({ threads, activeId, creating, onCreate, onDelete }: Props) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={creating}
          onClick={() => onCreate("contador")}
          className="justify-start"
        >
          <Calculator className="mr-1.5 size-4 text-brand" />
          Contador
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={creating}
          onClick={() => onCreate("cfo")}
          className="justify-start"
        >
          <LineChart className="mr-1.5 size-4 text-brand" />
          CFO
        </Button>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Plus className="size-3" /> Escolha um agente para iniciar uma conversa
      </p>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {threads.map((thread) => (
          <div
            key={thread.id}
            className={cn(
              "group flex items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-sm transition-all",
              thread.id === activeId
                ? "border-[var(--glow-border)] bg-accent"
                : "hover:border-[var(--glow-border)] hover:bg-accent/60 hover:shadow-[var(--glow-soft)]",
            )}
          >
            <Link
              to="/agentes/$threadId"
              params={{ threadId: thread.id }}
              className="min-w-0 flex-1"
            >
              <span className="block truncate">{thread.title}</span>
              <span className="block text-xs text-muted-foreground">
                {thread.agent === "cfo" ? "Agente CFO" : "Agente Contador"}
              </span>
            </Link>
            <button
              type="button"
              aria-label="Excluir conversa"
              onClick={() => onDelete(thread.id)}
              className="opacity-0 transition-opacity group-hover:opacity-100"
            >
              <Trash2 className="size-4 text-muted-foreground hover:text-destructive" />
            </button>
          </div>
        ))}
        {threads.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            Nenhuma conversa ainda.
          </p>
        ) : null}
      </div>
    </div>
  );
}
