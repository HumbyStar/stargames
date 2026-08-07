REVOKE EXECUTE ON FUNCTION public.product_catalog(text, text, text, integer, integer, boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.product_reports(integer) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.product_catalog(text, text, text, integer, integer, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.product_reports(integer) TO authenticated, service_role;