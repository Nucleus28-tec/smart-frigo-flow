# Design System — Rotta Financeiro (base Synetica)

Estilo: SaaS financeiro moderno, minimalista e corporativo. Fundo quase branco, superfícies brancas, hairlines finas, cantos arredondados e um único acento verde-limão usado com parcimônia (estados ativos, destaques positivos, gráficos).

## Cores (tokens em `src/styles.css`)

| Token | Uso | Referência |
| --- | --- | --- |
| `background` | fundo da aplicação | `#F9F9F9` |
| `surface` / `card` | cartões, header, sidebar | `#FFFFFF` |
| `foreground` | texto principal | `#1B1B1B` |
| `muted-foreground` | texto secundário / labels | `#5E5E5E` |
| `border` / `hairline` | divisórias | `#E9E9E9` |
| `primary` | botões principais (preto) | `#1B1B1B` |
| `brand` | acento verde (ícone ativo, CTA de destaque) | `#4ADE6F` |
| `brand-soft` | badges e chips positivos | `#DCF7E3` |
| `destructive` / `warning` | erros e alertas | vermelho / âmbar |
| `chart-1..5` | gráficos: verde, preto, verde claro, cinza, âmbar | — |

Nunca usar cores hardcoded (`text-white`, `bg-[#...]`) — sempre tokens.

## Tipografia

- Família: **Inter Tight** (carregada no `__root.tsx`), fallback system-ui.
- H1 página: 28px / 600 / tracking -0.02em
- Título de card: 16px / 600
- Corpo: 14px / 400
- Labels e cabeçalhos de tabela: 11px / 600 / uppercase / tracking 0.08em
- Números em tabelas: `tabular-nums` (aplicado por padrão em `th`/`td`).

## Espaçamento e formas

- Raio base `--radius: 12px` (cards `rounded-xl`, botões e inputs `rounded-lg`, badges `rounded-full`).
- Padding de card: 24px; células de tabela: 12px vertical / 12px horizontal.
- Conteúdo da página: 32px em desktop, 16px em mobile.
- Sombras quase inexistentes: `0 1px 2px oklch(0 0 0 / 0.04)`; a separação vem da borda.

## Componentes

- **Botões**: `default` preto, `brand` verde, `outline` branco com borda, `ghost` cinza. Altura 40px (sm 36px).
- **Cards**: brancos, borda fina, título em 16px, valor em destaque e variação em badge verde.
- **Tabelas**: cabeçalho em caixa alta cinza com fundo `muted/50`, linhas separadas por hairline, hover suave.
- **Badges**: pílulas suaves — `brand`/`success` verde claro, `warning` âmbar, `destructive` vermelho claro, `outline` neutro.
- **Sidebar**: branca com borda direita, item ativo em bloco preto com ícone verde, demais itens cinza-escuro.
- **Estados**: skeletons cinza, vazio com ícone em círculo verde claro, erro em caixa vermelha suave.

## Temas claro e noite

- `ThemeProvider` (`src/hooks/useTheme.tsx`) aplica a classe `dark` no `<html>`; modos: claro, noite e sistema, persistidos em `localStorage` (`rotta-theme`).
- Script inline no `__root.tsx` aplica o tema antes da primeira pintura (sem flash).
- `ThemeToggle` fica no header do app e no canto da tela de login.

## Iluminação verde (hover/focus)

Utilitários em `src/styles.css`, baseados nos tokens `--glow-border`, `--glow-tint`, `--glow-soft`, `--glow-ring`, `--glow-strong-shadow` (mais intensos no tema noite):

- `glow-interactive` — inputs, textareas e select: borda verde no hover, halo verde no foco.
- `glow-surface` — cards e botões outline: borda verde suave + brilho no hover.
- `glow-row` — linhas de tabela: fundo verde tênue + faixa verde à esquerda.
- `glow-strong` — botões primário/brand: glow verde no hover.

`prefers-reduced-motion` desativa as transições mantendo as cores.
