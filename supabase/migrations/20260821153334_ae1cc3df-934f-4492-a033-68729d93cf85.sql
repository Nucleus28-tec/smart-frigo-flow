-- largura do segmento conforme o nível
create or replace function public.hier_seg_width(_level int)
returns int language sql immutable as $$
  select case when _level <= 2 then 2 when _level = 3 then 2 when _level = 4 then 3 else 5 end
$$;

create or replace function public.move_ledger_accounts(_ids uuid[], _new_parent_hier text, _dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  _parent text := nullif(trim(coalesce(_new_parent_hier, '')), '');
  _prow public.ledger_accounts;
  _acc public.ledger_accounts;
  _seq int;
  _width int;
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

  _width := public.hier_seg_width(public.hier_level(_parent) + 1);

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

    _new_hier := _parent || lpad(_seq::text, _width, '0') || '.';
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
        link_status = 'confirmado_manual',
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
end $function$;

-- cria um grupo (sintética) filho de um ramo
create or replace function public.create_child_account(_parent_hier text, _name text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  _parent text := nullif(trim(coalesce(_parent_hier, '')), '');
  _prow public.ledger_accounts;
  _nm text := nullif(btrim(coalesce(_name, '')), '');
  _seq int; _width int; _new_hier text; _rc text; _id uuid;
begin
  if not public.is_admin() then raise exception 'Apenas o Admin pode criar grupos no plano de contas.'; end if;
  if _parent is null then raise exception 'Informe o grupo pai.'; end if;
  if _nm is null then raise exception 'Informe a descrição do grupo.'; end if;
  if right(_parent, 1) <> '.' then _parent := _parent || '.'; end if;

  select * into _prow from public.ledger_accounts where hierarchical_code = _parent;
  if not found then raise exception 'Grupo pai % não existe.', _parent; end if;
  if _prow.is_analytic then
    raise exception 'A conta % (%) é analítica — promova-a a sintética antes de criar filhas.',
      _prow.hierarchical_code, _prow.name;
  end if;

  _width := public.hier_seg_width(public.hier_level(_parent) + 1);
  select coalesce(max((regexp_replace(
           split_part(trim(both '.' from hierarchical_code), '.', public.hier_level(hierarchical_code)),
           '[^0-9]', '', 'g'))::int), 0) + 1
    into _seq
    from public.ledger_accounts where parent_code = _parent;

  _new_hier := _parent || lpad(_seq::text, _width, '0') || '.';
  _rc := 'S' || regexp_replace(_new_hier, '[^0-9]', '', 'g');
  while exists (select 1 from public.ledger_accounts where reduced_code = _rc) loop
    _rc := _rc || 'X';
  end loop;

  insert into public.ledger_accounts
    (reduced_code, hierarchical_code, name, level, parent_code, is_analytic, nature, link_status, updated_by)
  values (_rc, _new_hier, _nm, public.hier_level(_new_hier), _parent, false,
          public.nature_from_hierarchical(_new_hier), 'confirmado_manual', auth.uid())
  returning id into _id;

  insert into public.ledger_account_audit
    (entity_type, account_key, account_name, field_changed, old_value, new_value, source, actor_id)
  values ('ledger_account', _rc, _nm, 'criacao_grupo', null, _new_hier, 'plano_de_contas', auth.uid());

  return jsonb_build_object('id', _id, 'reduced_code', _rc, 'hierarchical_code', _new_hier, 'name', _nm);
end $function$;

revoke all on function public.create_child_account(text, text) from public;
grant execute on function public.create_child_account(text, text) to authenticated;
grant execute on function public.hier_seg_width(int) to authenticated, service_role;
