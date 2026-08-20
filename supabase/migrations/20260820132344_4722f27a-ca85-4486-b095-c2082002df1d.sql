
create or replace function public.reopen_period(_period_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_period record; v_year int; v_month int; v_closing record; v_cancelled int := 0; v_post int[];
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores. Somente o Admin pode cancelar fechamentos.'; end if;

  select * into v_period from public.accounting_periods where id = _period_id;
  if not found then raise exception 'Período não encontrado.'; end if;

  v_year := extract(year from v_period.reference_month);
  v_month := extract(month from v_period.reference_month);

  if v_period.status <> 'fechado' then
    raise exception 'O período % não está fechado; não há fechamento a cancelar.', v_period.label;
  end if;

  if exists (select 1 from public.accounting_closings where year = v_year and kind = 'anual' and status = 'fechado') then
    raise exception 'O exercício % está fechado. Cancele primeiro o fechamento do exercício % e depois reabra os meses, do mais recente para o mais antigo.', v_year, v_year;
  end if;

  select array_agg(extract(month from p.reference_month)::int)
    into v_post
    from public.accounting_periods p
   where extract(year from p.reference_month) = v_year
     and extract(month from p.reference_month) > v_month
     and p.status = 'fechado';

  if v_post is not null and array_length(v_post, 1) > 0 then
    raise exception 'Ordem obrigatória: reabra antes % de %. A reabertura acontece do mês mais recente para o mais antigo.',
      public.month_names_pt(v_post), v_year;
  end if;

  select * into v_closing from public.accounting_closings
   where period_id = _period_id and kind = 'mensal' and status = 'fechado'
   order by closed_at desc limit 1;

  if v_closing.entry_group is not null then
    with upd as (
      update public.journal_legs
         set status = 'cancelado', cancelled_by = auth.uid(), cancelled_at = now(), updated_at = now()
       where entry_group = v_closing.entry_group and status = 'ativo'
      returning 1
    ) select count(*) into v_cancelled from upd;
  end if;

  if v_closing.id is not null then
    update public.accounting_closings
       set status = 'cancelado', reopened_by = auth.uid(), reopened_at = now()
     where id = v_closing.id;
  end if;

  update public.accounting_periods set status = 'aberto', updated_at = now() where id = _period_id;

  perform public.recalculate_period_indicators_internal(_period_id);
  perform public.log_activity('cancelou o fechamento do período ' || v_period.label,
    'accounting_periods', _period_id, jsonb_build_object('lancamentos_cancelados', v_cancelled));

  return jsonb_build_object('cancelled_legs', v_cancelled);
end $function$;
