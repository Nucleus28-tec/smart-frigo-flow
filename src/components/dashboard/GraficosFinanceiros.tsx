import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  LabelList,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Pie,
  PieChart,
  Radar,
  RadarChart,
  XAxis,
  YAxis,
} from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCurrency } from "@/lib/rotta";

type ComponentRow = {
  component_key: string;
  basis: string;
  reduced_code: string;
  account_name: string;
  hierarchical_code: string | null;
  nature: string | null;
  value: number | string;
};

const compact = (value: number) =>
  value.toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

type Props = {
  periodId: string | null;
  periodLabel?: string | null;
  indicators: Map<string, { indicator_value: number }>;
};

export function GraficosFinanceiros({ periodId, periodLabel, indicators }: Props) {
  const num = (key: string) => Number(indicators.get(key)?.indicator_value ?? 0);

  const components = useQuery({
    queryKey: ["indicator-components", periodId],
    enabled: Boolean(periodId),
    queryFn: async (): Promise<ComponentRow[]> => {
      const { data, error } = await supabase.rpc("indicator_components", {
        _period_id: periodId!,
      });
      if (error) throw error;
      return (data ?? []) as unknown as ComponentRow[];
    },
  });

  const rows = components.data ?? [];
  const totalBy = (key: string) =>
    rows
      .filter((r) => r.component_key === key)
      .reduce((acc, r) => acc + Math.abs(Number(r.value) || 0), 0);

  /* ---------- 1. Cascata (waterfall) da formação do resultado ---------- */
  const receita = num("receita_total");
  const custo = num("custo_total");
  const despesa = num("despesa_total");
  const resultado = num("resultado_liquido");
  const margemBruta = receita - custo;

  const waterfallSteps = [
    { nome: "Receita", delta: receita, tipo: "positivo" as const },
    { nome: "Custos", delta: -custo, tipo: "negativo" as const },
    { nome: "Margem bruta", total: margemBruta, tipo: "total" as const },
    { nome: "Despesas", delta: -despesa, tipo: "negativo" as const },
    { nome: "Resultado", total: resultado, tipo: "total" as const },
  ];

  let running = 0;
  const waterfallData = waterfallSteps.map((step) => {
    if (step.tipo === "total") {
      running = step.total;
      return { nome: step.nome, base: 0, valor: Math.abs(step.total), real: step.total, tipo: step.tipo };
    }
    const start = running;
    running = running + step.delta;
    const base = Math.min(start, running);
    return {
      nome: step.nome,
      base,
      valor: Math.abs(step.delta),
      real: step.delta,
      tipo: step.tipo,
    };
  });

  const waterfallColor = (tipo: string) =>
    tipo === "positivo"
      ? "var(--chart-2)"
      : tipo === "negativo"
        ? "var(--chart-4)"
        : "var(--chart-1)";

  /* ---------- 2. Donut de composição de custos e despesas ---------- */
  const custoRows = rows.filter(
    (r) => r.component_key === "custo" || r.component_key === "despesa",
  );
  const agrupado = new Map<string, number>();
  for (const r of custoRows) {
    const nome = r.account_name || r.reduced_code;
    agrupado.set(nome, (agrupado.get(nome) ?? 0) + Math.abs(Number(r.value) || 0));
  }
  const ordenado = [...agrupado.entries()].sort((a, b) => b[1] - a[1]);
  const top = ordenado.slice(0, 6);
  const restante = ordenado.slice(6).reduce((acc, [, v]) => acc + v, 0);
  const donutData = [
    ...top.map(([nome, valor], i) => ({ nome, valor, fill: CHART_COLORS[i % CHART_COLORS.length] })),
    ...(restante > 0 ? [{ nome: "Demais contas", valor: restante, fill: "var(--muted-foreground)" }] : []),
  ];
  const donutTotal = donutData.reduce((acc, d) => acc + d.valor, 0);

  /* ---------- 3. Radar de saúde financeira ---------- */
  const escala = (valor: number, alvo: number) =>
    Math.max(0, Math.min(100, Math.round((valor / alvo) * 100)));
  const radarData = [
    { eixo: "Liquidez corrente", indice: escala(num("liquidez_corrente"), 2) },
    { eixo: "Liquidez seca", indice: escala(num("liquidez_seca"), 1.5) },
    { eixo: "Margem líquida", indice: escala(num("margem_liquida"), 15) },
    { eixo: "Margem bruta", indice: escala(num("margem_bruta"), 30) },
    { eixo: "Giro do ativo", indice: escala(num("giro_ativo"), 1.5) },
    { eixo: "Solvência", indice: escala(100 - num("endividamento_geral"), 60) },
  ];

  /* ---------- 4. Estrutura patrimonial empilhada ---------- */
  const patrimonioData = [
    {
      lado: "Ativo",
      circulante: totalBy("ativo_circulante"),
      naoCirculante: totalBy("ativo_nao_circulante"),
      patrimonio: 0,
    },
    {
      lado: "Passivo + PL",
      circulante: totalBy("passivo_circulante"),
      naoCirculante: totalBy("passivo_nao_circulante"),
      patrimonio: totalBy("patrimonio_liquido"),
    },
  ];
  const temPatrimonio = patrimonioData.some(
    (d) => d.circulante || d.naoCirculante || d.patrimonio,
  );

  const waterfallConfig = {
    valor: { label: "Valor" },
  } satisfies ChartConfig;

  const donutConfig = Object.fromEntries(
    donutData.map((d, i) => [
      d.nome,
      { label: d.nome, color: CHART_COLORS[i % CHART_COLORS.length] },
    ]),
  ) satisfies ChartConfig;

  const radarConfig = {
    indice: { label: "Índice", color: "var(--chart-1)" },
  } satisfies ChartConfig;

  const patrimonioConfig = {
    circulante: { label: "Circulante", color: "var(--chart-5)" },
    naoCirculante: { label: "Não circulante", color: "var(--chart-3)" },
    patrimonio: { label: "Patrimônio líquido", color: "var(--chart-2)" },
  } satisfies ChartConfig;

  return (
    <div className="mt-6 grid gap-4 xl:grid-cols-2">
      <Card className="glow-surface overflow-hidden border-l-4 border-l-chart-1">
        <CardHeader>
          <CardTitle className="text-base">Formação do resultado · {periodLabel}</CardTitle>
          <CardDescription>
            Da receita bruta ao resultado líquido, passo a passo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={waterfallConfig} className="h-[300px] w-full">
            <BarChart data={waterfallData} margin={{ top: 20 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="nome" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis tickFormatter={compact} tickLine={false} axisLine={false} width={60} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(_v, _n, item) => formatCurrency(Number(item?.payload?.real ?? 0))}
                  />
                }
              />
              <Bar dataKey="base" stackId="w" fill="transparent" />
              <Bar dataKey="valor" stackId="w" radius={[4, 4, 0, 0]}>
                {waterfallData.map((d) => (
                  <Cell key={d.nome} fill={waterfallColor(d.tipo)} />
                ))}
                <LabelList
                  dataKey="real"
                  position="top"
                  fontSize={10}
                  formatter={(v: number) => compact(Number(v))}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card className="glow-surface border-l-4 border-l-chart-3">
        <CardHeader>
          <CardTitle className="text-base">Composição de custos e despesas</CardTitle>
          <CardDescription>Maiores contas do período no razão contábil.</CardDescription>
        </CardHeader>
        <CardContent>
          {donutTotal === 0 ? (
            <p className="py-20 text-center text-sm text-muted-foreground">
              Sem custos ou despesas registrados neste período.
            </p>
          ) : (
            <ChartContainer config={donutConfig} className="mx-auto h-[300px] w-full">
              <PieChart>
                <ChartTooltip
                  content={<ChartTooltipContent formatter={(v) => formatCurrency(Number(v))} />}
                />
                <Pie
                  data={donutData}
                  dataKey="valor"
                  nameKey="nome"
                  innerRadius="52%"
                  outerRadius="80%"
                  paddingAngle={2}
                  strokeWidth={2}
                />
                <ChartLegend content={<ChartLegendContent nameKey="nome" />} className="flex-wrap" />
              </PieChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card className="glow-surface border-l-4 border-l-chart-2">
        <CardHeader>
          <CardTitle className="text-base">Saúde financeira</CardTitle>
          <CardDescription>
            Cada eixo vai de 0 a 100 comparando o índice com a meta de referência.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={radarConfig} className="mx-auto h-[300px] w-full">
            <RadarChart data={radarData} outerRadius="72%">
              <PolarGrid />
              <PolarAngleAxis dataKey="eixo" fontSize={11} />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Radar
                dataKey="indice"
                stroke="var(--chart-1)"
                fill="var(--chart-1)"
                fillOpacity={0.35}
                strokeWidth={2}
                dot
              />
            </RadarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card className="glow-surface border-l-4 border-l-chart-5">
        <CardHeader>
          <CardTitle className="text-base">Estrutura patrimonial</CardTitle>
          <CardDescription>Ativo frente a passivo e patrimônio líquido.</CardDescription>
        </CardHeader>
        <CardContent>
          {!temPatrimonio ? (
            <p className="py-20 text-center text-sm text-muted-foreground">
              Sem saldos patrimoniais calculados neste período.
            </p>
          ) : (
            <ChartContainer config={patrimonioConfig} className="h-[300px] w-full">
              <BarChart data={patrimonioData}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="lado" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={compact} tickLine={false} axisLine={false} width={60} />
                <ChartTooltip
                  content={<ChartTooltipContent formatter={(v) => formatCurrency(Number(v))} />}
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="circulante" stackId="p" fill="var(--color-circulante)" />
                <Bar dataKey="naoCirculante" stackId="p" fill="var(--color-naoCirculante)" />
                <Bar
                  dataKey="patrimonio"
                  stackId="p"
                  fill="var(--color-patrimonio)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
