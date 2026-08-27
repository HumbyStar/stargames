// Tratamento central de "sessão expirada" nas chamadas de servidor.
//
// As server functions protegidas lançam `Unauthorized: No authorization
// header provided` quando o token do Supabase não existe mais (sessão
// expirada, logout em outra aba). Sem tratamento isso vira erro não
// capturado e a tela fica em branco. Aqui detectamos esse caso e mandamos
// o usuário para /auth uma única vez.

export function isUnauthorizedError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /unauthorized/i.test(message);
}

let redirecting = false;

export function handleUnauthorized(error: unknown): boolean {
  if (!isUnauthorizedError(error)) return false;
  if (typeof window === "undefined") return true;
  if (redirecting) return true;
  redirecting = true;
  const current = window.location.pathname + window.location.search;
  const target = `/auth?redirect=${encodeURIComponent(current)}`;
  if (!window.location.pathname.startsWith("/auth")) {
    window.location.replace(target);
  }
  return true;
}
