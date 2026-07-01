import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ReviewInput = z.object({
  clientName: z.string(),
  clientPhone: z.string().optional().default(""),
  originalNotes: z.string(),
  products: z
    .array(
      z.object({
        name: z.string(),
        platform: z.string().optional().default(""),
        totalValue: z.number().optional().default(0),
        paidValue: z.number().optional().default(0),
        remainingValue: z.number().optional().default(0),
        status: z.string().optional().default(""),
      }),
    )
    .optional()
    .default([]),
  ruleParserResult: z
    .object({
      totalAgreementValue: z.number().optional().default(0),
      installmentsCount: z.number().optional().default(0),
      installmentValue: z.number().optional().default(0),
      paidInstallments: z.number().optional().default(0),
      remainingValue: z.number().optional().default(0),
    })
    .optional()
    .default({
      totalAgreementValue: 0,
      installmentsCount: 0,
      installmentValue: 0,
      paidInstallments: 0,
      remainingValue: 0,
    }),
});

export type MgmvAiReviewInput = z.infer<typeof ReviewInput>;

export interface MgmvAiReviewSuggestion {
  isMGMV: boolean;
  totalAgreementValue: number | null;
  installmentsCount: number | null;
  installmentValue: number | null;
  paidInstallments: number | null;
  paidValue: number | null;
  pendingInstallments: number | null;
  remainingValue: number | null;
  dueDay: number | null;
  firstDueDate: string | null;
  nextDueDate: string | null;
  statusSuggestion: "Ativo" | "Em atraso" | "Quitado" | "Revisão necessária" | null;
  confidence: number;
  needsReview: boolean;
  extractedEvidence: string[];
  warnings: string[];
  /** Valor pago parcialmente em UMA parcela específica ainda não quitada. */
  partialPaidAmount?: number | null;
  /** Número (1..N) da parcela com pagamento parcial. */
  partialPaidInstallment?: number | null;
}

const SYSTEM_PROMPT = `Você é um extrator de dados financeiros de acordos MGMV.

Sua tarefa é ler observações manuais de clientes e extrair dados estruturados.

Regras:
- Não invente valores.
- Não assuma informação ausente. Quando faltar, retorne null.
- Use apenas o texto fornecido.
- Se houver conflito ou ambiguidade, marque needsReview como true e descreva em warnings.
- Retorne APENAS JSON válido conforme o schema, sem texto adicional, sem markdown.

Extraia:
- isMGMV (boolean)
- totalAgreementValue (number|null)
- installmentsCount (number|null)
- installmentValue (number|null)
- paidInstallments (number|null)
- paidValue (number|null)
- pendingInstallments (number|null)
- remainingValue (number|null)
- dueDay (1-31 ou null)
- firstDueDate (YYYY-MM-DD ou null)
- nextDueDate (YYYY-MM-DD ou null)
- statusSuggestion ("Ativo" | "Em atraso" | "Quitado" | "Revisão necessária" | null)
- confidence (0..1)
- needsReview (boolean)
- extractedEvidence (array de trechos literais do texto)
- warnings (array de strings)
- partialPaidAmount (number|null) — valor pago em UMA parcela ainda pendente, quando menor que installmentValue
- partialPaidInstallment (1..N|null) — número da parcela parcial

Valide internamente:
totalAgreementValue = installmentsCount × installmentValue
paidValue = paidInstallments × installmentValue + (partialPaidAmount || 0)
remainingValue = totalAgreementValue - paidValue

Se as contas não fecharem, mantenha os valores conforme o texto e adicione um warning explicando a divergência.

Retorne apenas o objeto JSON.`;

function buildUserPrompt(input: MgmvAiReviewInput): string {
  return [
    `Cliente: ${input.clientName}`,
    input.clientPhone ? `Telefone: ${input.clientPhone}` : "",
    "",
    "Observação original:",
    input.originalNotes || "(vazio)",
    "",
    "Resultado do parser por regra:",
    JSON.stringify(input.ruleParserResult, null, 2),
    "",
    "Produtos vinculados:",
    JSON.stringify(input.products, null, 2),
  ]
    .filter(Boolean)
    .join("\n");
}

function coerceNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalize(raw: unknown): MgmvAiReviewSuggestion {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const evidence = Array.isArray(r.extractedEvidence)
    ? (r.extractedEvidence as unknown[]).map((x) => String(x))
    : [];
  const warnings = Array.isArray(r.warnings)
    ? (r.warnings as unknown[]).map((x) => String(x))
    : [];
  const statusRaw = typeof r.statusSuggestion === "string" ? r.statusSuggestion : null;
  const allowedStatus = ["Ativo", "Em atraso", "Quitado", "Revisão necessária"];
  const statusSuggestion = (
    statusRaw && allowedStatus.includes(statusRaw) ? statusRaw : null
  ) as MgmvAiReviewSuggestion["statusSuggestion"];
  return {
    isMGMV: Boolean(r.isMGMV),
    totalAgreementValue: coerceNumberOrNull(r.totalAgreementValue),
    installmentsCount: coerceNumberOrNull(r.installmentsCount),
    installmentValue: coerceNumberOrNull(r.installmentValue),
    paidInstallments: coerceNumberOrNull(r.paidInstallments),
    paidValue: coerceNumberOrNull(r.paidValue),
    pendingInstallments: coerceNumberOrNull(r.pendingInstallments),
    remainingValue: coerceNumberOrNull(r.remainingValue),
    dueDay: coerceNumberOrNull(r.dueDay),
    firstDueDate: typeof r.firstDueDate === "string" ? r.firstDueDate : null,
    nextDueDate: typeof r.nextDueDate === "string" ? r.nextDueDate : null,
    statusSuggestion,
    confidence: (() => {
      const n = coerceNumberOrNull(r.confidence);
      if (n === null) return 0;
      return Math.max(0, Math.min(1, n));
    })(),
    needsReview: Boolean(r.needsReview),
    extractedEvidence: evidence,
    warnings,
    partialPaidAmount: coerceNumberOrNull(r.partialPaidAmount),
    partialPaidInstallment: coerceNumberOrNull(r.partialPaidInstallment),
  };
}

export const reviewMgmvNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ReviewInput.parse(data))
  .handler(async ({ data }): Promise<MgmvAiReviewSuggestion> => {
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
        throw new Error(
          "Limite de uso da IA atingido. Tente novamente em instantes.",
        );
      }
      if (res.status === 402) {
        throw new Error(
          "Créditos de IA esgotados. Adicione créditos no workspace para continuar.",
        );
      }
      throw new Error(
        `Falha na chamada à IA (${res.status}): ${text.slice(0, 200)}`,
      );
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