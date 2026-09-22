import { createFileRoute } from "@tanstack/react-router";

// Espelho de mesma origem para a API do backend.
//
// Alguns navegadores/redes (extensões de bloqueio, VPN, proxy corporativo,
// DNS do provedor) bloqueiam o domínio direto do backend, o que impede o
// login com "Failed to fetch". Este endpoint repassa a mesma requisição a
// partir do servidor, usando a mesma origem do site — então nada é bloqueado.
//
// Segurança: apenas repassa credenciais do próprio usuário (apikey publishable
// + token do usuário). O RLS continua valendo exatamente igual ao acesso
// direto. Nenhuma chave de serviço é usada aqui.

const ALLOWED_PREFIXES = ["auth/v1", "rest/v1", "storage/v1", "realtime/v1", "functions/v1"];

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "accept-encoding",
]);

function baseUrl() {
  return (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
}

async function forward(request: Request, splat: string) {
  const path = splat.replace(/^\/+/, "");
  if (!ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return new Response(JSON.stringify({ error: "not_allowed" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  const base = baseUrl();
  if (!base) {
    return new Response(JSON.stringify({ error: "backend_unconfigured" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const incoming = new URL(request.url);
  const target = `${base}/${path}${incoming.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  if (!headers.get("apikey")) {
    const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
    if (key) headers.set("apikey", key);
  }

  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(target, { method, headers, body, redirect: "manual" });
  } catch (err) {
    console.error("[sb-proxy] upstream failed:", err);
    return new Response(JSON.stringify({ error: "upstream_unreachable" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }

  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === "content-encoding" || k === "content-length" || k === "transfer-encoding") return;
    outHeaders.set(key, value);
  });

  return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
}

export const Route = createFileRoute("/api/public/sb/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => forward(request, (params as { _splat?: string })._splat ?? ""),
      POST: ({ request, params }) => forward(request, (params as { _splat?: string })._splat ?? ""),
      PUT: ({ request, params }) => forward(request, (params as { _splat?: string })._splat ?? ""),
      PATCH: ({ request, params }) => forward(request, (params as { _splat?: string })._splat ?? ""),
      DELETE: ({ request, params }) => forward(request, (params as { _splat?: string })._splat ?? ""),
      OPTIONS: ({ request, params }) => forward(request, (params as { _splat?: string })._splat ?? ""),
    },
  },
});
