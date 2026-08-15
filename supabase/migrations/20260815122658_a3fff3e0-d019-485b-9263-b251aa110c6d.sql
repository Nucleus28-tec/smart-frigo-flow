-- 1) Trilha de auditoria
create table if not exists public.ledger_account_audit (
  id uuid primary key default gen_random_uuid(),
  period_id uuid references public.accounting_periods(id) on delete set null,
  entity_type text not null default 'ledger_accounts',
  account_key text not null,
  account_name text,
  field_changed text not null,
  old_value text,
  new_value text,
  source text not null default 'manual',
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

grant select on public.ledger_account_audit to authenticated;
grant all on public.ledger_account_audit to service_role;

alter table public.ledger_account_audit enable row level security;

create policy "audit_select_authenticated" on public.ledger_account_audit
  for select to authenticated using (true);

create index if not exists idx_ledger_audit_key on public.ledger_account_audit (account_key, created_at desc);
create index if not exists idx_ledger_audit_period on public.ledger_account_audit (period_id, created_at desc);

-- 2) Nome normalizado sem sufixo numérico/filial
create or replace function public.norm_account_base(_name text)
returns text language sql immutable set search_path = public as $$
  select regexp_replace(
           regexp_replace(public.norm_account_name(_name), '(FILIAL|MATRIZ|UNIDADE)?[0-9]+$', '', 'g'),
           '[0-9]+$', '', 'g')
$$;

-- 3) Casamento automático com rodadas adicionais + auditoria
create or replace function public.link_reduced_accounts(_period_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
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

  -- rodada 1: nome normalizado exato
  with cand as (
    select m.rc, t.code,
           count(*) over (partition by m.rc) as per_rc,
           count(*) over (partition by t.code) as per_code
    from _mov m
    join _tb t on public.norm_account_name(t.name) = public.norm_account_name(m.nm)
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
    'by_name', v_by_name, 'by_base_name', v_by_base, 'by_value', v_by_value,
    'by_balance', v_by_balance, 'nature_filled', v_nature, 'pending', v_pending);
end $$;

-- 4) Relatório de pendências com causa provável
create or replace function public.journal_pending_report(_period_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with mov as (
    select a.reduced_code, a.name, a.hierarchical_code, a.nature,
           sum(l.debit) as deb, sum(l.credit) as cred
    from public.journal_legs l
    join public.ledger_accounts a on a.id = l.account_id
    where l.period_id = _period_id
    group by a.reduced_code, a.name, a.hierarchical_code, a.nature
  ), tb as (
    select code, name, debito, credito
    from public.trial_balance_lines
    where period_id = _period_id and is_analytic
  ), cand as (
    select m.reduced_code, count(t.code) as candidatos
    from mov m
    left join tb t on public.norm_account_base(t.name) = public.norm_account_base(m.name)
    where m.hierarchical_code is null
    group by m.reduced_code
  ), rows as (
    -- sem vínculo hierárquico
    select m.reduced_code, m.name, null::text as code,
           case when coalesce(c.candidatos,0) = 0 then 'sem_candidato'
                when c.candidatos > 1 then 'varios_candidatos'
                else 'candidato_ambiguo' end as causa,
           case when coalesce(c.candidatos,0) = 0
                then 'Conta nova no razão, ausente no balancete deste período.'
                else c.candidatos || ' conta(s) do balancete têm nome equivalente.' end as detalhe,
           'Vincular manualmente em Razão › Vínculos.' as acao,
           0::numeric as delta
    from mov m left join cand c on c.reduced_code = m.reduced_code
    where m.hierarchical_code is null

    union all
    -- vinculada mas sem natureza
    select m.reduced_code, m.name, m.hierarchical_code, 'sem_natureza',
           'Natureza indefinida para o código ' || m.hierarchical_code || '.',
           'Definir a natureza contábil da conta.', 0
    from mov m
    where m.hierarchical_code is not null and m.nature is null

    union all
    -- divergência de valor
    select m.reduced_code, m.name, m.hierarchical_code, 'diferenca_valor',
           'Razão D ' || round(m.deb,2) || ' / C ' || round(m.cred,2) ||
           ' × Balancete D ' || round(t.debito,2) || ' / C ' || round(t.credito,2) || '.',
           'Conferir lançamentos da conta no período.',
           round((m.deb - t.debito) + (m.cred - t.credito), 2)
    from mov m join tb t on t.code = m.hierarchical_code
    where round(m.deb,2) <> round(t.debito,2) or round(m.cred,2) <> round(t.credito,2)

    union all
    -- só no balancete
    select null, t.name, t.code, 'so_balancete',
           'Conta do balancete sem movimento correspondente no razão.',
           'Verificar se o razão foi importado por completo.', 0
    from tb t
    where not exists (select 1 from mov m where m.hierarchical_code = t.code)
      and (t.debito <> 0 or t.credito <> 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from rows),
    'por_causa', coalesce((select jsonb_object_agg(causa, n) from (
        select causa, count(*) as n from rows group by causa) g), '{}'::jsonb),
    'linhas', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select * from rows order by causa, coalesce(code, reduced_code) limit 1000) x), '[]'::jsonb)
  );
$$;

