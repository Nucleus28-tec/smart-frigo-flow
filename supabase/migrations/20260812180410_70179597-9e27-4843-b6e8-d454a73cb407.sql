create policy "imports_select" on storage.objects for select to authenticated using (bucket_id = 'imports');
create policy "imports_insert" on storage.objects for insert to authenticated with check (bucket_id = 'imports');
create policy "imports_update" on storage.objects for update to authenticated using (bucket_id = 'imports' and public.is_admin()) with check (bucket_id = 'imports' and public.is_admin());
create policy "imports_delete" on storage.objects for delete to authenticated using (bucket_id = 'imports' and public.is_admin());