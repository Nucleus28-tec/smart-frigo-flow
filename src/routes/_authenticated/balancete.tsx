/**
 * /balancete — balancete derivado do razão (somente leitura).
 * Saldo anterior + débito − crédito por conta, agrupado por natureza,
 * com conferência Ativo × Passivo+PL. Correções só por lançamento de ajuste.
 */
import { Fragment, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, PlusCircle } from "lucide-react";

import { usePeriod } from "@/hooks/usePeriod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import { SemMovimento } from "@/components/periodo/SemMovimento";
import { usePeriodStatus } from "@/hooks/usePeriodStatus";
import { NATURE_LABEL, NATURE_OPTIONS, formatCurrency } from "@/lib/rotta";
import { ConferenciaBalanco } from "@/components/ConferenciaBalanco";
import { useConferencia, type SaldoConta } from "@/lib/conferencia";
import {
  LancamentoAjusteDialog,
  type AjusteContexto,
} from "@/components/razao/LancamentoAjusteDialog";

export const Route = createFileRoute("/_authenticated/balancete")({
  component: BalancetePage,
  head: () => ({
    meta: [
      { title: "Balancete | Rotta Financeiro" },
      {
        name: "description",
        content:
          "Balancete gerado a partir do razão contábil: saldo anterior, débito, crédito e saldo atual por conta, com conferência Ativo × Passivo+PL.",
      },
      { property: "og:title", content: "Balancete | Rotta Financeiro" },
      {
        property: "og:description",
        content: "Balancete derivado do razão contábil do período no Rotta Financeiro.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const GRUPOS: { key: string; label: string; naturezas: string[] }[] = [
  {
    key: "ativo",
    label: "Ativo",
    naturezas: ["ativo_circulante", "ativo_nao_circulante"],
  },
  {
    key: "passivo_pl",
    label: "Passivo e Patrimônio Líquido",
    naturezas: ["passivo_circulante", "passivo_nao_circulante", "patrimonio_liquido"],
  },
  {
    key: "resultado",
    label: "Resultado",
    naturezas: ["receita", "custo", "despesa"],
  },
];

const CREDORAS = new Set([
  "passivo_circulante",
  "passivo_nao_circulante",
  "patrimonio_liquido",
  "receita",
]);

type Secao = {
  nature: string;
  label: string;
  contas: SaldoConta[];
  anterior: number;
  debito: number;
  credito: number;
  saldo: number;
};

function somar(contas: SaldoConta[]) {
  return contas.reduce(
    (acc, c) => ({
      anterior: acc.anterior + c.opening_balance,
      debito: acc.debito + c.debit_mov,
      credito: acc.credito + c.credit_mov,
      saldo: acc.saldo + c.closing_balance,
    }),
    { anterior: 0, debito: 0, credito: 0, saldo: 0 },
  );
}

/** Saldo com sinal contábil de leitura: contas credoras aparecem positivas. */
function sinal(nature: string | null, value: number) {
  return nature && CREDORAS.has(nature) ? -value : value;
}

function BalancetePage() {
  const { selectedPeriod, selectedPeriodId } = usePeriod();
  const periodStatus = usePeriodStatus(selectedPeriodId);
  const conferencia = useConferencia(selectedPeriodId);

  const [search, setSearch] = useState("");
  const [natureFilter, setNatureFilter] = useState("todas");
  const [onlyMoved, setOnlyMoved] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [ajuste, setAjuste] = useState<AjusteContexto | null>(null);

  const isClosed = selectedPeriod?.status === "fechado";
  const monthStart = selectedPeriod?.reference_month
    ? `${selectedPeriod.reference_month.slice(0, 8)}01`
    : new Date().toISOString().slice(0, 10);

  const contas = conferencia.data?.contas ?? [];

  const filtradas = useMemo(() => {
    const term = search.trim().toLowerCase();
    return contas.filter((c) => {
      if (term && !`${c.reduced_code} ${c.account_name}`.toLowerCase().includes(term)) return false;
      if (natureFilter === "sem_natureza" && c.nature) return false;
      if (natureFilter !== "todas" && natureFilter !== "sem_natureza" && c.nature !== natureFilter)
        return false;
      if (onlyMoved && c.debit_mov === 0 && c.credit_mov === 0) return false;
      return true;
    });
  }, [contas, search, natureFilter, onlyMoved]);

  const secoes = useMemo<Map<string, Secao>>(() => {
    const map = new Map<string, Secao>();
    for (const nature of [...NATURE_OPTIONS, "sem_natureza"]) {
      const lista = filtradas
        .filter((c) => (c.nature ?? "sem_natureza") === nature)
        .sort((a, b) =>
          a.reduced_code.localeCompare(b.reduced_code, "pt-BR", { numeric: true }),
        );
      if (!lista.length) continue;
      const totais = somar(lista);
      map.set(nature, {
        nature,
        label: NATURE_LABEL[nature] ?? "Contas sem natureza",
        contas: lista,
        ...totais,
      });
    }
    return map;
  }, [filtradas]);

  const totaisGrupo = useMemo(() => {
    const total = (naturezas: string[]) =>
      naturezas.reduce((acc, n) => acc + sinal(n, secoes.get(n)?.saldo ?? 0), 0);
    const movimento = (nature: string) => {
      const s = secoes.get(nature);
      if (!s) return 0;
      return CREDORAS.has(nature) ? s.credito - s.debito : s.debito - s.credito;
    };
    const receita = movimento("receita");
    const custo = movimento("custo");
    const despesa = movimento("despesa");
    return {
      ativo: total(["ativo_circulante", "ativo_nao_circulante"]),
      passivoPl: total([
        "passivo_circulante",
        "passivo_nao_circulante",
        "patrimonio_liquido",
      ]),
      receita,
      custo,
      despesa,
      lucroBruto: receita - custo,
      resultado: receita - custo - despesa,
    };
  }, [secoes]);

  const semNatureza = secoes.get("sem_natureza");
  const filtroAtivo = Boolean(search.trim()) || natureFilter !== "todas" || onlyMoved;

  function toggle(nature: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(nature)) next.delete(nature);
      else next.add(nature);
      return next;
    });
  }

  if (!selectedPeriodId) {
    return (
      <>
        <PageHeader
          title="Balancete"
          description="Balancete gerado a partir do razão contábil do período."
        />
        <EmptyState
          title="Selecione um período"
          description="Escolha um período contábil no cabeçalho para ver o balancete."
        />
      </>
    );
  }

  if (periodStatus.data && !periodStatus.data.hasMovement) {
    return (
      <>
        <PageHeader
          title="Balancete"
          description="Balancete gerado a partir do razão contábil do período."
        />
        <SemMovimento
          periodLabel={selectedPeriod?.label}
          contexto="O balancete é derivado do razão. Importe o razão do período para vê-lo aqui."
        />
      </>
    );
  }

  function renderSecao(secao: Secao) {
    const aberta = !collapsed.has(secao.nature);
    return (
      <Fragment key={secao.nature}>
        <TableRow className="bg-muted/60">
          <TableCell colSpan={2}>
            <button
              type="button"
              onClick={() => toggle(secao.nature)}
              className="flex items-center gap-2 text-sm font-semibold"
            >
              {aberta ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              {secao.label}
              <span className="font-normal text-muted-foreground">
                ({secao.contas.length} conta{secao.contas.length > 1 ? "s" : ""})
              </span>
            </button>
          </TableCell>
          <TableCell className="text-right tabular-nums">{formatCurrency(secao.anterior)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatCurrency(secao.debito)}</TableCell>
          <TableCell className="text-right tabular-nums">{formatCurrency(secao.credito)}</TableCell>
          <TableCell className="text-right font-semibold tabular-nums">
            {formatCurrency(sinal(secao.nature, secao.saldo))}
          </TableCell>
          <TableCell />
        </TableRow>
        {aberta
          ? secao.contas.map((c) => (
              <TableRow key={c.reduced_code}>
                <TableCell className="font-mono text-xs">{c.reduced_code}</TableCell>
                <TableCell className="max-w-[280px] truncate">{c.account_name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(c.opening_balance)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(c.debit_mov)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(c.credit_mov)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(sinal(c.nature, c.closing_balance))}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isClosed}
                    title={
                      isClosed
                        ? "Período fechado: reabra o período para lançar ajustes."
                        : "Ajustar por lançamento no razão"
                    }
                    onClick={() =>
                      setAjuste({
                        reduced_code: c.reduced_code,
                        account_name: c.account_name,
                        side: c.nature && CREDORAS.has(c.nature) ? "credito" : "debito",
                      })
                    }
                  >
                    <PlusCircle className="mr-1 size-4" />
                    Ajustar
                  </Button>
                </TableCell>
              </TableRow>
            ))
          : null}
      </Fragment>
    );
  }

  return (
    <>
      <PageHeader
        title="Balancete"
        description={`Balancete de ${selectedPeriod?.label ?? ""} gerado pelo razão contábil. Correções são feitas por lançamento de ajuste.`}
      />

      <ConferenciaBalanco periodId={selectedPeriodId} />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Buscar por código ou nome da conta"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-sm"
        />
        <Select value={natureFilter} onValueChange={setNatureFilter}>
          <SelectTrigger className="sm:w-[240px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as naturezas</SelectItem>
            <SelectItem value="sem_natureza">Sem natureza</SelectItem>
            {NATURE_OPTIONS.map((nature) => (
              <SelectItem key={nature} value={nature}>
                {NATURE_LABEL[nature]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 sm:ml-auto">
          <Checkbox
            id="somente-movimento"
            checked={onlyMoved}
            onCheckedChange={(checked) => setOnlyMoved(checked === true)}
          />
          <Label htmlFor="somente-movimento" className="text-sm font-normal">
            Somente contas com movimento
          </Label>
        </div>
      </div>

      {isClosed ? (
        <p className="mb-4 text-sm text-muted-foreground">
          Período fechado: lançamentos de ajuste ficam bloqueados até a reabertura.
        </p>
      ) : null}

      {conferencia.isLoading ? (
        <LoadingRows />
      ) : conferencia.isError ? (
        <ErrorState
          message={(conferencia.error as Error)?.message}
          onRetry={() => void conferencia.refetch()}
        />
      ) : contas.length === 0 ? (
        <EmptyState
          title="Nenhum saldo no período"
          description="Importe o razão contábil do período em Importar › Razão contábil (G2)."
        />
      ) : filtradas.length === 0 ? (
        <EmptyState
          title="Nenhuma conta encontrada"
          description="Ajuste os filtros para ver outras contas."
        />
      ) : (
        <>
          {semNatureza ? (
            <p className="mb-4 text-sm text-amber-700 dark:text-amber-400">
              {semNatureza.contas.length} conta(s) sem natureza — classifique-as no plano de contas
              do razão para consolidar o resultado.
            </p>
          ) : null}

          {filtroAtivo ? (
            <p className="mb-4 text-sm text-muted-foreground">
              Filtros ativos: os subtotais consideram apenas as contas visíveis.
            </p>
          ) : null}

          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">Código</TableHead>
                  <TableHead>Conta</TableHead>
                  <TableHead className="text-right">Saldo anterior</TableHead>
                  <TableHead className="text-right">Débito</TableHead>
                  <TableHead className="text-right">Crédito</TableHead>
                  <TableHead className="text-right">Saldo atual</TableHead>
                  <TableHead className="w-[120px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {semNatureza ? renderSecao(semNatureza) : null}

                {GRUPOS.map((grupo) => {
                  const secoesGrupo = grupo.naturezas
                    .map((n) => secoes.get(n))
                    .filter((s): s is Secao => Boolean(s));
                  if (!secoesGrupo.length) return null;
                  return (
                    <Fragment key={grupo.key}>
                      <TableRow className="bg-primary/10">
                        <TableCell colSpan={7} className="text-sm font-semibold uppercase tracking-wide">
                          {grupo.label}
                        </TableCell>
                      </TableRow>
                      {secoesGrupo.map(renderSecao)}
                      {grupo.key === "ativo" ? (
                        <TableRow className="border-t-2">
                          <TableCell colSpan={5} className="font-semibold">
                            Total do Ativo
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatCurrency(totaisGrupo.ativo)}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      ) : null}
                      {grupo.key === "passivo_pl" ? (
                        <TableRow className="border-t-2">
                          <TableCell colSpan={5} className="font-semibold">
                            Total do Passivo + Patrimônio Líquido
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatCurrency(totaisGrupo.passivoPl)}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      ) : null}
                      {grupo.key === "resultado" ? (
                        <>
                          <TableRow>
                            <TableCell colSpan={5} className="font-medium">
                              (=) Lucro bruto
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {formatCurrency(totaisGrupo.lucroBruto)}
                            </TableCell>
                            <TableCell />
                          </TableRow>
                          <TableRow className="border-t-2">
                            <TableCell colSpan={5} className="font-semibold">
                              (=) Resultado do período
                            </TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">
                              {formatCurrency(totaisGrupo.resultado)}
                            </TableCell>
                            <TableCell />
                          </TableRow>
                        </>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <LancamentoAjusteDialog
        periodId={selectedPeriodId}
        contexto={ajuste}
        defaultDate={monthStart}
        onOpenChange={(open) => {
          if (!open) setAjuste(null);
        }}
      />
    </>
  );
}
