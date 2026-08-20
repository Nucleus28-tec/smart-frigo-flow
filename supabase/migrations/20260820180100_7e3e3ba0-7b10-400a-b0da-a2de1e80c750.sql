alter table public.dashboard_indicators drop constraint if exists dashboard_indicators_indicator_key_check;
alter table public.dashboard_indicators add constraint dashboard_indicators_indicator_key_check
  check (indicator_key in (
    'receita_total','custo_total','despesa_total','margem_bruta','ebitda','resultado_liquido',
    'posicao_caixa','ativo_total','capital_giro','margem_liquida','margem_ebitda',
    'liquidez_corrente','liquidez_seca','liquidez_imediata','endividamento_geral','endividamento_pl',
    'giro_ativo','giro_estoque','pmr','pmp'
  ));