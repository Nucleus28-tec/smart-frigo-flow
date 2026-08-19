do $$
declare
  v_admin uuid; v_period uuid; v_a text; v_b text; v_id uuid; v_res jsonb; v_cnt int;
begin
  select id into v_admin from public.profiles where role='admin' and is_active limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role','authenticated')::text, true);
  select id into v_period from public.accounting_periods where label='Junho/2026';
  select account_reduced_code into v_a from public.journal_legs where period_id=v_period limit 1;
  select account_reduced_code into v_b from public.journal_legs where period_id=v_period and account_reduced_code <> v_a limit 1;

  v_res := public.upsert_manual_journal_entry(v_period, v_a, v_b, '2026-06-15', 'TESTE-GER', 123.45, 'Teste gerenciador', null);
  v_id := (v_res->>'id')::uuid;
  raise notice 'insert: %', v_res;

  v_res := public.upsert_manual_journal_entry(v_period, v_a, v_b, '2026-06-16', 'TESTE-GER', 200, 'Teste gerenciador editado', v_id);
  raise notice 'update: %', v_res;
  v_id := (v_res->>'id')::uuid;

  select count(*) into v_cnt from public.journal_legs where doc_number='TESTE-GER' and status='ativo';
  raise notice 'pernas ativas apos edicao: %', v_cnt;

  v_res := public.cancel_journal_entry(v_id, 'teste');
  raise notice 'cancel: %', v_res;
  select count(*) into v_cnt from public.journal_legs where doc_number='TESTE-GER' and status='cancelado';
  raise notice 'pernas canceladas: %', v_cnt;

  delete from public.journal_legs where doc_number='TESTE-GER';
  delete from public.ledger_account_audit where account_key = 'TESTE-GER';
  raise notice 'limpeza concluida';
end $$;