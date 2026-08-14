drop policy if exists entries_update on public.ledger_entries;
create policy entries_update on public.ledger_entries
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists findings_update on public.audit_findings;
create policy findings_update on public.audit_findings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());