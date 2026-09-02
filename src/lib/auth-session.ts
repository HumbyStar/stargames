import { supabase } from "@/integrations/supabase/client";

/** Códigos que indicam falta de credencial válida (GRANT/JWT), não falha de rede. */
const AUTH_ERROR_CODES = new Set(["42501", "PGRST301", "PGRST302"]);

/** Retorna true quando existe sessão Supabase válida no navegador. */
export async function hasActiveSession(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return Boolean(data.session);
  } catch {
    return false;
  }
}

/** Detecta erros de "permissão negada" causados por sessão ausente/expirada. */
export function isAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  const message = (err as { message?: string }).message ?? "";
  return (
    (code ? AUTH_ERROR_CODES.has(code) : false) ||
    /permission denied|jwt|not authenticated/i.test(message)
  );
}

let notified = false;

/**
 * Encerra a sessão local e devolve o usuário ao login. Executa uma única vez
 * para evitar múltiplos redirecionamentos em consultas paralelas.
 */
export function notifySessionExpired(): void {
  if (notified) return;
  notified = true;
  void (async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      /* já sem sessão */
    }
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/auth")) {
      window.location.assign("/auth?expired=1");
    }
  })();
}
