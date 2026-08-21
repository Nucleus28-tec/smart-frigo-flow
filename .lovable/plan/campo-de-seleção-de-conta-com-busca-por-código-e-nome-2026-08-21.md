# Campo de seleção de conta com busca por código e nome

Substituir os inputs simples de "Conta débito" e "Conta crédito" do formulário de lançamentos por um campo de seleção autocomplete que mostra código + nome dentro do próprio campo.

## 1. Componente reutilizável `AccountSelect`

Criar `src/components/razao/AccountSelect.tsx` usando os componentes existentes `Command`, `Popover`, `Button` e `Input` do shadcn.

Comportamento:
- O campo fechado exibe o código reduzido + nome da conta (ex.: `021811 — SALARIOS A PAGAR...`).
- Clique abre um popover com lista filtrável.
- Busca por código reduzido ou por nome (case-insensitive, ignorando acentos).
- Navegação por teclado (setas, Enter, Escape).
- Quando nenhuma conta é selecionada, mostra placeholder "Buscar conta...".
- Prop `tone` define a cor do chip (âmbar para débito, verde-marca para crédito).

## 2. Integração no formulário de lançamentos

Em `src/components/razao/GerenciadorLancamentos.tsx`:
- Substituir os dois `<Input list="contas-razao">` por `<AccountSelect>`.
- Remover o `<datalist id="contas-razao">` (não será mais necessário).
- Manter o estado `form.debit_code` / `form.credit_code` guardando apenas o código reduzido.
- Manter o bloco de destaque com `AccountChip` abaixo do campo, pois reforça a leitura visual; apenas o input passa a mostrar também o nome.

## 3. Validação e persistência

- Ao gravar, continuar enviando `debit_code` e `credit_code` normalmente para `saveManualJournalEntry`.
- Garantir que a seleção limpa o código quando o usuário apaga o texto e não escolhe nada.
- Preservar foco e acessibilidade (`aria-expanded`, `aria-controls`).

## 4. Verificação

- Abrir um lançamento existente e confirmar que débito e crédito aparecem no formato "código — nome".
- Criar um novo lançamento buscando pelo nome da conta (não só pelo código).
- Confirmar que a gravação persiste os códigos corretos e a grade reflete os nomes.
