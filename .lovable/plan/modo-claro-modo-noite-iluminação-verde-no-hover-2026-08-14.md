# Modo claro / modo noite + iluminação verde no hover

O projeto já tem toda a paleta escura definida em `src/styles.css` (bloco `.dark`), mas não existe nenhum controle que ative essa classe — hoje o app roda sempre no tema claro. O plano liga o tema escuro e adiciona o efeito de iluminação verde nas interações.

## 1. Alternância claro / noite

- Novo provider de tema que aplica a classe `dark` no `<html>`, com três modos: **Claro**, **Noite** e **Sistema** (segue a preferência do sistema operacional).
- A escolha fica salva no navegador, então volta igual no próximo acesso.
- Script inline no HTML raiz para aplicar o tema antes da primeira pintura, evitando o "flash" branco ao carregar no modo noite.
- Botão no header (ao lado do nome do usuário) com ícone sol/lua para trocar o tema em um clique; no menu do usuário fica a opção "Sistema".

## 2. Ajuste do tema noite

- Revisar os tokens do bloco `.dark` para o padrão do design system: fundo quase preto, superfícies em cinza-carvão, hairlines sutis e o mesmo verde da marca como acento.
- Conferir contraste de texto secundário, badges de status (aberto/em revisão/fechado), tabelas, gráficos e estados de erro/vazio nas telas principais.

## 3. Iluminação verde nas interações

Efeito consistente, usando sempre o verde da marca já existente:

- **Campos de formulário** (input, textarea, select, combobox): ao passar o mouse, borda verde suave; ao focar, borda verde plena com halo (glow) ao redor.
- **Linhas de tabela**: hover com fundo verde bem tênue e uma faixa verde fina na borda esquerda.
- **Cards e itens de menu lateral**: hover com borda verde suave e leve brilho; o item ativo continua como está.
- **Botões**: hover com glow verde no botão de destaque e realce de borda nos secundários.
- Transições curtas (~150ms) e intensidade menor no tema claro, mais visível no tema noite (onde o brilho aparece melhor).
- Respeita "reduzir movimento" do sistema: mantém a cor, remove a animação.

## 4. Cobertura

Aplicar e conferir nas telas: Dashboard, Períodos, Importar, Balancete, Reclassificações, Plano de Contas, Apontamentos, Demonstrativos, Atualizações, Usuários e Login.

## Notas técnicas

- Efeitos definidos como utilitários no `src/styles.css` (`@utility`) e tokens novos para o brilho (`--glow-brand`), sem cores fixas nos componentes.
- Ajustes nas variantes dos componentes shadcn (`input`, `button`, `card`, `table`) para herdarem o efeito por padrão.
- Nenhuma regra de negócio, consulta ou server function é alterada.
