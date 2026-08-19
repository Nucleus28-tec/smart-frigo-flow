-- 1) Helper: padroniza codigo reduzido para 6 digitos
CREATE OR REPLACE FUNCTION public.norm_reduced_code(_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  select case
    when _code is null then null
    when btrim(_code) = '' then null
    when btrim(_code) ~ '^[0-9]{1,6}$' then lpad(btrim(_code), 6, '0')
    else btrim(_code)
  end
$$;

GRANT EXECUTE ON FUNCTION public.norm_reduced_code(text) TO authenticated, anon, service_role;

-- 2) Normaliza os dados ja gravados
UPDATE public.journal_legs
   SET account_reduced_code = public.norm_reduced_code(account_reduced_code)
 WHERE account_reduced_code IS DISTINCT FROM public.norm_reduced_code(account_reduced_code);

UPDATE public.journal_legs
   SET counterpart_reduced_code = public.norm_reduced_code(counterpart_reduced_code)
 WHERE counterpart_reduced_code IS DISTINCT FROM public.norm_reduced_code(counterpart_reduced_code);

UPDATE public.journal_account_openings
   SET account_reduced_code = public.norm_reduced_code(account_reduced_code)
 WHERE account_reduced_code IS DISTINCT FROM public.norm_reduced_code(account_reduced_code);

UPDATE public.ledger_accounts
   SET reduced_code = public.norm_reduced_code(reduced_code)
 WHERE reduced_code IS DISTINCT FROM public.norm_reduced_code(reduced_code)
   AND NOT EXISTS (
     SELECT 1 FROM public.ledger_accounts b
      WHERE b.reduced_code = public.norm_reduced_code(public.ledger_accounts.reduced_code)
        AND b.id <> public.ledger_accounts.id
   );

-- 3) Blindagem: qualquer origem futura entra normalizada
CREATE OR REPLACE FUNCTION public.normalize_journal_codes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
begin
  new.account_reduced_code := public.norm_reduced_code(new.account_reduced_code);
  if to_jsonb(new) ? 'counterpart_reduced_code' then
    new.counterpart_reduced_code := public.norm_reduced_code(new.counterpart_reduced_code);
  end if;
  return new;
end
$$;

DROP TRIGGER IF EXISTS trg_normalize_journal_legs_codes ON public.journal_legs;
CREATE TRIGGER trg_normalize_journal_legs_codes
BEFORE INSERT OR UPDATE ON public.journal_legs
FOR EACH ROW EXECUTE FUNCTION public.normalize_journal_codes();

DROP TRIGGER IF EXISTS trg_normalize_openings_codes ON public.journal_account_openings;
CREATE TRIGGER trg_normalize_openings_codes
BEFORE INSERT OR UPDATE ON public.journal_account_openings
FOR EACH ROW EXECUTE FUNCTION public.normalize_journal_codes();