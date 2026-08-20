-- 1. flag de encerramento na perna do razão
alter table public.journal_legs
  add column if not exists is_closing boolean not null default false;

create index if not exists idx_journal_legs_period_closing
  on public.journal_legs (period_id, is_closing) where status = 'ativo';

-- códigos de resultado configurados nos fechamentos
create or replace function public.closing_result_codes()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct c), '{}'::text[])
  from (
    select public.norm_reduced_code(result_code) as c from public.accounting_closings where result_code is not null
    union
    select public.norm_reduced_code(profit_code) from public.accounting_closings where profit_code is not null
  ) s
  where c is not null and c <> ''
$$;

create or replace function public.leg_is_closing(
  _entry_group uuid,
  _account text,
  _counterpart text,
  _historico text
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    _entry_group is not null
    or coalesce(_historico, '') ~* '(encerramento|apura(c|ç)(a|ã)o do resultado|resultado parcial|resultado do exerc)'
    or public.norm_reduced_code(_account) = any (public.closing_result_codes())
    or public.norm_reduced_code(_counterpart) = any (public.closing_result_codes())
$$;

create or replace function public.mark_journal_leg_closing()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.is_closing := public.leg_is_closing(
    new.entry_group, new.account_reduced_code, new.counterpart_reduced_code, new.historico
  );
  return new;
end $$;

drop trigger if exists trg_journal_legs_mark_closing on public.journal_legs;
create trigger trg_journal_legs_mark_closing
  before insert or update of entry_group, account_reduced_code, counterpart_reduced_code, historico
  on public.journal_legs
  for each row execute function public.mark_journal_leg_closing();

-- backfill dos meses já importados
update public.journal_legs l
   set is_closing = true
 where is_closing = false
   and public.leg_is_closing(l.entry_group, l.account_reduced_code, l.counterpart_reduced_code, l.historico);

-- 2. camada canônica de saldos
create or replace function public.period_account_balances(_period_id uuid)
returns table (
  reduced_code text,
  account_name text,
  hierarchical_code text,
  nature text,
  opening_balance numeric,
  debit_mov numeric,
  credit_mov numeric,
  debit_all numeric,
  credit_all numeric,
  closing_balance numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with mov as (
    select
      l.account_reduced_code as code,
      sum(l.debit) filter (where not l.is_closing) as deb_mov,
      sum(l.credit) filter (where not l.is_closing) as cred_mov,
      sum(l.debit) as deb_all,
      sum(l.credit) as cred_all
    from public.journal_legs l
    where l.period_id = _period_id and l.status = 'ativo'
    group by l.account_reduced_code
  ),
  base as (
    select
      coalesce(a.reduced_code, m.code, o.account_reduced_code) as code,
      coalesce(a.name, o.account_name, m.code) as nome,
      a.hierarchical_code as hier,
      a.nature as nat,
      coalesce(o.opening_balance, 0) as abertura,
      coalesce(m.deb_mov, 0) as deb_mov,
      coalesce(m.cred_mov, 0) as cred_mov,
      coalesce(m.deb_all, 0) as deb_all,
      coalesce(m.cred_all, 0) as cred_all
    from public.ledger_accounts a
    full outer join mov m on m.code = a.reduced_code
    left join public.journal_account_openings o
      on o.period_id = _period_id and o.account_reduced_code = coalesce(a.reduced_code, m.code)
  )
  select
    code, nome, hier, nat,
    abertura, deb_mov, cred_mov, deb_all, cred_all,
    abertura + deb_all - cred_all
  from base
  where abertura <> 0 or deb_all <> 0 or cred_all <> 0
$$;

grant execute on function public.period_account_balances(uuid) to authenticated, service_role;
grant execute on function public.closing_result_codes() to authenticated, service_role;
grant execute on function public.leg_is_closing(uuid, text, text, text) to authenticated, service_role;

-- 3. indicadores a partir da camada canônica
create or replace function public.recalculate_period_indicators_internal(_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_receita numeric := 0; v_custo numeric := 0; v_despesa numeric := 0;
  v_caixa numeric := 0; v_margem numeric := 0; v_ebitda numeric := 0; v_liquido numeric := 0;
  v_has_journal boolean;
begin
  select exists (select 1 from public.journal_legs where period_id = _period_id and status = 'ativo')
    into v_has_journal;

  if v_has_journal then
    select
      coalesce(sum(credit_mov - debit_mov) filter (where nature = 'receita'), 0),
      coalesce(sum(debit_mov - credit_mov) filter (where nature = 'custo'), 0),
      coalesce(sum(debit_mov - credit_mov) filter (where nature = 'despesa'), 0),
      coalesce(sum(closing_balance) filter (
        where nature = 'ativo_circulante'
          and (account_name ilike '%caixa%' or account_name ilike '%banco%' or account_name ilike '%aplica%')
      ), 0)
    into v_receita, v_custo, v_despesa, v_caixa
    from public.period_account_balances(_period_id);
  else
    select
      coalesce(sum(abs(coalesce(e.reviewed_value, e.raw_value))) filter (where e.nature = 'receita'), 0),
      coalesce(sum(abs(coalesce(e.reviewed_value, e.raw_value))) filter (where e.nature = 'custo'), 0),
      coalesce(sum(abs(coalesce(e.reviewed_value, e.raw_value))) filter (where e.nature = 'despesa'), 0),
      coalesce(sum(coalesce(e.reviewed_value, e.raw_value)) filter (
        where e.nature = 'ativo_circulante'
          and (e.source_account_name ilike '%caixa%' or e.source_account_name ilike '%banco%' or e.source_account_name ilike '%aplica%')
      ), 0)
    into v_receita, v_custo, v_despesa, v_caixa
    from public.ledger_entries e
    where e.period_id = _period_id;
  end if;

  v_ebitda := v_receita - v_custo - v_despesa;
  v_liquido := v_ebitda;
  if v_receita <> 0 then v_margem := ((v_receita - v_custo) / v_receita) * 100; end if;

  insert into public.dashboard_indicators (period_id, indicator_key, indicator_value, calculated_at)
  values
    (_period_id, 'receita_total', v_receita, now()),
    (_period_id, 'custo_total', v_custo, now()),
    (_period_id, 'margem_bruta', v_margem, now()),
    (_period_id, 'ebitda', v_ebitda, now()),
    (_period_id, 'resultado_liquido', v_liquido, now()),
    (_period_id, 'posicao_caixa', v_caixa, now())
  on conflict (period_id, indicator_key)
  do update set indicator_value = excluded.indicator_value, calculated_at = now();

  update public.accounting_periods set last_recalculated_at = now() where id = _period_id;

  return jsonb_build_object(
    'source', case when v_has_journal then 'razao' else 'balancete' end,
    'receita_total', v_receita, 'custo_total', v_custo, 'margem_bruta', v_margem,
    'ebitda', v_ebitda, 'resultado_liquido', v_liquido, 'posicao_caixa', v_caixa
  );
end $function$;

-- 4. demonstrativos a partir da camada canônica
create or replace function public.generate_period_statements(_period_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user uuid := auth.uid();
  v_receita numeric := 0; v_custo numeric := 0; v_despesa numeric := 0;
  v_ac numeric := 0; v_anc numeric := 0; v_pc numeric := 0; v_pnc numeric := 0; v_pl numeric := 0;
  v_caixa numeric := 0; v_caixa_ini numeric := 0;
  v_lucro_bruto numeric; v_resultado numeric;
  v_dre jsonb; v_bp jsonb; v_fc jsonb;
  v_has_journal boolean; v_source text;
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
          and (account_name ilike '%caixa%' or account_name ilike '%banco%' or account_name ilike '%aplica%')), 0)
    into v_receita, v_custo, v_despesa, v_ac, v_anc, v_pc, v_pnc, v_pl, v_caixa, v_caixa_ini
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
    'linhas', jsonb_build_array(
      jsonb_build_object('label','Receita bruta','value',v_receita,'kind','item','nature','receita'),
      jsonb_build_object('label','Custo dos produtos vendidos','value',-v_custo,'kind','item','nature','custo'),
      jsonb_build_object('label','Lucro bruto','value',v_lucro_bruto,'kind','subtotal'),
      jsonb_build_object('label','Despesas operacionais','value',-v_despesa,'kind','item','nature','despesa'),
      jsonb_build_object('label','Resultado líquido','value',v_resultado,'kind','total')));

  v_bp := jsonb_build_object('titulo', 'Balanço Patrimonial', 'fonte', v_source,
    'linhas', jsonb_build_array(
      jsonb_build_object('label','Ativo circulante','value',v_ac,'kind','item','nature','ativo_circulante'),
      jsonb_build_object('label','Ativo não circulante','value',v_anc,'kind','item','nature','ativo_nao_circulante'),
      jsonb_build_object('label','Total do ativo','value',v_ac + v_anc,'kind','total'),
      jsonb_build_object('label','Passivo circulante','value',v_pc,'kind','item','nature','passivo_circulante'),
      jsonb_build_object('label','Passivo não circulante','value',v_pnc,'kind','item','nature','passivo_nao_circulante'),
      jsonb_build_object('label','Patrimônio líquido','value',v_pl,'kind','item','nature','patrimonio_liquido'),
      jsonb_build_object('label','Total do passivo + PL','value',v_pc + v_pnc + v_pl,'kind','total')));

  v_fc := jsonb_build_object('titulo', 'Fluxo de Caixa', 'fonte', v_source,
    'linhas', jsonb_build_array(
      jsonb_build_object('label','Caixa inicial','value',v_caixa_ini,'kind','item'),
      jsonb_build_object('label','Resultado líquido do período','value',v_resultado,'kind','item'),
      jsonb_build_object('label','Variação de caixa no período','value',v_caixa - v_caixa_ini,'kind','subtotal'),
      jsonb_build_object('label','Caixa final','value',v_caixa,'kind','total')));

  insert into public.financial_statements (period_id, statement_type, content, generated_by, generated_at)
  values (_period_id,'dre',v_dre,v_user,now()),
         (_period_id,'balanco_patrimonial',v_bp,v_user,now()),
         (_period_id,'fluxo_de_caixa',v_fc,v_user,now())
  on conflict (period_id, statement_type)
  do update set content = excluded.content, generated_by = excluded.generated_by, generated_at = now();

  return jsonb_build_object('fonte', v_source, 'dre', v_dre, 'balanco_patrimonial', v_bp, 'fluxo_de_caixa', v_fc);
end $function$;