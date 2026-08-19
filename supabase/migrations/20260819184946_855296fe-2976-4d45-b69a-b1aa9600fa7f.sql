
CREATE OR REPLACE FUNCTION public.journal_report_analytic(
  _period_id uuid,
  _codes text[] DEFAULT NULL,
  _from date DEFAULT NULL,
  _to date DEFAULT NULL,
  _doc_number text DEFAULT NULL,
  _max_rows integer DEFAULT 20000
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _doc text := nullif(trim(coalesce(_doc_number, '')), '');
  _result jsonb;
BEGIN
  WITH sel AS (
    SELECT DISTINCT l.account_reduced_code AS code
    FROM public.journal_legs l
    WHERE l.period_id = _period_id
      AND l.status = 'ativo'
      AND (_codes IS NULL OR array_length(_codes, 1) IS NULL OR l.account_reduced_code = ANY(_codes))
      AND (_from IS NULL OR l.entry_date >= _from)
      AND (_to IS NULL OR l.entry_date <= _to)
      AND (_doc IS NULL OR coalesce(l.doc_number, '') = _doc)
  ),
  prev AS (
    SELECT l.account_reduced_code AS code, sum(l.debit - l.credit) AS delta
    FROM public.journal_legs l
    WHERE l.period_id = _period_id
      AND l.status = 'ativo'
      AND _from IS NOT NULL
      AND l.entry_date IS NOT NULL
      AND l.entry_date < _from
    GROUP BY 1
  ),
  acc AS (
    SELECT s.code,
           coalesce(a.name, o.account_name, s.code) AS name,
           a.hierarchical_code,
           coalesce(o.opening_balance, 0) + coalesce(p.delta, 0) AS opening_balance
    FROM sel s
    LEFT JOIN public.ledger_accounts a ON a.reduced_code = s.code
    LEFT JOIN public.journal_account_openings o
      ON o.period_id = _period_id AND o.account_reduced_code = s.code
    LEFT JOIN prev p ON p.code = s.code
  ),
  legs AS (
    SELECT l.account_reduced_code AS code,
           l.id, l.doc_number, l.entry_date, l.historico, l.debit, l.credit,
           l.counterpart_reduced_code,
           c.name AS counterpart_name,
           row_number() OVER (ORDER BY l.account_reduced_code, l.entry_date NULLS LAST, l.line_no, l.id) AS rn,
           sum(l.debit - l.credit) OVER (
             PARTITION BY l.account_reduced_code
             ORDER BY l.entry_date NULLS LAST, l.line_no, l.id
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ) AS cum
    FROM public.journal_legs l
    LEFT JOIN public.ledger_accounts c ON c.reduced_code = l.counterpart_reduced_code
    WHERE l.period_id = _period_id
      AND l.status = 'ativo'
      AND (_codes IS NULL OR array_length(_codes, 1) IS NULL OR l.account_reduced_code = ANY(_codes))
      AND (_from IS NULL OR l.entry_date >= _from)
      AND (_to IS NULL OR l.entry_date <= _to)
      AND (_doc IS NULL OR coalesce(l.doc_number, '') = _doc)
  ),
  capped AS (
    SELECT * FROM legs WHERE rn <= greatest(coalesce(_max_rows, 20000), 1)
  )
  SELECT jsonb_build_object(
    'period_id', _period_id,
    'from', _from,
    'to', _to,
    'doc_number', _doc,
    'truncated', (SELECT count(*) FROM legs) > (SELECT count(*) FROM capped),
    'accounts', coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.hierarchical_code NULLS LAST, x.code), '[]'::jsonb)
  )
  INTO _result
  FROM (
    SELECT a.code,
           a.name,
           a.hierarchical_code,
           a.opening_balance,
           coalesce((SELECT sum(g.debit) FROM capped g WHERE g.code = a.code), 0) AS total_debit,
           coalesce((SELECT sum(g.credit) FROM capped g WHERE g.code = a.code), 0) AS total_credit,
           a.opening_balance + coalesce((SELECT sum(g.debit - g.credit) FROM capped g WHERE g.code = a.code), 0) AS closing_balance,
           coalesce((SELECT count(*) FROM capped g WHERE g.code = a.code), 0) AS line_count,
           coalesce((
             SELECT jsonb_agg(to_jsonb(y) ORDER BY y.rn)
             FROM (
               SELECT g.id, g.doc_number, g.entry_date, g.historico, g.debit, g.credit,
                      g.counterpart_reduced_code, g.counterpart_name,
                      a.opening_balance + g.cum AS running_balance, g.rn
               FROM capped g
               WHERE g.code = a.code
             ) y
           ), '[]'::jsonb) AS lines
    FROM acc a
  ) x;

  RETURN _result;
END $$;

CREATE OR REPLACE FUNCTION public.trial_balance_report(
  _period_id uuid,
  _codes text[] DEFAULT NULL,
  _from date DEFAULT NULL,
  _to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _result jsonb;
BEGIN
  WITH mov AS (
    SELECT l.account_reduced_code AS code,
           sum(l.debit) AS debito,
           sum(l.credit) AS credito
    FROM public.journal_legs l
    WHERE l.period_id = _period_id
      AND l.status = 'ativo'
      AND (_codes IS NULL OR array_length(_codes, 1) IS NULL OR l.account_reduced_code = ANY(_codes))
      AND (_from IS NULL OR l.entry_date >= _from)
      AND (_to IS NULL OR l.entry_date <= _to)
    GROUP BY 1
  ),
  prev AS (
    SELECT l.account_reduced_code AS code, sum(l.debit - l.credit) AS delta
    FROM public.journal_legs l
    WHERE l.period_id = _period_id
      AND l.status = 'ativo'
      AND _from IS NOT NULL
      AND l.entry_date IS NOT NULL
      AND l.entry_date < _from
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'period_id', _period_id,
    'from', _from,
    'to', _to,
    'totals', jsonb_build_object(
      'debito', coalesce((SELECT sum(debito) FROM mov), 0),
      'credito', coalesce((SELECT sum(credito) FROM mov), 0)
    ),
    'rows', coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.hierarchical_code NULLS LAST, x.code), '[]'::jsonb)
  )
  INTO _result
  FROM (
    SELECT m.code,
           coalesce(a.name, o.account_name, m.code) AS name,
           a.hierarchical_code,
           a.nature,
           coalesce(a.is_analytic, true) AS is_analytic,
           coalesce(a.level, 0) AS level,
           coalesce(o.opening_balance, 0) + coalesce(p.delta, 0) AS saldo_anterior,
           m.debito,
           m.credito,
           coalesce(o.opening_balance, 0) + coalesce(p.delta, 0) + m.debito - m.credito AS saldo_atual
    FROM mov m
    LEFT JOIN public.ledger_accounts a ON a.reduced_code = m.code
    LEFT JOIN public.journal_account_openings o
      ON o.period_id = _period_id AND o.account_reduced_code = m.code
    LEFT JOIN prev p ON p.code = m.code
  ) x;

  RETURN _result;
END $$;

REVOKE ALL ON FUNCTION public.journal_report_analytic(uuid, text[], date, date, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trial_balance_report(uuid, text[], date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.journal_report_analytic(uuid, text[], date, date, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.trial_balance_report(uuid, text[], date, date) TO authenticated, service_role;
