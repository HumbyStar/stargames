import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  text: z.string().min(1).max(60_000),
});

export interface AIAnalyzedRow {
  line: number;
  name: string;
  phone: string;
  product: string;
  platform: string;
  totalValue: number | null;
  paidValue: number | null;
  financialStatus: "Pago" | "Reserva" | "Pendente" | "MGMV";
  situation: "Em Aberto" | "Enviado" | "Desistiu" | "Abandonou";
  notes?: string;
  fixes: string[];
  rawSnippet: string;
}

const SYSTEM = `Você é um analisador de listas brasileiras de vendas/reservas de produtos digitais.

OBJETIVO
- Receber um texto livre com várias linhas e devolver UMA LISTA de clientes/produtos.
- Para CADA cliente identificado, retorne um item no array "rows".
- Corrija erros óbvios (separadores ausentes, ortografia de status, telefones com lixo) e descreva cada correção em "fixes".

REGRAS DE LEITURA
- IGNORE linhas vazias, linhas só com data/cabeçalho, e linhas que começam com "Grupo", "GRUPO" ou "Grupo N:".
- Cada cliente tem a ordem: NOME -> TELEFONE -> PRODUTO -> PLATAFORMA -> VALOR -> STATUS.
- Leia da esquerda para a direita começando pelo nome. Tudo o que aparecer DEPOIS do status é o início de um novo cliente — mesmo que esteja na mesma linha.
- Telefone: somente dígitos, 10 ou 11 (junte DDD + número).
- Status financeiro normalizado: "Pago", "Reserva", "Pendente" ou "MGMV". "Reserva 50" significa status Reserva com paidValue=50.
- Se faltar plataforma, use "—". Se faltar valor numérico, deixe totalValue=null e descreva em fixes.
- Situação padrão é "Em Aberto" salvo se a linha disser claramente Enviado/Desistiu/Abandonou.

SAÍDA
Retorne APENAS JSON no formato:
{
  "rows": [
    {
      "line": number,                 // número da linha original onde o cliente começa (1-based)
      "name": string,
      "phone": string,                // só dígitos
      "product": string,
      "platform": string,
      "totalValue": number|null,
      "paidValue": number|null,
      "financialStatus": "Pago"|"Reserva"|"Pendente"|"MGMV",
      "situation": "Em Aberto"|"Enviado"|"Desistiu"|"Abandonou",
      "notes": string|null,
      "fixes": string[],              // descrição curta de cada correção aplicada
      "rawSnippet": string            // trecho original que originou esta linha
    }
  ]
}

Não invente dados. Se a linha for irreconhecível, ignore-a (não retorne nada para ela).`;

import { normalizeSituation } from "./situation-normalizer";

const STATUS_SET = new Set(["Pago", "Reserva", "Pendente", "MGMV"]);
// Buckets oficiais alinhados ao normalizador (Padronização Situação Notion).
const SITUATION_SET = new Set([
  "Em Aberto",
  "Enviado",
  "Retirado",
  "Retirar",
  "Removido",
  "Desistiu",
  "Abandonou",
]);

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}

function normalizeRow(raw: unknown, idx: number): AIAnalyzedRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const phone = str(r.phone).replace(/\D/g, "");
  let status = STATUS_SET.has(str(r.financialStatus) as any) ? (str(r.financialStatus) as AIAnalyzedRow["financialStatus"]) : "Pendente";
  // Passa a situação vinda da IA pelo normalizador canônico — se ela devolver
  // override financeiro (Pago/MGMV), respeita.
  const normalized = normalizeSituation(str(r.situation));
  let situation: AIAnalyzedRow["situation"];
  if (!normalized.unknown && normalized.situation && SITUATION_SET.has(normalized.situation)) {
    situation = normalized.situation as AIAnalyzedRow["situation"];
  } else {
    situation = "Em Aberto";
  }
  if (normalized.financialStatusOverride && STATUS_SET.has(normalized.financialStatusOverride)) {
    status = normalized.financialStatusOverride as AIAnalyzedRow["financialStatus"];
  }
  const name = str(r.name);
  const product = str(r.product);
  // Mínimo viável para considerar um cliente: nome OU telefone.
  if (!name && !phone) return null;
  const fixesRaw = Array.isArray(r.fixes) ? r.fixes.map((x) => String(x)).filter(Boolean) : [];
  return {
    line: Number.isFinite(Number(r.line)) ? Number(r.line) : idx + 1,
    name,
    phone,
    product,
    platform: str(r.platform) || "—",
    totalValue: num(r.totalValue),
    paidValue: num(r.paidValue),
    financialStatus: status,
    situation,
    notes: str(r.notes) || undefined,
    fixes: fixesRaw,
    rawSnippet: str(r.rawSnippet),
  };
}

export const analyzeListWithAI = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<{ rows: AIAnalyzedRow[] }> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY ausente no servidor.");

    const body = {
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: data.text },
      ],
      response_format: { type: "json_object" as const },
    };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Limite de uso da IA atingido. Tente novamente em instantes.");
      if (res.status === 402) throw new Error("Créditos de IA esgotados. Adicione créditos para continuar.");
      throw new Error(`Falha na chamada à IA (${res.status}): ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("A IA retornou um JSON inválido. Tente novamente.");
    }
    const rawRows = (parsed && typeof parsed === "object" && Array.isArray((parsed as any).rows))
      ? (parsed as { rows: unknown[] }).rows
      : [];
    const rows = rawRows
      .map((r, i) => normalizeRow(r, i))
      .filter((r): r is AIAnalyzedRow => !!r);
    return { rows };
  });