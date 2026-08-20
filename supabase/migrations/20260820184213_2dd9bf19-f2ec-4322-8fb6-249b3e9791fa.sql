-- recalcula todos os períodos que têm lançamentos nas contas informadas
create or replace function public.recalc_periods_for_accounts(_codes text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare _p uuid; _n int := 0;
begin
  for _p in
    select distinct l.period_id from public.journal_legs l
     where l.account_reduced_code = any(_codes)
  loop
    perform public.recalculate_period_indicators_internal(_p);
    begin
      perform public.generate_period_statements(_p);
    exception when others then null;
    end;
    _n := _n + 1;
  end loop;
  return _n;
end $$;

-- árvore do plano de contas
create or replace function public.chart_accounts_tree(
  _period_id uuid default null,
  _query text default null,
  _nature text default null,
  _only_pending boolean default false
) returns jsonb
language plpgsql
stable security definer
set search_path = public
as $$
declare _q text := nullif(trim(coalesce(_query, '')), ''); _rows jsonb;
begin
  with bal as (
    select b.reduced_code, b.closing_balance
      from public.period_account_balances(_period_id) b
     where _period_id is not null
  ), acc as (
    select a.*, coalesce(b.closing_balance, 0) as own_balance
      from public.ledger_accounts a
      left join bal b on b.reduced_code = a.reduced_code
  ), matched as (
    select a.id, a.hierarchical_code
      from acc a
     where (_q is null
            or txt_norm(a.name) like '%' || txt_norm(_q) || '%'
            or a.reduced_code like '%' || _q || '%'
            or coalesce(a.hierarchical_code, '') like '%' || _q || '%')
       and (_nature is null or a.nature = _nature)
       and (not _only_pending
            or a.nature is null or a.hierarchical_code is null or a.parent_code is null
            or a.nature is distinct from coalesce(public.nature_from_hierarchical(a.hierarchical_code), a.nature))
  ), keep as (
    select distinct a.id
      from acc a
      join matched m on m.id = a.id
                     or (a.hierarchical_code is not null
                         and coalesce(m.hierarchical_code, '') like a.hierarchical_code || '%')
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by coalesce(x.hierarchical_code, 'zzz'), x.reduced_code), '[]'::jsonb)
    into _rows
    from (
      select a.id, a.reduced_code, a.hierarchical_code, a.name, a.level, a.parent_code,
             a.is_analytic, a.nature, a.is_active, a.link_status,
             (m.id is not null) as matched,
             (select count(*) from public.ledger_accounts c where c.parent_code = a.hierarchical_code) as children_count,
             (select count(*) from public.journal_legs jl
               where jl.account_reduced_code = a.reduced_code
                 and (_period_id is null or jl.period_id = _period_id)) as legs_count,
             case when a.is_analytic or a.hierarchical_code is null then a.own_balance
                  else (select coalesce(sum(d.own_balance), 0) from acc d
                         where d.hierarchical_code like a.hierarchical_code || '%') end as balance
        from acc a
        join keep k on k.id = a.id
        left join matched m on m.id = a.id
    ) x;

  return jsonb_build_object('rows', _rows);
end $$;

