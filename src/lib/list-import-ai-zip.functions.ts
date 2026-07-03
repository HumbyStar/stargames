import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Revisão IA para importação de ZIP do Notion.
 *
 * Recebe as linhas parseadas de UM cliente + um recorte do HTML original
 * (para citação de evidências) e devolve sugestões por linha + resumo por
 * cliente, no mesmo padrão do "Revisar com IA" do MGMV.
 */

const RowInput = z.object({
  rowId: z.string(),
  sourceGroup: z.string().optional().default(""),
  productName: z.string().optional().default(""),
  platformOrCategory: z.string().optional().default(""),
  totalValue: z.number().nullable().optional().default(null),
  paidValue: z.number().nullable().optional().default(null),
  financialStatus: z.string().optional().default(""),
  rawSituation: z.string().optional().default(""),
  rawLine: z.string().optional().default(""),
});

const ReviewInput = z.object({
  clientName: z.string(),
  clientPhone: z.string().optional().default(""),
  htmlSnippet: z.string().optional().default(""),
  rows: z.array(RowInput).min(1),
});

export type ZipAiReviewInput = z.infer<typeof ReviewInput>;

export type ZipAiSituation =
  | "Retirado"
  | "Retirar"
  | "Enviado"
  | "Abandonou"
  | "Em Aberto"
  | "Revisar";

export type ZipAiFinancial = "Pago" | "Reserva" | "Pendente" | "Revisar";

export interface ZipAiRowSuggestion {
  rowId: string;
  situationSuggestion: ZipAiSituation;
  financialStatusSuggestion: ZipAiFinancial;
  totalValue: number | null;
  paidValue: number | null;
  confidence: number;
  evidence: string[];
  warnings: string[];
  needsReview: boolean;
}

export interface ZipAiClientReview {
  clientSummary: string;
  overallNeedsReview: boolean;
  duplicateGroups: string[][];
  rows: ZipAiRowSuggestion[];
}

const SYSTEM_PROMPT = `Você é um extrator/normalizador de dados de vendas exportadas do Notion.

Sua tarefa: analisar as linhas de UM cliente e sugerir a situação operacional,
o status financeiro, o valor total e o valor pago corretos, citando trechos
literais do HTML como evidência.

Regras de mapeamento da coluna "Situação":
- "REMOVIDO" na origem = cliente desistiu do produto -> use situationSuggestion="Retirado" (na terminologia do sistema significa "removido do estoque").
- "RETIRAR" -> situationSuggestion="Retirar".
- "RETIRADO" -> situationSuggestion="Retirado".
- "ENVIADO" -> situationSuggestion="Enviado".
- "DESISTIU"/"DESISTÊNCIA" -> situationSuggestion="Abandonou".
- Vazio ou não reconhecido -> use "Em Aberto" quando o status financeiro é claro, ou "Revisar" para pedir intervenção humana.

Regras do financialStatusSuggestion:
- "PAGO" -> "Pago"
- "RESERVA"/"Reserva Paga" -> "Reserva"
- "PENDENTE" -> "Pendente"
- Ambíguo -> "Revisar".

Regras gerais:
- Não invente valores. Se o total ou o valor pago não estiverem visíveis, retorne null.
- Marque needsReview=true quando houver conflito entre a situação, o status financeiro e os valores (ex.: Pago sem valor total, Reserva sem valor pago).
- confidence entre 0 e 1.
- evidence: array com trechos LITERAIS do texto original (recorte do HTML/linha) que justifiquem a sugestão.
- warnings: descreva divergências em texto curto.
- duplicateGroups: agrupe rowIds que provavelmente são o MESMO produto duplicado. Se não houver duplicatas, retorne [].

Retorne APENAS um objeto JSON válido com o formato:
{
  "clientSummary": string,
  "overallNeedsReview": boolean,
  "duplicateGroups": string[][],
  "rows": [
    {
      "rowId": string,
      "situationSuggestion": "Retirado"|"Retirar"|"Enviado"|"Abandonou"|"Em Aberto"|"Revisar",
      "financialStatusSuggestion": "Pago"|"Reserva"|"Pendente"|"Revisar",
      "totalValue": number|null,
      "paidValue": number|null,
      "confidence": number,
      "evidence": string[],
      "warnings": string[],
      "needsReview": boolean
    }
  ]
}

Sem markdown, sem comentários, apenas o JSON.`;

