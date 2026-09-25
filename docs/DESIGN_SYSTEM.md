# Design System — Rotta Financeiro

Direção: painel financeiro de alto contraste, preciso e colorido. A aplicação oferece um tema claro limpo e um tema escuro profundo, com navegação horizontal em duas faixas.

## Tipografia

- Títulos e números de destaque: **Outfit**.
- Textos, tabelas e controles: **Figtree**.
- Números contábeis usam algarismos tabulares.

## Temas

### Claro

- Fundo principal: `#F7F7F7`; superfícies: `#FFFFFF`; texto: `#111111`.
- Cartões brancos com borda cinza clara e sombra curta.
- Positivo: `#16A34A`; negativo: `#DC2626`.
- Gráficos: azul, roxo e laranja sóbrios, com verde e vermelho para semântica financeira.

### Escuro

- Fundo principal: `#0A0A0A`; superfícies secundárias: `#121212`; cartões: `#1A1A1A`; texto: `#F5F5F5`.
- Cartões sem borda aparente e sem sombra externa pesada.
- Positivo: `#22C55E`; negativo: `#F43F5E`.
- Gráficos: ciano, roxo e amarelo luminosos, com brilhos discretos somente em interação.

Todas as cores são tokens semânticos em `src/styles.css`. Componentes não devem usar cores visuais fixas.

## Navegação

- Cabeçalho fixo em duas linhas.
- Primeira linha: marca, período, status, alertas, tema, usuário e saída.
- Segunda linha: navegação horizontal com ícone e nome da página.
- A página ativa usa cor de marca e indicador inferior.
- No celular, a navegação abre em grade por um botão sempre visível.

## Superfícies e interação

- Raio padrão de 12px; cartões não ultrapassam esse raio.
- Transições entre 150 e 200ms, respeitando `prefers-reduced-motion`.
- Brilho temático reservado para foco, item ativo e ações principais.
- Estados de sucesso, erro e atenção mantêm significado idêntico nos dois temas.