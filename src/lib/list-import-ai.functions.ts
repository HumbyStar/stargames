import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  rawLine: z.string(),
  sourceGroup: z.string().optional().default(""),
  warnings: z.array(z.string()).optional().default([]),
});

export type ListImportAIReview = {
  clientName: string | null;
  phone: string | null;
  productName: string | null;
  platformOrCategory: string | null;
  totalValue: number | null;
  paidValue: number | null;
  remainingValue: number | null;
  financialStatus: "Pago" | "Reserva" | "Pendente" | "Revisão necessária";
  sourceGroup: string | null;
  confidence: number;
  warnings: string[];
};

const SYSTEM = `Você corrige linhas de uma lista de vendas/reservas no formato:
"Nome - Telefone - Produto - Plataforma/Categoria - Valor - Status".

Regras:
- Telefone deve ser somente dígitos (10 ou 11), juntando DDD.
- O status ("Pago", "Reserva", "Reserva (65)", "Pendente", "MGMV") ENCERRA o registro: se houver texto depois dele, esse texto é OUTRO cliente e NÃO faz parte do produto — corrija a linha devolvendo apenas o PRIMEIRO cliente e registre em warnings "linha contém mais de um cliente".
- Corrija ruído: espaços no início/fim, espaços duplicados, traço colado, status em minúsculo ("reserva" -> "Reserva").
- "Reserva(65)", "Reserva 65" e "Reserva - 65" => financialStatus "Reserva" com paidValue 65.
- Se a linha tiver só 5 campos, a plataforma foi omitida: o campo do meio é o PRODUTO e platformOrCategory deve ser "—", com warning "plataforma ausente".
- Telefone com 10 dígitos: mantenha como veio e adicione warning "telefone com 10 dígitos — confirmar 9º dígito". Nunca invente dígitos.
- Status PAGO => paidValue = totalValue, remainingValue = 0.
- Status RESERVA (N) => paidValue = N, remainingValue = totalValue - N.
- Se faltar dado, retorne null no campo correspondente.
- NÃO INVENTE valores. Use confidence baixo quando incerto.
- Retorne APENAS JSON conforme o schema, sem texto adicional.

Schema esperado:
{
 "clientName": string|null,
 "phone": string|null,
 "productName": string|null,
 "platformOrCategory": string|null,
 "totalValue": number|null,
 "paidValue": number|null,
 "remainingValue": number|null,
 "financialStatus": "Pago"|"Reserva"|"Pendente"|"Revisão necessária",
 "sourceGroup": string|null,
 "confidence": number,
 "warnings": string[]
}`;

function normalize(raw: unknown, fallbackGroup: string): ListImportAIReview {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const allowedStatus = ["Pago", "Reserva", "Pendente", "Revisão necessária"] as const;
  const statusRaw = typeof r.financialStatus === "string" ? r.financialStatus : "Revisão necessária";
  const financialStatus = (allowedStatus.includes(statusRaw as (typeof allowedStatus)[number])
    ? statusRaw
    : "Revisão necessária") as ListImportAIReview["financialStatus"];
  return {
    clientName: str(r.clientName),
    phone: str(r.phone),
    productName: str(r.productName),
    platformOrCategory: str(r.platformOrCategory),
    totalValue: num(r.totalValue),
    paidValue: num(r.paidValue),
    remainingValue: num(r.remainingValue),
    financialStatus,
    sourceGroup: str(r.sourceGroup) ?? fallbackGroup ?? null,
    confidence: Math.max(0, Math.min(1, num(r.confidence) ?? 0)),
    warnings: Array.isArray(r.warnings) ? r.warnings.map((w) => String(w)) : [],
  };
}

export const reviewListImportLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<ListImportAIReview> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY ausente no servidor.");

    const body = {
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            `Grupo: ${data.sourceGroup || "(sem grupo)"}`,
            `Linha original:`,
            data.rawLine,
            data.warnings.length ? `Avisos atuais: ${data.warnings.join("; ")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
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
    return normalize(parsed, data.sourceGroup);
  });