-- mover contas para outro grupo (com prévia)
create or replace function public.move_ledger_accounts(
  _ids uuid[], _new_parent_hier text, _dry_run boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _parent text := nullif(trim(coalesce(_new_parent_hier, '')), '');
  _prow public.ledger_accounts;
  _acc public.ledger_accounts;
  _seq int;
  _new_hier text;
  _preview jsonb := '[]'::jsonb;
  _codes text[] := '{}';
  _moved int := 0;
begin
  if not public.is_admin() then raise exception 'Apenas o Admin pode reorganizar o plano de contas.'; end if;
  if _parent is null then raise exception 'Informe o grupo de destino.'; end if;
  if right(_parent, 1) <> '.' then _parent := _parent || '.'; end if;

  select * into _prow from public.ledger_accounts where hierarchical_code = _parent;
  if not found then raise exception 'Grupo de destino % não existe no plano de contas.', _parent; end if;
  if _prow.is_analytic then
    raise exception 'A conta de destino % (%) é analítica — promova-a a sintética antes de receber filhas.',
      _prow.hierarchical_code, _prow.name;
  end if;

  select coalesce(max((regexp_replace(
           split_part(trim(both '.' from hierarchical_code), '.', public.hier_level(hierarchical_code)),
           '[^0-9]', '', 'g'))::int), 0) + 1
    into _seq
    from public.ledger_accounts where parent_code = _parent;

  for _acc in
    select * from public.ledger_accounts
     where id = any(_ids) and hierarchical_code is not null
     order by hierarchical_code
  loop
    if exists (select 1 from public.ledger_accounts o
                where o.id = any(_ids) and o.id <> _acc.id
                  and o.hierarchical_code is not null
                  and _acc.hierarchical_code like o.hierarchical_code || '%') then
      continue;
    end if;
    if _parent like _acc.hierarchical_code || '%' then
      raise exception 'A conta % não pode ser movida para dentro dela mesma.', _acc.hierarchical_code;
    end if;

    _new_hier := _parent || lpad(_seq::text, 5, '0') || '.';
    _seq := _seq + 1;

    _preview := _preview || jsonb_build_object(
      'id', _acc.id, 'reduced_code', _acc.reduced_code, 'name', _acc.name,
      'de', _acc.hierarchical_code, 'para', _new_hier,
      'natureza_de', _acc.nature,
      'natureza_para', coalesce(public.nature_from_hierarchical(_new_hier), _acc.nature),
      'ramo', (select count(*) from public.ledger_accounts d
                where d.hierarchical_code like _acc.hierarchical_code || '%') - 1);

    if not _dry_run then
      _codes := _codes || array(
        select d.reduced_code from public.ledger_accounts d
         where d.hierarchical_code like _acc.hierarchical_code || '%');

      update public.ledger_accounts d set
        hierarchical_code = _new_hier || substr(d.hierarchical_code, length(_acc.hierarchical_code) + 1),
        level = public.hier_level(_new_hier || substr(d.hierarchical_code, length(_acc.hierarchical_code) + 1)),
        parent_code = public.hier_parent(_new_hier || substr(d.hierarchical_code, length(_acc.hierarchical_code) + 1)),
        nature = coalesce(
          public.nature_from_hierarchical(_new_hier || substr(d.hierarchical_code, length(_acc.hierarchical_code) + 1)),
          d.nature),
        link_status = 'confirmado',
        updated_by = auth.uid(),
        updated_at = now()
      where d.hierarchical_code like _acc.hierarchical_code || '%';

      insert into public.ledger_account_audit
        (entity_type, account_key, account_name, field_changed, old_value, new_value, source, actor_id)
      values ('ledger_account', _acc.reduced_code, _acc.name, 'movimentacao_hierarquia',
              coalesce(_acc.hierarchical_code, '—') || ' / ' || coalesce(_acc.nature, '—'),
              _new_hier || ' / ' || coalesce(public.nature_from_hierarchical(_new_hier), _acc.nature, '—'),
              'plano_de_contas', auth.uid());
    end if;

    _moved := _moved + 1;
  end loop;

  if _dry_run then
    return jsonb_build_object('dry_run', true, 'moved', _moved, 'preview', _preview);
  end if;

  return jsonb_build_object(
    'dry_run', false, 'moved', _moved, 'preview', _preview,
    'periods_recalculated', public.recalc_periods_for_accounts(_codes));
end $$;

-- promover / rebaixar conta (sintética <-> analítica)
create or replace function public.set_ledger_account_kind(_id uuid, _is_analytic boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare _acc public.ledger_accounts; _legs bigint; _kids bigint;
begin
  if not public.is_admin() then raise exception 'Apenas o Admin pode alterar o plano de contas.'; end if;
  select * into _acc from public.ledger_accounts where id = _id;
  if not found then raise exception 'Conta não encontrada.'; end if;
  if _acc.is_analytic = _is_analytic then
    return jsonb_build_object('id', _id, 'is_analytic', _is_analytic, 'changed', false);
  end if;

  select count(*) into _legs from public.journal_legs where account_reduced_code = _acc.reduced_code;
  select count(*) into _kids from public.ledger_accounts where parent_code = _acc.hierarchical_code;

  if not _is_analytic and _legs > 0 then
    raise exception 'A conta % tem % lançamento(s) e não pode virar sintética. Mova os lançamentos antes.',
      _acc.reduced_code, _legs;
  end if;
  if _is_analytic and _kids > 0 then
    raise exception 'A conta % tem % conta(s) filha(s) e não pode virar analítica.', _acc.reduced_code, _kids;
  end if;

  update public.ledger_accounts
     set is_analytic = _is_analytic, updated_by = auth.uid(), updated_at = now()
   where id = _id;

  insert into public.ledger_account_audit
    (entity_type, account_key, account_name, field_changed, old_value, new_value, source, actor_id)
  values ('ledger_account', _acc.reduced_code, _acc.name, 'tipo_conta',
          case when _acc.is_analytic then 'analitica' else 'sintetica' end,
          case when _is_analytic then 'analitica' else 'sintetica' end,
          'plano_de_contas', auth.uid());

  perform public.recalc_periods_for_accounts(array[_acc.reduced_code]);
  return jsonb_build_object('id', _id, 'is_analytic', _is_analytic, 'changed', true);
end $$;

-- renumerar as filhas de um grupo, sem furos
create or replace function public.renumber_branch(_parent_hier text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _parent text := nullif(trim(coalesce(_parent_hier, '')), '');
  _child public.ledger_accounts;
  _i int := 0;
  _new_hier text;
  _codes text[] := '{}';
begin
  if not public.is_admin() then raise exception 'Apenas o Admin pode renumerar o plano de contas.'; end if;
  if _parent is null then raise exception 'Informe o grupo.'; end if;
  if right(_parent, 1) <> '.' then _parent := _parent || '.'; end if;

  create temp table _renum(old_hier text, new_hier text) on commit drop;

  for _child in
    select * from public.ledger_accounts where parent_code = _parent order by hierarchical_code
  loop
    _i := _i + 1;
    _new_hier := _parent || lpad(_i::text, 5, '0') || '.';
    insert into _renum values (_child.hierarchical_code, _new_hier);
  end loop;

  -- escapa o ramo para evitar colisão de códigos durante a renumeração
  update public.ledger_accounts
     set hierarchical_code = '#' || hierarchical_code
   where hierarchical_code like _parent || '%' and hierarchical_code <> _parent;

  for _child in select * from public.ledger_accounts where 1 = 0 loop end loop;

  update public.ledger_accounts d set
    hierarchical_code = r.new_hier || substr(d.hierarchical_code, length(r.old_hier) + 2),
    level = public.hier_level(r.new_hier || substr(d.hierarchical_code, length(r.old_hier) + 2)),
    parent_code = public.hier_parent(r.new_hier || substr(d.hierarchical_code, length(r.old_hier) + 2)),
    updated_by = auth.uid(),
    updated_at = now()
  from _renum r
  where d.hierarchical_code like '#' || r.old_hier || '%';

  select array(select reduced_code from public.ledger_accounts where hierarchical_code like _parent || '%')
    into _codes;

  insert into public.ledger_account_audit
    (entity_type, account_key, account_name, field_changed, old_value, new_value, source, actor_id)
  values ('ledger_account', _parent, 'Grupo ' || _parent, 'renumeracao_ramo', _parent,
          _i::text || ' filha(s) renumerada(s)', 'plano_de_contas', auth.uid());

  perform public.recalc_periods_for_accounts(_codes);
  return jsonb_build_object('renumbered', _i);
end $$;

-- painel de auditoria do plano de contas
create or replace function public.chart_accounts_audit()
returns jsonb
language sql
stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'sem_posicao', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select id, reduced_code, name, hierarchical_code from public.ledger_accounts
         where hierarchical_code is null or parent_code is null and coalesce(level, 1) > 1
         order by reduced_code limit 200) x),
    'orfas', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select a.id, a.reduced_code, a.name, a.hierarchical_code from public.ledger_accounts a
         where a.hierarchical_code is not null and a.parent_code is null and coalesce(a.level, 1) > 1
         order by a.hierarchical_code limit 200) x),
    'sinteticas_sem_filhas', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select a.id, a.reduced_code, a.name, a.hierarchical_code from public.ledger_accounts a
         where not a.is_analytic
           and not exists (select 1 from public.ledger_accounts c where c.parent_code = a.hierarchical_code)
         order by a.hierarchical_code limit 200) x),
    'analiticas_sem_lancamento', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select a.id, a.reduced_code, a.name, a.hierarchical_code from public.ledger_accounts a
         where a.is_analytic
           and not exists (select 1 from public.journal_legs l where l.account_reduced_code = a.reduced_code)
         order by a.reduced_code limit 200) x),
    'natureza_incoerente', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select a.id, a.reduced_code, a.name, a.hierarchical_code, a.nature,
               public.nature_from_hierarchical(a.hierarchical_code) as nature_esperada
          from public.ledger_accounts a
         where a.hierarchical_code is not null
           and public.nature_from_hierarchical(a.hierarchical_code) is not null
           and a.nature is distinct from public.nature_from_hierarchical(a.hierarchical_code)
         order by a.hierarchical_code limit 200) x)
  )
$$;