function buildUserPrompt(input: ZipAiReviewInput): string {
  return [
    `Cliente: ${input.clientName}`,
    input.clientPhone ? `Telefone: ${input.clientPhone}` : "",
    "",
    "Linhas parseadas:",
    JSON.stringify(input.rows, null, 2),
    "",
    "Recorte do HTML original (para evidência):",
    (input.htmlSnippet || "").slice(0, 12000),
  ]
    .filter(Boolean)
    .join("\n");
}

function coerceNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function coerceSit(v: unknown): ZipAiSituation {
  const s = typeof v === "string" ? v : "";
  const allowed: ZipAiSituation[] = [
    "Retirado",
    "Retirar",
    "Enviado",
    "Abandonou",
    "Em Aberto",
    "Revisar",
  ];
  return (allowed as string[]).includes(s) ? (s as ZipAiSituation) : "Revisar";
}

function coerceFin(v: unknown): ZipAiFinancial {
  const s = typeof v === "string" ? v : "";
  const allowed: ZipAiFinancial[] = ["Pago", "Reserva", "Pendente", "Revisar"];
  return (allowed as string[]).includes(s) ? (s as ZipAiFinancial) : "Revisar";
}

function normalize(raw: unknown): ZipAiClientReview {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rowsRaw = Array.isArray(r.rows) ? (r.rows as unknown[]) : [];
  const rows: ZipAiRowSuggestion[] = rowsRaw.map((raw2) => {
    const rr = (raw2 && typeof raw2 === "object" ? raw2 : {}) as Record<string, unknown>;
    return {
      rowId: typeof rr.rowId === "string" ? rr.rowId : "",
      situationSuggestion: coerceSit(rr.situationSuggestion),
      financialStatusSuggestion: coerceFin(rr.financialStatusSuggestion),
      totalValue: coerceNum(rr.totalValue),
      paidValue: coerceNum(rr.paidValue),
      confidence: Math.max(0, Math.min(1, coerceNum(rr.confidence) ?? 0)),
      evidence: Array.isArray(rr.evidence)
        ? (rr.evidence as unknown[]).map((x) => String(x))
        : [],
      warnings: Array.isArray(rr.warnings)
        ? (rr.warnings as unknown[]).map((x) => String(x))
        : [],
      needsReview: Boolean(rr.needsReview),
    };
  });
  const dupRaw = Array.isArray(r.duplicateGroups) ? (r.duplicateGroups as unknown[]) : [];
  const duplicateGroups = dupRaw
    .map((g) => (Array.isArray(g) ? (g as unknown[]).map((x) => String(x)) : []))
    .filter((g) => g.length > 1);
  return {
    clientSummary: typeof r.clientSummary === "string" ? r.clientSummary : "",
    overallNeedsReview: Boolean(r.overallNeedsReview) || rows.some((x) => x.needsReview),
    duplicateGroups,
    rows,
  };
}

export const reviewZipClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ReviewInput.parse(data))
  .handler(async ({ data }): Promise<ZipAiClientReview> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY ausente no servidor.");

    const body = {
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(data) },
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
      if (res.status === 429) {
        throw new Error("Limite de uso da IA atingido. Tente novamente em instantes.");
      }
      if (res.status === 402) {
        throw new Error(
          "Créditos de IA esgotados. Adicione créditos no workspace para continuar.",
        );
      }
      throw new Error(`Falha na chamada à IA (${res.status}): ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("A IA retornou um JSON inválido. Tente novamente.");
    }
    return normalize(parsed);
  });