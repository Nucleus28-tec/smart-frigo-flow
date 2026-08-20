select public.generate_period_statements(p.id)
from public.accounting_periods p
where exists (select 1 from public.journal_legs j where j.period_id = p.id and j.status = 'ativo');