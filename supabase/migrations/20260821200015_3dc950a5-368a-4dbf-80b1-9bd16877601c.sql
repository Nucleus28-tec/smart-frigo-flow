create or replace function public.statement_line_tree(
  _period_id uuid,
  _codes text[],
  _basis text default 'movimento'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_nodes jsonb;
begin
  if _period_id is null or _codes is null or array_length(_codes, 1) is null then
    return jsonb_build_object('nodes', '[]'::jsonb, 'basis', _basis);
  end if;

  with base as (
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
      max(s.valor) as valor
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
      l.valor
    from leaves l
  )
  select coalesce(jsonb_agg(to_jsonb(n) order by n.nivel, n.codigo), '[]'::jsonb)
    into v_nodes
  from nodes n;

  return jsonb_build_object('nodes', v_nodes, 'basis', _basis);
end;
$$;

grant execute on function public.statement_line_tree(uuid, text[], text) to authenticated;