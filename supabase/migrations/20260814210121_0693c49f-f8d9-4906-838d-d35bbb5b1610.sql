CREATE TABLE public.agent_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  agent text NOT NULL DEFAULT 'contador',
  period_id uuid REFERENCES public.accounting_periods(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'Nova conversa',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_threads_user_idx ON public.agent_threads (user_id, updated_at DESC);

CREATE TABLE public.agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.agent_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL,
  parts jsonb NOT NULL DEFAULT '[]'::jsonb,
  client_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_messages_thread_idx ON public.agent_messages (thread_id, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_threads TO authenticated;
GRANT ALL ON public.agent_threads TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_messages TO authenticated;
GRANT ALL ON public.agent_messages TO service_role;

ALTER TABLE public.agent_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_threads_select ON public.agent_threads
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR is_admin());
CREATE POLICY agent_threads_insert ON public.agent_threads
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY agent_threads_update ON public.agent_threads
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY agent_threads_delete ON public.agent_threads
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE POLICY agent_messages_select ON public.agent_messages
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR is_admin());
CREATE POLICY agent_messages_insert ON public.agent_messages
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY agent_messages_delete ON public.agent_messages
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER agent_threads_set_updated_at
  BEFORE UPDATE ON public.agent_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();