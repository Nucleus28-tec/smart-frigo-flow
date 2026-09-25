# Dois temas e navegação horizontal do Rotta Financeiro

## Objetivo
Substituir a aparência genérica atual pela direção **Neo-glass horizontal dashboard**, adaptada ao contexto contábil do Rotta Financeiro, sem alterar cálculos, dados ou permissões.

## O que será feito

1. **Criar os dois temas completos**
   - Tema claro: fundos `#FFFFFF` e `#F7F7F7`, cartões brancos com borda cinza clara, texto `#111111`, positivo `#16A34A` e negativo `#DC2626`.
   - Tema escuro: fundos `#0A0A0A` e `#121212`, cartões `#1A1A1A` sem borda aparente, texto `#F5F5F5`, positivo `#22C55E` e negativo `#F43F5E`.
   - Gráficos claros em azul, roxo e laranja sóbrios; gráficos escuros em ciano, roxo e amarelo neon.
   - Aplicar Outfit nos títulos e Figtree nos textos, números e controles.
   - Manter a escolha Claro, Escuro ou Sistema salva para o usuário.

2. **Trocar a sidebar pelo cabeçalho horizontal em duas linhas**
   - Primeira linha: marca Rotta Financeiro, período selecionado, situação do período, alertas, tema, usuário e sair.
   - Segunda linha: páginas com ícone e nome, organizadas nos grupos Operação, Contabilidade, Revisão e Administração.
   - Destacar claramente a página ativa.
   - Manter “Usuários” visível apenas para administradores e preservar os demais controles por papel.

3. **Adaptar a navegação para telas menores**
   - No tablet, reduzir espaços sem esconder funções.
   - No celular, primeira linha compacta e menu de páginas acessível por botão, sempre mostrando ícones e nomes quando aberto.
   - Garantir que período, usuário e ações não se sobreponham.

4. **Refinar superfícies e estados do sistema**
   - Adequar cartões, tabelas, campos, menus, diálogos, badges, alertas e estados de carregamento aos dois temas.
   - Usar transparência e brilho apenas no tema escuro, de forma discreta e funcional.
   - Manter cores de sucesso, erro e atenção consistentes em todas as páginas.

5. **Uniformizar o Dashboard**
   - Ajustar os indicadores e os gráficos existentes à composição escolhida, com maior contraste e hierarquia.
   - Preservar Cascata da DRE, composição de custos, saúde financeira, estrutura patrimonial e evolução por período.
   - Não inventar dados nem substituir as métricas contábeis atuais.

6. **Validar o resultado**
   - Conferir tema claro e escuro no Dashboard e no Razão Contábil.
   - Conferir navegação, troca de período, permissões administrativas e saída.
   - Validar desktop e celular, inclusive menus longos e tabelas densas.

## Detalhes técnicos
- Centralizar todas as novas cores em tokens semânticos globais; nenhuma página receberá cores isoladas.
- Atualizar o carregamento antecipado do tema para evitar clarão ou troca visual ao abrir a aplicação.
- Reestruturar o contêiner principal para remover a largura reservada à sidebar e limitar a área de conteúdo em telas muito largas.
- Preservar as rotas atuais, os componentes de botão existentes e a origem oficial dos dados no razão contábil.
- Atualizar a documentação visual e registrar a navegação horizontal como padrão estrutural do sistema.

## Fora do escopo
- Nenhuma mudança no banco, importação, cálculos, indicadores ou regras contábeis.
- As imagens enviadas serão somente referências visuais; não serão exibidas no sistema.
