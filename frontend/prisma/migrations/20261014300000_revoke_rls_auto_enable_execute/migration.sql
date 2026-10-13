-- Supabase Security Advisor warnings "Public Can Execute SECURITY DEFINER Function" and
-- "Signed-In Users Can Execute SECURITY DEFINER Function" for public.rls_auto_enable().
-- That function is only meant to run from a database event trigger (which runs as the function owner, so it does not need these grants).
-- Nobody on the public API should be able to call it, so take the execute right away from everyone except the owner. Idempotent and safe:
-- it does nothing if the function does not exist, and it never touches the function body or the event trigger.
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;
  END IF;
END
$$;
