# Design System "Synetica" para o Rotta Financeiro

Extraí a linguagem visual do print (dashboard financeiro SaaS): fundo quase branco, superfícies brancas com bordas finíssimas, tipografia geométrica preta, e um único acento verde-limão vibrante usado com muita economia. É um estilo **minimalista corporativo moderno**: muito respiro, pouca cor, hierarquia feita por peso de fonte e espaçamento — não por caixas coloridas.

Hoje o app usa vinho/bordô com sidebar escura. A proposta troca essa base pela paleta do print.

## Paleta extraída do print

Amostrei as cores dominantes da imagem:

| Papel | Cor | Uso |
|---|---|---|
| Fundo da aplicação | `#F9F9F9` (86% da imagem) | canvas geral |
| Superfície | `#FFFFFF` | cards, tabelas, painéis |
| Tinta principal | `#1B1B1B` | títulos, números, sidebar |
| Texto secundário | `#5E5E5E` | labels, descrições |
| Linhas e bordas | `#E6E6E6` / `#B0B0B0` | divisórias sutis |
| Acento (marca) | `#4ADE6F` → `#22C55E` | botão primário, item ativo, destaque |
| Acento suave | `#B7F1C5` | badges, realces de fundo |

Semânticos mantidos: sucesso reaproveita o verde da marca; alerta em âmbar; erro em vermelho — usados só em estados, nunca decorativos.

## Tipografia

- Uma família sans geométrica (Inter Tight / Geist), carregada por `<link>` no head.
- Escala: 32px títulos de página (peso 600, tracking negativo), 20px títulos de card, 14px corpo, 12px labels em maiúsculas com tracking aberto e cor secundária.
- Números financeiros com variante tabular, para as colunas de valores alinharem.

## Espaçamento, bordas e sombras

- Grade de 4px; respiro generoso: 24–32px dentro dos cards, 24px entre blocos.
- Raio: 12px em cards e inputs, 10px em botões, pill nos badges.
- Sem sombras pesadas: borda de 1px `#E6E6E6` e, no máximo, sombra difusa quase imperceptível.

## Padrões de componentes (o que muda na tela)

- **Sidebar**: passa a ser clara (branca, borda direita fina), texto grafite; item ativo em preto com texto branco e ícone verde — como no print.
- **Header**: fino, branco, com seletor de período discreto, badge de status em pill e avatar/nome à direita.
- **Cards de indicador**: label pequeno em cinza, número grande, variação em pill verde/vermelha.
- **Tabelas**: cabeçalho cinza claro em maiúsculas pequenas, linhas separadas por borda fina, hover suave, valores tabulares alinhados à direita.
- **Botões**: primário preto (ação principal) e verde (ação de destaque/IA); secundário branco com borda; ambos com altura 36–40px.
- **Badges de status** (aberto/em revisão/fechado, pendente/aprovada): pill com fundo tênue e texto forte.
- **Gráficos**: barras/linhas em verde da marca com grade cinza clara, sem gradientes chamativos.

## Como será implementado

1. Reescrever os tokens em `src/styles.css` (`:root` e `.dark`) com a paleta acima em oklch, ajustar `--radius` para 12px e registrar tokens novos (superfície elevada, borda sutil, acento suave).
2. Carregar a fonte via `<link>` em `src/routes/__root.tsx` e mapear `--font-sans` no `@theme`.
3. Ajustar `AppShell` (sidebar clara, item ativo preto, header enxuto).
4. Padronizar `PageHeader`, cards, tabelas e badges nas 10 telas para o novo padrão — sem alterar nenhuma regra de negócio, consulta ou server function.
5. Conferir contraste (texto secundário e verde sobre branco) e revisar as telas no preview.

## Observações técnicas

- Nada de cor fixa nos componentes: tudo por token semântico, conforme já está o projeto.
- O tema escuro é atualizado junto (preto `#0E0E0E`, superfície `#171717`, mesmo verde) para não quebrar.
- A imagem enviada é referência de estilo; não entra no app como asset.
