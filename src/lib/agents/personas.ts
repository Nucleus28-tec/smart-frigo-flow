/** Definição dos agentes de IA do Rotta (client-safe). */

export const AGENT_KEYS = ["contador", "cfo"] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

export type AgentPersona = {
  key: AgentKey;
  name: string;
  tagline: string;
  description: string;
  canWrite: boolean;
  suggestions: string[];
};

export const AGENTS: Record<AgentKey, AgentPersona> = {
  contador: {
    key: "contador",
    name: "Agente Contador",
    tagline: "Classificação, conferência e plano de contas",
    description:
      "Foco operacional, conta a conta. Sugere classificação e aponta inconsistências, " +
      "mas nunca grava sozinho — toda alteração passa pelo botão Aplicar.",
    canWrite: true,
    suggestions: [
      "Conferir o fechamento do período",
      "Quais contas estão sem natureza?",
      "Aponte inconsistências no balancete",
      "Sugira a classificação das contas pendentes",
    ],
  },
  cfo: {
    key: "cfo",
    name: "Agente CFO",
    tagline: "Leitura executiva, indicadores e risco",
    description:
      "Visão consolidada do período: DRE gerencial, margens, indicadores e recomendação " +
      "executiva. Somente leitura — nunca altera dados.",
    canWrite: false,
    suggestions: [
      "Resumo executivo do mês",
      "Como está a margem e o resultado?",
      "Quais são os principais riscos deste período?",
      "O que mudou em relação ao mês anterior?",
    ],
  },
};

export function isAgentKey(value: unknown): value is AgentKey {
  return typeof value === "string" && (AGENT_KEYS as readonly string[]).includes(value);
}
