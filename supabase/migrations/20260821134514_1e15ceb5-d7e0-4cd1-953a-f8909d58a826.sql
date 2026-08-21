ALTER TABLE public.imported_files DROP CONSTRAINT IF EXISTS imported_files_processing_status_check;
ALTER TABLE public.imported_files ADD CONSTRAINT imported_files_processing_status_check
  CHECK (processing_status = ANY (ARRAY['pendente','processando','processado','processado_com_alertas','erro']));

CREATE OR REPLACE FUNCTION public.journal_import_diagnostics(_period_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_docs jsonb; v_falta jsonb; v_res jsonb;
  v_contas int; v_contas_ant int; v_label text; v_label_ant text;
  v_deb numeric; v_cred numeric;
begin
  select label into v_label from public.accounting_periods where id = _period_id;
  if v_label is null then raise exception 'Período % não encontrado.', _period_id; end if;

  select coalesce(sum(debit),0), coalesce(sum(credit),0), count(distinct account_reduced_code)
    into v_deb, v_cred, v_contas
    from public.journal_legs where period_id = _period_id and status = 'ativo';

  select pa.label, count(distinct l.account_reduced_code)
    into v_label_ant, v_contas_ant
    from public.accounting_periods pc
    join public.accounting_periods pa
      on pa.reference_month = (select max(reference_month) from public.accounting_periods
                                where reference_month < pc.reference_month)
    left join public.journal_legs l on l.period_id = pa.id and l.status = 'ativo'
   where pc.id = _period_id
   group by pa.label;

  -- 1) documentos em que débito <> crédito
  with d as (
    select doc_number,
           min(entry_date) as entry_date,
           count(*) as legs,
           round(sum(debit),2) as debito,
           round(sum(credit),2) as credito,
           round(sum(debit) - sum(credit),2) as diferenca,
           min(account_reduced_code) as conta,
           min(counterpart_reduced_code) as contrapartida,
           min(historico) as historico
      from public.journal_legs
     where period_id = _period_id and status = 'ativo' and doc_number is not null
     group by doc_number
    having round(sum(debit) - sum(credit),2) <> 0
  )
  select coalesce(jsonb_agg(to_jsonb(d) order by abs(d.diferenca) desc), '[]'::jsonb)
    into v_docs from d;

  -- 2) contrapartidas citadas que não têm conta no período
  with c as (
    select l.counterpart_reduced_code as codigo,
           count(*) as ocorrencias,
           round(sum(l.debit + l.credit),2) as valor,
           min(l.doc_number) as primeiro_doc,
           min(l.entry_date) as primeira_data,
           (select a.name from public.ledger_accounts a
             where a.reduced_code = l.counterpart_reduced_code limit 1) as nome
      from public.journal_legs l
     where l.period_id = _period_id and l.status = 'ativo'
       and l.counterpart_reduced_code is not null
       and not exists (
         select 1 from public.journal_legs x
          where x.period_id = _period_id and x.status = 'ativo'
            and x.account_reduced_code = l.counterpart_reduced_code)
     group by l.counterpart_reduced_code
  )
  select coalesce(jsonb_agg(to_jsonb(c) order by c.ocorrencias desc), '[]'::jsonb)
    into v_falta from c;

  v_res := jsonb_build_object(
    'period_id', _period_id,
    'period_label', v_label,
    'previous_label', v_label_ant,
    'accounts', v_contas,
    'accounts_prev', v_contas_ant,
    'debit', round(v_deb,2),
    'credit', round(v_cred,2),
    'difference', round(v_deb - v_cred,2),
    'unbalanced_docs', v_docs,
    'missing_counterparts', v_falta
  );
  return v_res;
end $function$;

GRANT EXECUTE ON FUNCTION public.journal_import_diagnostics(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.finalize_journal_import(_file_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_period uuid;
  v_legs int; v_contas int; v_deb numeric; v_cred numeric; v_dif numeric;
  v_enc int; v_saldos int; v_contas_ant int; v_saldos_ant int;
  v_alertas text[] := '{}';
  v_diag jsonb; v_docs int; v_falta int;
  v_status text;
begin
  if not public.is_admin() then raise exception 'Acesso restrito a administradores.'; end if;
  select period_id into v_period from public.imported_files where id = _file_id;
  if v_period is null then raise exception 'Arquivo % não encontrado.', _file_id; end if;

  select count(*), count(distinct account_reduced_code),
         coalesce(sum(debit),0), coalesce(sum(credit),0),
         count(*) filter (where is_closing)
    into v_legs, v_contas, v_deb, v_cred, v_enc
    from public.journal_legs where file_id = _file_id and status = 'ativo';

  select count(*) into v_saldos
    from public.journal_account_openings where period_id = v_period;

  v_dif := round(v_deb - v_cred, 2);

  select count(distinct l.account_reduced_code),
         (select count(*) from public.journal_account_openings o where o.period_id = pa.id)
    into v_contas_ant, v_saldos_ant
    from public.accounting_periods pc
    join public.accounting_periods pa
      on pa.reference_month = (select max(reference_month) from public.accounting_periods
                                where reference_month < pc.reference_month)
    left join public.journal_legs l on l.period_id = pa.id and l.status = 'ativo'
   where pc.id = v_period
   group by pa.id;

  v_diag := public.journal_import_diagnostics(v_period);
  v_docs := jsonb_array_length(v_diag->'unbalanced_docs');
  v_falta := jsonb_array_length(v_diag->'missing_counterparts');

  if v_dif <> 0 then
    v_alertas := v_alertas || format('Débito e crédito não fecham: diferença de %s.', v_dif);
  end if;
  if v_docs > 0 then
    v_alertas := v_alertas || format('%s documento(s) com débito diferente do crédito.', v_docs);
  end if;
  if v_falta > 0 then
    v_alertas := v_alertas || format('%s contrapartida(s) citadas sem conta no período (perna ausente no arquivo do G2).', v_falta);
  end if;
  if v_contas_ant is not null and v_contas < (v_contas_ant * 0.85)::int then
    v_alertas := v_alertas || format('Possível truncamento: %s contas neste período contra %s no anterior.', v_contas, v_contas_ant);
  end if;
  if v_saldos_ant is not null and v_saldos < (v_saldos_ant * 0.85)::int then
    v_alertas := v_alertas || format('Possível truncamento: %s saldos anteriores contra %s no período anterior.', v_saldos, v_saldos_ant);
  end if;
  if v_enc > 0 then
    v_alertas := v_alertas || format('%s lançamentos de encerramento entraram na base. O razão do G2 ainda veio fechado.', v_enc);
  end if;

  -- Erro é reservado para falha de gravação: se há lançamentos gravados, o arquivo
  -- foi importado e as divergências viram alertas de conferência.
  v_status := case
    when array_length(v_alertas,1) is null then 'processado'
    when v_legs > 0 then 'processado_com_alertas'
    else 'erro' end;

  update public.imported_files
     set processing_status = v_status,
         processing_error  = case when array_length(v_alertas,1) is null then null
                                  else array_to_string(v_alertas, ' ') end,
         updated_at = now()
   where id = _file_id;

  return jsonb_build_object('ok', array_length(v_alertas,1) is null,
    'status', v_status,
    'legs', v_legs, 'accounts', v_contas, 'openings', v_saldos,
    'debit', round(v_deb,2), 'credit', round(v_cred,2), 'difference', v_dif,
    'closing_legs', v_enc, 'accounts_prev', v_contas_ant, 'openings_prev', v_saldos_ant,
    'unbalanced_docs', v_docs, 'missing_counterparts', v_falta,
    'warnings', to_jsonb(v_alertas));
end $function$;