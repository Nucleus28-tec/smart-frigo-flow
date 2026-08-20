CREATE OR REPLACE FUNCTION public.generate_period_statements(_period_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_receita numeric := 0; v_custo numeric := 0; v_despesa numeric := 0;
  v_ac numeric := 0; v_anc numeric := 0; v_pc numeric := 0; v_pnc numeric := 0; v_pl numeric := 0;
  v_caixa numeric := 0; v_caixa_ini numeric := 0;
  v_lucro_bruto numeric; v_resultado numeric;
  v_dre jsonb; v_bp jsonb; v_fc jsonb;
  v_has_journal boolean; v_source text;
  c_receita text[] := '{}'; c_custo text[] := '{}'; c_despesa text[] := '{}';
  c_ac text[] := '{}'; c_anc text[] := '{}'; c_pc text[] := '{}'; c_pnc text[] := '{}'; c_pl text[] := '{}';
  c_caixa text[] := '{}';
begin
  if v_user is null then
    select id into v_user from public.profiles
     where role = 'admin' and is_active = true order by created_at limit 1;
  end if;
  if v_user is null then raise exception 'Nenhum administrador ativo para registrar a geração.'; end if;

  select exists (select 1 from public.journal_legs where period_id = _period_id and status = 'ativo')
    into v_has_journal;
  v_source := case when v_has_journal then 'razao' else 'balancete' end;

  if v_has_journal then
    select
      coalesce(sum(credit_mov - debit_mov) filter (where nature = 'receita'), 0),
      coalesce(sum(debit_mov - credit_mov) filter (where nature = 'custo'), 0),
      coalesce(sum(debit_mov - credit_mov) filter (where nature = 'despesa'), 0),
      coalesce(sum(closing_balance) filter (where nature = 'ativo_circulante'), 0),
      coalesce(sum(closing_balance) filter (where nature = 'ativo_nao_circulante'), 0),
      coalesce(sum(-closing_balance) filter (where nature = 'passivo_circulante'), 0),
      coalesce(sum(-closing_balance) filter (where nature = 'passivo_nao_circulante'), 0),
      coalesce(sum(-closing_balance) filter (where nature = 'patrimonio_liquido'), 0),
      coalesce(sum(closing_balance) filter (
        where nature = 'ativo_circulante'
          and (account_name ilike '%caixa%' or account_name ilike '%banco%' or account_name ilike '%aplica%')), 0),
      coalesce(sum(opening_balance) filter (
        where nature = 'ativo_circulante'
          and (account_name ilike '%caixa%' or account_name ilike '%banco%' or account_name ilike '%aplica%')), 0),
      coalesce(array_agg(reduced_code) filter (where nature = 'receita'), '{}'),
      coalesce(array_agg(reduced_code) filter (where nature = 'custo'), '{}'),
      coalesce(array_agg(reduced_code) filter (where nature = 'despesa'), '{}'),
      coalesce(array_agg(reduced_code) filter (where nature = 'ativo_circulante'), '{}'),
      coalesce(array_agg(reduced_code) filter (where nature = 'ativo_nao_circulante'), '{}'),
      coalesce(array_agg(reduced_code) filter (where nature = 'passivo_circulante'), '{}'),
      coalesce(array_agg(reduced_code) filter (where nature = 'passivo_nao_circulante'), '{}'),
      coalesce(array_agg(reduced_code) filter (where nature = 'patrimonio_liquido'), '{}'),
      coalesce(array_agg(reduced_code) filter (
        where nature = 'ativo_circulante'
          and (account_name ilike '%caixa%' or account_name ilike '%banco%' or account_name ilike '%aplica%')), '{}')
    into v_receita, v_custo, v_despesa, v_ac, v_anc, v_pc, v_pnc, v_pl, v_caixa, v_caixa_ini,
         c_receita, c_custo, c_despesa, c_ac, c_anc, c_pc, c_pnc, c_pl, c_caixa
    from public.period_account_balances(_period_id);
  else
    select
      coalesce(sum(case when nature = 'receita' then abs(coalesce(reviewed_value, raw_value)) end), 0),
      coalesce(sum(case when nature = 'custo' then abs(coalesce(reviewed_value, raw_value)) end), 0),
      coalesce(sum(case when nature = 'despesa' then abs(coalesce(reviewed_value, raw_value)) end), 0),
      coalesce(sum(case when nature = 'ativo_circulante' then coalesce(reviewed_value, raw_value) end), 0),
      coalesce(sum(case when nature = 'ativo_nao_circulante' then coalesce(reviewed_value, raw_value) end), 0),
      coalesce(sum(case when nature = 'passivo_circulante' then abs(coalesce(reviewed_value, raw_value)) end), 0),
      coalesce(sum(case when nature = 'passivo_nao_circulante' then abs(coalesce(reviewed_value, raw_value)) end), 0),
      coalesce(sum(case when nature = 'patrimonio_liquido' then abs(coalesce(reviewed_value, raw_value)) end), 0)
    into v_receita, v_custo, v_despesa, v_ac, v_anc, v_pc, v_pnc, v_pl
    from public.ledger_entries where period_id = _period_id;
    v_caixa := v_ac; v_caixa_ini := 0;
  end if;

  v_lucro_bruto := v_receita - v_custo;
  v_resultado := v_lucro_bruto - v_despesa;

  v_dre := jsonb_build_object('titulo', 'Demonstração do Resultado do Exercício', 'fonte', v_source,
    'base', 'movimento',
    'linhas', jsonb_build_array(
      jsonb_build_object('label','Receita bruta','value',v_receita,'kind','item','nature','receita','base','movimento','codes',to_jsonb(c_receita)),
      jsonb_build_object('label','Custo dos produtos vendidos','value',-v_custo,'kind','item','nature','custo','base','movimento','codes',to_jsonb(c_custo)),
      jsonb_build_object('label','Lucro bruto','value',v_lucro_bruto,'kind','subtotal','codes',to_jsonb(c_receita || c_custo)),
      jsonb_build_object('label','Despesas operacionais','value',-v_despesa,'kind','item','nature','despesa','base','movimento','codes',to_jsonb(c_despesa)),
      jsonb_build_object('label','Resultado líquido','value',v_resultado,'kind','total','codes',to_jsonb(c_receita || c_custo || c_despesa))));

  v_bp := jsonb_build_object('titulo', 'Balanço Patrimonial', 'fonte', v_source,
    'base', 'saldo',
    'linhas', jsonb_build_array(
      jsonb_build_object('label','Ativo circulante','value',v_ac,'kind','item','nature','ativo_circulante','base','saldo','codes',to_jsonb(c_ac)),
      jsonb_build_object('label','Ativo não circulante','value',v_anc,'kind','item','nature','ativo_nao_circulante','base','saldo','codes',to_jsonb(c_anc)),
      jsonb_build_object('label','Total do ativo','value',v_ac + v_anc,'kind','total','codes',to_jsonb(c_ac || c_anc)),
      jsonb_build_object('label','Passivo circulante','value',v_pc,'kind','item','nature','passivo_circulante','base','saldo','codes',to_jsonb(c_pc)),
      jsonb_build_object('label','Passivo não circulante','value',v_pnc,'kind','item','nature','passivo_nao_circulante','base','saldo','codes',to_jsonb(c_pnc)),
      jsonb_build_object('label','Patrimônio líquido','value',v_pl,'kind','item','nature','patrimonio_liquido','base','saldo','codes',to_jsonb(c_pl)),
      jsonb_build_object('label','Total do passivo + PL','value',v_pc + v_pnc + v_pl,'kind','total','codes',to_jsonb(c_pc || c_pnc || c_pl))));

  v_fc := jsonb_build_object('titulo', 'Fluxo de Caixa', 'fonte', v_source,
    'base', 'variacao_caixa',
    'linhas', jsonb_build_array(
      jsonb_build_object('label','Caixa inicial','value',v_caixa_ini,'kind','item','base','saldo','codes',to_jsonb(c_caixa)),
      jsonb_build_object('label','Resultado líquido do período','value',v_resultado,'kind','item','base','movimento','codes',to_jsonb(c_receita || c_custo || c_despesa)),
      jsonb_build_object('label','Variação de caixa no período','value',v_caixa - v_caixa_ini,'kind','subtotal','base','movimento','codes',to_jsonb(c_caixa)),
      jsonb_build_object('label','Caixa final','value',v_caixa,'kind','total','base','saldo','codes',to_jsonb(c_caixa))));

  insert into public.financial_statements (period_id, statement_type, content, generated_by, generated_at)
  values (_period_id,'dre',v_dre,v_user,now()),
         (_period_id,'balanco_patrimonial',v_bp,v_user,now()),
         (_period_id,'fluxo_de_caixa',v_fc,v_user,now())
  on conflict (period_id, statement_type)
  do update set content = excluded.content, generated_by = excluded.generated_by, generated_at = now();

  return jsonb_build_object('fonte', v_source, 'dre', v_dre, 'balanco_patrimonial', v_bp, 'fluxo_de_caixa', v_fc);
end $function$;