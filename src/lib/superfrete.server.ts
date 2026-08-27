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

/** URLs oficiais da SuperFrete. Produção é o padrão. */
const PRODUCTION_BASE_URL = "https://api.superfrete.com/api/v0";
const SANDBOX_BASE_URL = "https://sandbox.superfrete.com/api/v0";

export function getSuperfreteConfig(): SuperfreteConfig {
  const token = process.env["SUPERFRETE_API_TOKEN"];
  // Produção é o padrão; só usa sandbox quando explicitamente pedido.
  const environment =
    (process.env["SUPERFRETE_ENVIRONMENT"] || "production").toLowerCase() === "sandbox"
      ? "sandbox"
      : "production";
  const baseUrl =
    environment === "sandbox" ? SANDBOX_BASE_URL : PRODUCTION_BASE_URL;
  const userAgent = process.env["SUPERFRETE_USER_AGENT"] || "Star Games/1.0";
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

/** Nomes técnicos da API traduzidos para o vocabulário do assistente. */
const FIELD_LABELS: Record<string, string> = {
  "to.phone": "Telefone do destinatário",
  "to.document": "CPF/CNPJ do destinatário",
  "to.postal_code": "CEP do destinatário",
  "to.name": "Nome do destinatário",
  "to.address": "Endereço do destinatário",
  "to.number": "Número do destinatário",
  "to.city": "Cidade do destinatário",
  "to.state_abbr": "UF do destinatário",
  "from.phone": "Telefone do remetente",
  "from.document": "CPF/CNPJ do remetente",
  "from.postal_code": "CEP de origem",
  "correios.weight": "Peso (Correios)",
  package_dimensions_sum_or_weight: "Peso ou medidas da caixa",
  "volumes.weight": "Peso da caixa",
  service: "Serviço escolhido",
};

function labelFor(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/** Junta `message` + `errors` (campo → mensagens) num texto legível. */
function extractMessage(body: unknown): string | null {
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 400);
  if (!body || typeof body !== "object") return null;
  const r = body as Record<string, unknown>;

  const details: string[] = [];
  const errors = r["errors"];
  if (errors && typeof errors === "object" && !Array.isArray(errors)) {
    for (const [field, value] of Object.entries(errors as Record<string, unknown>)) {
      const msgs = Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : typeof value === "string"
          ? [value]
          : [];
      for (const m of msgs) details.push(`${labelFor(field)}: ${m}`);
    }
  } else if (Array.isArray(errors)) {
    for (const v of errors) if (typeof v === "string") details.push(v);
  } else if (typeof errors === "string" && errors.trim()) {
    details.push(errors.trim());
  }

  if (details.length > 0) return details.join(" · ").slice(0, 600);

  for (const key of ["message", "error", "detail"]) {
    const v = r[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v && typeof v === "object") {
      const first = Object.values(v as Record<string, unknown>)[0];
      if (typeof first === "string") return first;
      if (Array.isArray(first) && typeof first[0] === "string") return first[0];
    }
  }
  return null;
}


/** Procura recursivamente um valor de saldo na resposta da API. */
function findBalance(value: unknown, depth = 0): number | null {
  if (!value || typeof value !== "object" || depth > 4) return null;
  const obj = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (/^(balance|saldo|wallet_balance|current_balance|amount)$/i.test(k)) {
      const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
      if (Number.isFinite(n)) return n;
      const nested = findBalance(v, depth + 1);
      if (nested !== null) return nested;
    }
  }
  for (const v of Object.values(obj)) {
    const nested = findBalance(v, depth + 1);
    if (nested !== null) return nested;
  }
  return null;
}

/**
 * Saldo da carteira SuperFrete em centavos.
 *
 * A API expõe o saldo em `/user` (algumas contas em `/user/balance`); tentamos
 * os dois formatos e devolvemos `null` quando nenhum traz o campo.
 */
export async function fetchSuperfreteBalanceCents(): Promise<number | null> {
  const paths = ["/user", "/user/balance", "/balance"];
  for (const path of paths) {
    try {
      const raw = await superfreteRequest<unknown>(path, { method: "GET" });
      const value = findBalance(raw);
      if (value !== null) return Math.round(value * 100);
    } catch (e) {
      if (e instanceof SuperfreteError && (e.status === 401 || e.status === 403)) throw e;
      // 404/500 em um endpoint: tenta o próximo formato.
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
