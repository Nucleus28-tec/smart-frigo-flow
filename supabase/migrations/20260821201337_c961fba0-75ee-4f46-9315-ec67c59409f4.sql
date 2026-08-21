create or replace function public.set_account_excluded(
  _period_id uuid,
  _reduced_codes text[],
  _excluded boolean,
  _motivo text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_status text; v_new text; v_count int;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  if _period_id is null or _reduced_codes is null or array_length(_reduced_codes,1) is null then
    return jsonb_build_object('updated', 0);
  end if;

  select status into v_status from public.accounting_periods where id = _period_id;
  if v_status is null then raise exception 'Período não encontrado.'; end if;
  if v_status = 'fechado' then raise exception 'Período fechado: não é possível alterar lançamentos.'; end if;

  v_new := case when _excluded then 'oculto' else 'ativo' end;

  with upd as (
    update public.journal_legs l
       set status = v_new,
           excluded_reason = case when _excluded then nullif(btrim(coalesce(_motivo,'')),'') else null end,
           excluded_by = case when _excluded then auth.uid() else null end,
           excluded_at = case when _excluded then now() else null end,
           updated_at = now()
     where l.period_id = _period_id
       and l.status in ('ativo','oculto')
       and l.status <> v_new
       and l.account_reduced_code = any(_reduced_codes)
    returning 1
  )
  select count(*) into v_count from upd;

  insert into public.ledger_account_audit
    (period_id, entity_type, account_key, account_name, field_changed, old_value, new_value, source, actor_id)
  select _period_id, 'journal_legs', c,
         (select name from public.ledger_accounts where reduced_code = c),
         case when _excluded then 'conta_oculta' else 'conta_reexibida' end,
         null,
         coalesce(nullif(btrim(coalesce(_motivo,'')),''), v_new),
         'demonstrativos', auth.uid()
  from unnest(_reduced_codes) as c;

  perform public.log_activity(
    case when _excluded then 'account_hidden' else 'account_unhidden' end,
    'journal_legs', null,
    jsonb_build_object('period_id', _period_id, 'contas', _reduced_codes,
                       'motivo', _motivo, 'legs', v_count));

  perform public.recalculate_period_indicators_internal(_period_id);

  return jsonb_build_object('updated', v_count, 'status', v_new);
end $function$;

grant execute on function public.set_account_excluded(uuid, text[], boolean, text) to authenticated;

create or replace function public.statement_line_tree(_period_id uuid, _codes text[], _basis text default 'movimento'::text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_nodes jsonb;
begin
  if _period_id is null or _codes is null or array_length(_codes, 1) is null then
    return jsonb_build_object('nodes', '[]'::jsonb, 'basis', _basis);
  end if;

  with hid as (
    select l.account_reduced_code as reduced_code,
           count(*) filter (where l.status = 'oculto') as hidden_count,
           count(*) filter (where l.status in ('ativo','oculto')) as total_count
    from public.journal_legs l
    where l.period_id = _period_id
      and l.account_reduced_code = any(_codes)
    group by l.account_reduced_code
  ),
  base as (
    select
      b.reduced_code,
      b.account_name,
      rtrim(coalesce(la.hierarchical_code, b.hierarchical_code, ''), '.') as hier,
      b.nature,
      case
        when _basis = 'saldo' then
          case
            when b.nature in ('passivo_circulante','passivo_nao_circulante','patrimonio_liquido')
              then -b.closing_balance
            else b.closing_balance
          end
        else
          case
            when b.nature = 'receita' then b.credit_mov - b.debit_mov
            else b.debit_mov - b.credit_mov
          end
      end as valor
    from public.period_account_balances(_period_id) b
    left join public.ledger_accounts la on la.reduced_code = b.reduced_code
    where b.reduced_code = any(_codes)
  ),
  leaves as (
    select reduced_code, max(account_name) as account_name, max(hier) as hier,
           max(nature) as nature, sum(valor) as valor
    from base
    group by reduced_code
    union all
    select la.reduced_code, max(la.name), max(rtrim(coalesce(la.hierarchical_code,''), '.')),
           max(la.nature), 0::numeric
    from public.ledger_accounts la
    join hid h on h.reduced_code = la.reduced_code
    where la.reduced_code = any(_codes)
      and h.hidden_count > 0
      and not exists (select 1 from base b where b.reduced_code = la.reduced_code)
    group by la.reduced_code
  ),
  synth as (
    select sub.anc_hier as hier, sum(l.valor) as valor
    from leaves l
    cross join lateral (
      select array_to_string((string_to_array(l.hier, '.'))[1:n], '.') as anc_hier
      from generate_series(1, coalesce(array_length(string_to_array(l.hier, '.'), 1), 0) - 1) as n
    ) sub
    where coalesce(l.hier, '') <> ''
    group by sub.anc_hier
  ),
  nodes as (
    select
      s.hier as codigo,
      coalesce(max(la.name), 'Grupo ' || s.hier) as nome,
      array_length(string_to_array(s.hier, '.'), 1) as nivel,
      nullif(regexp_replace(s.hier, '\.[^.]+$', ''), s.hier) as parent,
      false as is_analytic,
      null::text as reduced_code,
      max(s.valor) as valor,
      0::bigint as hidden_count,
      0::bigint as total_count
    from synth s
    left join public.ledger_accounts la
      on rtrim(la.hierarchical_code, '.') = s.hier
     and coalesce(la.is_analytic, false) = false
    group by s.hier
    union all
    select
      coalesce(nullif(l.hier, ''), l.reduced_code) as codigo,
      l.account_name as nome,
      coalesce(array_length(string_to_array(nullif(l.hier, ''), '.'), 1), 1) as nivel,
      case
        when coalesce(l.hier, '') = '' then null
        else nullif(regexp_replace(l.hier, '\.[^.]+$', ''), l.hier)
      end as parent,
      true as is_analytic,
      l.reduced_code,
      l.valor,
      coalesce(h.hidden_count, 0) as hidden_count,
      coalesce(h.total_count, 0) as total_count
    from leaves l
    left join hid h on h.reduced_code = l.reduced_code
  )
  select coalesce(jsonb_agg(to_jsonb(n) order by n.nivel, n.codigo), '[]'::jsonb)
    into v_nodes
  from nodes n;

  return jsonb_build_object('nodes', v_nodes, 'basis', _basis);
end;
$function$;