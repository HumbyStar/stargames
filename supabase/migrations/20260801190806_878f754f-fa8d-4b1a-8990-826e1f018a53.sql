ALTER TABLE public.import_history REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.import_history;