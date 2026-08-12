create or replace function public.apply_reclassification_decision(_suggestion_id uuid, _decision text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare s record; v_updated int := 0;
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

grant execute on function public.apply_reclassification_decision(uuid, text) to authenticated;