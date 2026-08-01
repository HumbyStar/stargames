CREATE OR REPLACE FUNCTION public.list_online_users(_window_seconds integer DEFAULT 120)
RETURNS TABLE(user_id uuid, user_email text, display_name text, last_seen timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_secs integer := LEAST(GREATEST(COALESCE(_window_seconds, 120), 30), 600);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_internal_role(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT s.user_id,
         u.email::text,
         p.display_name,
         s.last_seen
  FROM public.active_sessions s
  LEFT JOIN auth.users u ON u.id = s.user_id
  LEFT JOIN public.profiles p ON p.id = s.user_id
  WHERE s.last_seen > now() - make_interval(secs => v_secs)
  ORDER BY s.last_seen DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_online_users(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_online_users(integer) TO authenticated;