-- 5) Contrapartidas mais frequentes de uma conta
create or replace function public.journal_top_counterparts(_period_id uuid, _reduced_code text, _limit integer default 10)
returns jsonb language sql stable security definer set search_path = public as $$
  with base as (
    select l.counterpart_reduced_code as rc, c.name as nome,
           count(*) as ocorrencias,
           sum(l.debit) as debito, sum(l.credit) as credito
    from public.journal_legs l
    left join public.ledger_accounts c on c.reduced_code = l.counterpart_reduced_code
    where l.period_id = _period_id and l.account_reduced_code = _reduced_code
      and l.counterpart_reduced_code is not null
    group by l.counterpart_reduced_code, c.name
  ), tot as (select coalesce(sum(ocorrencias),0)::numeric as t from base)
  select jsonb_build_object(
    'conta', _reduced_code,
    'total_lancamentos', (select t from tot),
    'contrapartidas', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select b.rc as codigo_reduzido, b.nome, b.ocorrencias, b.debito, b.credito,
             case when (select t from tot) > 0
                  then round(100 * b.ocorrencias / (select t from tot), 1) else 0 end as percentual
      from base b order by b.ocorrencias desc limit greatest(1, least(_limit, 50))) x), '[]'::jsonb)
  );
$$;

-- 6) Auditoria na confirmação manual de vínculo
create or replace function public.set_account_link(_reduced_code text, _hierarchical_code text, _nature text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old record;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;

  select hierarchical_code, nature, name into v_old
  from public.ledger_accounts where reduced_code = _reduced_code;
  if not found then raise exception 'Conta não encontrada.'; end if;

  update public.ledger_accounts
     set hierarchical_code = coalesce(nullif(_hierarchical_code,''), hierarchical_code),
         nature = coalesce(nullif(_nature,''), nature, public.nature_from_code(_hierarchical_code)),
         link_status = 'confirmado_manual',
         confidence = 1,
         level = array_length(string_to_array(coalesce(nullif(_hierarchical_code,''), hierarchical_code), '.'), 1),
         updated_by = auth.uid()
   where reduced_code = _reduced_code;

  if nullif(_hierarchical_code,'') is not null and _hierarchical_code is distinct from v_old.hierarchical_code then
    insert into public.ledger_account_audit (account_key, account_name, field_changed, old_value, new_value, source, actor_id)
    values (_reduced_code, v_old.name, 'hierarchical_code', v_old.hierarchical_code, _hierarchical_code, 'confirmacao_manual', auth.uid());
  end if;
  if nullif(_nature,'') is not null and _nature is distinct from v_old.nature then
    insert into public.ledger_account_audit (account_key, account_name, field_changed, old_value, new_value, source, actor_id)
    values (_reduced_code, v_old.name, 'nature', v_old.nature, _nature, 'confirmacao_manual', auth.uid());
  end if;

  return jsonb_build_object('ok', true);
end $$;

-- 7) Auditoria nas decisões de reclassificação
create or replace function public.apply_reclassification_decision(_suggestion_id uuid, _decision text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; v_updated int := 0; v_name text; v_old text;
begin
  if not public.is_admin() then
    raise exception 'Acesso restrito a administradores.';
  end if;
  if _decision not in ('aprovada','rejeitada') then
    raise exception 'Decisão inválida.';
  end if;

  select * into s from public.reclassification_suggestions where id = _suggestion_id;
  if not found then raise exception 'Sugestão não encontrada.'; end if;
  if s.status <> 'pendente' then raise exception 'Sugestão já decidida.'; end if;

  update public.reclassification_suggestions
     set status = _decision, decided_by = auth.uid(), decided_at = now()
   where id = _suggestion_id;

  if _decision = 'aprovada' and s.account_id is not null then
    select source_name, nature into v_name, v_old from public.chart_of_accounts where id = s.account_id;

    update public.chart_of_accounts
       set nature = s.suggested_nature,
           is_confirmed = true,
           times_confirmed = times_confirmed + 1,
           updated_by = auth.uid()
     where id = s.account_id;

    with upd as (
      update public.ledger_entries e
         set nature = s.suggested_nature, updated_by = auth.uid()
       where e.account_id = s.account_id
         and e.period_id = s.period_id
         and e.is_manually_edited = false
         and e.nature is distinct from s.suggested_nature
      returning 1
    )
    select count(*) into v_updated from upd;

    insert into public.ledger_account_audit
      (period_id, entity_type, account_key, account_name, field_changed, old_value, new_value, source, actor_id)
    values (s.period_id, 'chart_of_accounts', s.account_id::text, v_name, 'nature', v_old, s.suggested_nature, 'reclassificacao_aprovada', auth.uid());

    update public.reclassification_suggestions
       set status = 'aprovada', decided_by = auth.uid(), decided_at = now()
     where account_id = s.account_id
       and period_id = s.period_id
       and status = 'pendente'
       and suggested_nature = s.suggested_nature;
  end if;

  return jsonb_build_object('status', _decision, 'entries_updated', v_updated);
end;
$$;

revoke all on function public.journal_pending_report(uuid) from anon;
revoke all on function public.journal_top_counterparts(uuid, text, integer) from anon;
revoke all on function public.link_reduced_accounts(uuid) from anon;
revoke all on function public.set_account_link(text, text, text) from anon;
revoke all on function public.apply_reclassification_decision(uuid, text) from anon;