create or replace function public.link_reduced_accounts(_period_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_by_value int := 0; v_by_name int := 0; v_by_base int := 0;
        v_by_balance int := 0; v_nature int := 0; v_pending int := 0;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;

  create temp table _mov on commit drop as
  select l.account_reduced_code as rc,
         max(a.name) as nm,
         sum(l.debit) as deb,
         sum(l.credit) as cred,
         coalesce(max(o.opening_balance), 0) as abertura
  from public.journal_legs l
  join public.ledger_accounts a on a.id = l.account_id
  left join public.journal_account_openings o
    on o.period_id = l.period_id and o.account_reduced_code = l.account_reduced_code
  where l.period_id = _period_id
  group by l.account_reduced_code;

  create temp table _tb on commit drop as
  select t.code, t.name, t.debito, t.credito, t.saldo_atual
  from public.trial_balance_lines t
  where t.period_id = _period_id and t.is_analytic;

  -- contas cuja hierarquia foi definida manualmente: nunca são sobrescritas
  create temp table _locked on commit drop as
  select distinct a.reduced_code
  from public.ledger_accounts a
  where a.link_status = 'confirmado_manual'
     or exists (
       select 1 from public.ledger_account_audit x
        where x.account_key = a.reduced_code
          and x.source in ('plano_de_contas', 'manual')
          and x.field_changed in ('hierarchical_code', 'movimentacao_hierarquia', 'parent_code', 'nature', 'criacao_grupo'));

  -- rodada 1: nome normalizado exato
  with cand as (
    select m.rc, t.code,
           count(*) over (partition by m.rc) as per_rc,
           count(*) over (partition by t.code) as per_code
    from _mov m
    join _tb t on public.norm_account_name(t.name) = public.norm_account_name(m.nm)
    where not exists (select 1 from _locked k where k.reduced_code = m.rc)
  ), ok as (select rc, code from cand where per_rc = 1 and per_code = 1),
  upd as (
    update public.ledger_accounts a
       set hierarchical_code = ok.code,
           nature = coalesce(a.nature, public.nature_from_code(ok.code)),
           link_status = 'confirmado', confidence = 1,
           level = array_length(string_to_array(ok.code, '.'), 1),
           parent_code = nullif(regexp_replace(ok.code, '\.[^.]+$', ''), ok.code)
      from ok
     where a.reduced_code = ok.rc
       and a.hierarchical_code is distinct from ok.code
       and a.link_status <> 'confirmado_manual'
    returning a.reduced_code, a.name, ok.code
  ), aud as (
    insert into public.ledger_account_audit (period_id, account_key, account_name, field_changed, old_value, new_value, source, actor_id)
    select _period_id, upd.reduced_code, upd.name, 'hierarchical_code', null, upd.code, 'casamento_nome', auth.uid() from upd
    returning 1
  )
  select count(*) into v_by_name from aud;

  -- rodada 2: nome sem sufixo numérico/filial
  with cand as (
    select m.rc, t.code,
           count(*) over (partition by m.rc) as per_rc,
           count(*) over (partition by t.code) as per_code
    from _mov m
    join _tb t on public.norm_account_base(t.name) = public.norm_account_base(m.nm)
    where not exists (select 1 from public.ledger_accounts a where a.reduced_code = m.rc and a.hierarchical_code is not null)
      and not exists (select 1 from _locked k where k.reduced_code = m.rc)
      and not exists (select 1 from public.ledger_accounts a2 where a2.hierarchical_code = t.code)
      and public.norm_account_base(t.name) <> ''
  ), ok as (select rc, code from cand where per_rc = 1 and per_code = 1),
  upd as (
    update public.ledger_accounts a
       set hierarchical_code = ok.code,
           nature = coalesce(a.nature, public.nature_from_code(ok.code)),
           link_status = 'sugerido', confidence = 0.85,
           level = array_length(string_to_array(ok.code, '.'), 1),
           parent_code = nullif(regexp_replace(ok.code, '\.[^.]+$', ''), ok.code)
      from ok
     where a.reduced_code = ok.rc
    returning a.reduced_code, a.name, ok.code
  ), aud as (
    insert into public.ledger_account_audit (period_id, account_key, account_name, field_changed, old_value, new_value, source, actor_id)
    select _period_id, upd.reduced_code, upd.name, 'hierarchical_code', null, upd.code, 'casamento_nome_base', auth.uid() from upd
    returning 1
  )
  select count(*) into v_by_base from aud;

  -- rodada 3: confronto de débito e crédito
  with cand as (
    select m.rc, t.code,
           count(*) over (partition by m.rc) as per_rc,
           count(*) over (partition by t.code) as per_code
    from _mov m
    join _tb t on round(t.debito,2) = round(m.deb,2) and round(t.credito,2) = round(m.cred,2)
    where (m.deb <> 0 or m.cred <> 0)
      and not exists (select 1 from public.ledger_accounts a where a.reduced_code = m.rc and a.hierarchical_code is not null)
      and not exists (select 1 from _locked k where k.reduced_code = m.rc)
      and not exists (select 1 from public.ledger_accounts a2 where a2.hierarchical_code = t.code)
  ), ok as (select rc, code from cand where per_rc = 1 and per_code = 1),
  upd as (
    update public.ledger_accounts a
       set hierarchical_code = ok.code,
           nature = coalesce(a.nature, public.nature_from_code(ok.code)),
           link_status = 'sugerido', confidence = 0.8,
           level = array_length(string_to_array(ok.code, '.'), 1),
           parent_code = nullif(regexp_replace(ok.code, '\.[^.]+$', ''), ok.code)
      from ok
     where a.reduced_code = ok.rc
    returning a.reduced_code, a.name, ok.code
  ), aud as (
    insert into public.ledger_account_audit (period_id, account_key, account_name, field_changed, old_value, new_value, source, actor_id)
    select _period_id, upd.reduced_code, upd.name, 'hierarchical_code', null, upd.code, 'casamento_valor', auth.uid() from upd
    returning 1
  )
  select count(*) into v_by_value from aud;

  -- rodada 4: saldo final coincidente
  with cand as (
    select m.rc, t.code,
           count(*) over (partition by m.rc) as per_rc,
           count(*) over (partition by t.code) as per_code
    from _mov m
    join _tb t on round(abs(m.abertura + m.deb - m.cred), 2) = round(abs(t.saldo_atual), 2)
    where round(abs(t.saldo_atual),2) <> 0
      and not exists (select 1 from public.ledger_accounts a where a.reduced_code = m.rc and a.hierarchical_code is not null)
      and not exists (select 1 from _locked k where k.reduced_code = m.rc)
      and not exists (select 1 from public.ledger_accounts a2 where a2.hierarchical_code = t.code)
  ), ok as (select rc, code from cand where per_rc = 1 and per_code = 1),
  upd as (
    update public.ledger_accounts a
       set hierarchical_code = ok.code,
           nature = coalesce(a.nature, public.nature_from_code(ok.code)),
           link_status = 'sugerido', confidence = 0.7,
           level = array_length(string_to_array(ok.code, '.'), 1),
           parent_code = nullif(regexp_replace(ok.code, '\.[^.]+$', ''), ok.code)
      from ok
     where a.reduced_code = ok.rc
    returning a.reduced_code, a.name, ok.code
  ), aud as (
    insert into public.ledger_account_audit (period_id, account_key, account_name, field_changed, old_value, new_value, source, actor_id)
    select _period_id, upd.reduced_code, upd.name, 'hierarchical_code', null, upd.code, 'casamento_saldo', auth.uid() from upd
    returning 1
  )
  select count(*) into v_by_balance from aud;

  -- rodada 5: natureza a partir do código já vinculado
  with upd as (
    update public.ledger_accounts a
       set nature = public.nature_from_code(a.hierarchical_code)
     where a.hierarchical_code is not null
       and a.nature is null
       and public.nature_from_code(a.hierarchical_code) is not null
       and exists (select 1 from _mov m where m.rc = a.reduced_code)
    returning a.reduced_code, a.name, a.nature
  ), aud as (
    insert into public.ledger_account_audit (period_id, account_key, account_name, field_changed, old_value, new_value, source, actor_id)
    select _period_id, upd.reduced_code, upd.name, 'nature', null, upd.nature, 'natureza_por_codigo', auth.uid() from upd
    returning 1
  )
  select count(*) into v_nature from aud;

  select count(*) into v_pending
  from public.ledger_accounts a
  where exists (select 1 from _mov m where m.rc = a.reduced_code)
    and (a.hierarchical_code is null or a.nature is null);

  return jsonb_build_object(
    'por_nome', v_by_name, 'por_nome_base', v_by_base, 'por_valor', v_by_value,
    'por_saldo', v_by_balance, 'natureza', v_nature, 'pendentes', v_pending,
    'protegidas', (select count(*) from _locked));
end $function$;