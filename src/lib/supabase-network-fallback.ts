// Garante que o login e as consultas funcionem mesmo quando o navegador do
// usuário não consegue alcançar o domínio direto do backend (extensão de
// bloqueio, VPN, proxy, firewall ou DNS do provedor).
//
// Como funciona: interceptamos o fetch do navegador. A primeira tentativa é
// sempre direta. Se ela falhar por erro de rede, repetimos a mesma requisição
// pelo espelho de mesma origem (/api/public/sb/...) e, a partir daí, todas as
// chamadas seguintes já vão por ele — sem novo atraso.

const FLAG = "sb:use-proxy";
const PROXY_PREFIX = "/api/public/sb/";

let installed = false;

function backendOrigin(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function proxyMode(): boolean {
  try {
    return sessionStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

function setProxyMode() {
  try {
    sessionStorage.setItem(FLAG, "1");
  } catch {
    /* ignore */
  }
}

function toProxyUrl(url: string, origin: string): string {
  const u = new URL(url);
  if (u.origin !== origin) return url;
  return `${window.location.origin}${PROXY_PREFIX}${u.pathname.replace(/^\/+/, "")}${u.search}`;
}

function isNetworkError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed") ||
    msg.includes("fetch failed")
  );
}

export function installSupabaseNetworkFallback() {
  if (installed || typeof window === "undefined") return;
  const origin = backendOrigin();
  if (!origin) return;
  installed = true;

  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let url: string;
    try {
      url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    } catch {
      return original(input as RequestInfo, init);
    }

    if (!url.startsWith(origin)) return original(input as RequestInfo, init);

    if (proxyMode()) {
      const proxied = toProxyUrl(url, origin);
      if (typeof input === "string" || input instanceof URL) return original(proxied, init);
      const req = input as Request;
      return original(new Request(proxied, req), init);
    }

    try {
      return await original(input as RequestInfo, init);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      setProxyMode();
      const proxied = toProxyUrl(url, origin);
      if (typeof input === "string" || input instanceof URL) return original(proxied, init);
      const req = input as Request;
      return original(new Request(proxied, req), init);
    }
  };
}
