/**
 * Cliente HTTP da SuperFrete (somente servidor).
 *
 * O token nunca sai daqui: todas as chamadas são feitas por server functions.
 * Os payloads gravados em log são sanitizados (sem cabeçalhos/credenciais).
 */

export interface SuperfreteConfig {
  baseUrl: string;
  token: string;
  userAgent: string;
  environment: string;
}

export class SuperfreteError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "SuperfreteError";
    this.status = status;
    this.body = body;
  }
}

export function getSuperfreteConfig(): SuperfreteConfig {
  const token = process.env["SUPERFRETE_API_TOKEN"];
  const baseUrl =
    process.env["SUPERFRETE_API_BASE_URL"] || "https://sandbox.superfrete.com/api/v0";
  const userAgent = process.env["SUPERFRETE_USER_AGENT"] || "Star Games/1.0";
  const environment = process.env["SUPERFRETE_ENVIRONMENT"] || "sandbox";
  if (!token) {
    throw new SuperfreteError(
      "Integração da SuperFrete não configurada (token ausente).",
      500,
      null,
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), token, userAgent, environment };
}

/** Chamada autenticada à API. Lança `SuperfreteError` em falha. */
export async function superfreteRequest<T = unknown>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" },
): Promise<T> {
  const cfg = getSuperfreteConfig();
  const url = `${cfg.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "User-Agent": cfg.userAgent,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    throw new SuperfreteError(
      e instanceof Error && e.name === "AbortError"
        ? "Tempo esgotado ao falar com a SuperFrete."
        : "Não foi possível contatar a SuperFrete.",
      0,
      null,
    );
  }
  clearTimeout(timeout);

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    console.error(`[SuperFrete] ${init.method} ${path} -> ${res.status}`, text.slice(0, 800));
    throw new SuperfreteError(extractMessage(parsed) ?? `Erro ${res.status}`, res.status, parsed);
  }
  return parsed as T;
}

function extractMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const r = body as Record<string, unknown>;
  for (const key of ["message", "error", "errors", "detail"]) {
    const v = r[key];
    if (typeof v === "string" && v.trim()) return v;
    if (v && typeof v === "object") {
      const first = Object.values(v as Record<string, unknown>)[0];
      if (typeof first === "string") return first;
      if (Array.isArray(first) && typeof first[0] === "string") return first[0];
    }
  }
  return null;
}

/** Remove qualquer credencial antes de gravar payloads/respostas no histórico. */
export function sanitizeForLog(value: unknown): unknown {
  const SENSITIVE = /(authorization|token|api[-_]?key|secret|password|cookie)/i;
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 6) return "[...]";
    if (Array.isArray(v)) return v.slice(0, 100).map((x) => walk(x, depth + 1));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = SENSITIVE.test(k) ? "[redacted]" : walk(val, depth + 1);
      }
      return out;
    }
    if (typeof v === "string" && v.length > 4000) return `${v.slice(0, 4000)}…`;
    return v;
  };
  return walk(value, 0);
}
