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
  /** Valor excedente pago além do valor da parcela — vira desconto na próxima. */
  nextInstallmentDiscount?: number | null;
  /** Número da parcela que recebe o desconto (normalmente paidInstallments + 1). */
  discountAppliedToInstallment?: number | null;
  /**
   * Datas em que cada parcela paga foi efetivamente quitada, na mesma ordem
   * em que aparecem no texto (parcela 1, parcela 2, ...). Aceita YYYY-MM-DD.
   * Vazio quando o texto não trouxer datas.
   */
  paidDates?: string[];
  /**
   * Valores efetivamente pagos em cada parcela paga, na mesma ordem das
   * parcelas (índice 0 = parcela 1). Use quando o texto disser valores
   * diferentes por parcela (ex.: "parcela 1: R$ 60, parcela 2: R$ 54").
   * Vazio quando o texto não trouxer valores por parcela.
   */
  paidValues?: number[];
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
- nextInstallmentDiscount (number|null) — quando o cliente pagou MAIS que o valor da parcela (ex.: "Pago 58 reais" numa parcela de 54), conte a parcela como PAGA integralmente e registre o excedente (4) como desconto para a próxima parcela.
- discountAppliedToInstallment (1..N|null) — número da parcela que receberá o desconto (geralmente paidInstallments + 1).
- paidDates (array de datas YYYY-MM-DD) — DATA em que cada parcela paga foi quitada, NA ORDEM (1ª data = parcela 1, 2ª = parcela 2 ...). Se o texto trouxer datas em português por extenso ("6 de Abril", "12 Maio", "dia 30 de junho de 2026"), converta para YYYY-MM-DD usando o ano de referência do texto (ou o ano corrente quando não houver). Se uma parcela paga não tiver data, coloque string vazia "" na respectiva posição. Se nenhuma data existir, retorne array vazio.
- paidValues (array de números) — VALOR pago em cada parcela paga, NA ORDEM (1º valor = parcela 1, 2º = parcela 2 ...). Use quando o texto trouxer valor explícito por parcela (ex.: "parcela 1 R$ 60, parcela 2 R$ 54"). Se uma parcela paga não tiver valor explícito no texto, coloque 0 na respectiva posição para herdar installmentValue. Se nenhum valor por parcela existir, retorne array vazio.

Regras de ANO ao converter datas sem ano no texto:
- Use o ANO CORRENTE informado no prompt do usuário.
- Nunca invente anos passados (ex.: 2023, 2024) só porque o mês parece "antigo".
- Se as datas estão em ordem cronológica dentro do texto, mantenha essa ordem mesmo cruzando ano (ex.: "Dez" seguido de "Jan" avança o ano).

Regras para nextDueDate e statusSuggestion:
- nextDueDate = data da PRÓXIMA parcela pendente, calculada como (data do último pagamento) + 1 mês. Se não houver pagamentos, use o firstDueDate.
- statusSuggestion:
  - "Quitado" quando paidInstallments == installmentsCount.
  - "Em atraso" APENAS quando nextDueDate < data de hoje.
  - "Ativo" quando nextDueDate >= data de hoje.
  - Compare sempre contra a data de hoje informada no prompt do usuário.

Regra de pagamento com valor diferente do da parcela:
- Se o texto disser "Pago X reais" (ou similar), trate como uma parcela PAGA integralmente.
  - Se X > installmentValue: paidInstallments incrementa em 1, e (X − installmentValue) vai em nextInstallmentDiscount para a próxima parcela. NÃO use partialPaidAmount neste caso.
  - Se X < installmentValue: aí sim use partialPaidAmount/partialPaidInstallment (a parcela fica em aberto).
  - Se X == installmentValue: apenas incrementa paidInstallments.

Valide internamente:
totalAgreementValue = installmentsCount × installmentValue
paidValue = paidInstallments × installmentValue + (partialPaidAmount || 0) + (nextInstallmentDiscount || 0)
remainingValue = totalAgreementValue - paidValue

Se as contas não fecharem, mantenha os valores conforme o texto e adicione um warning explicando a divergência.

Retorne apenas o objeto JSON.`;

function buildUserPrompt(input: MgmvAiReviewInput): string {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const currentYear = today.getFullYear();
  return [
    `Data de hoje: ${todayIso} (ano corrente: ${currentYear}).`,
    `IMPORTANTE: quando o texto trouxer datas SEM ano (ex.: "6 de Abril", "12 Maio"), use o ANO CORRENTE (${currentYear}) — NUNCA use 2023/2024 por padrão.`,
    "",
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
    nextInstallmentDiscount: coerceNumberOrNull(r.nextInstallmentDiscount),
    discountAppliedToInstallment: coerceNumberOrNull(r.discountAppliedToInstallment),
    paidDates: Array.isArray(r.paidDates)
      ? (r.paidDates as unknown[]).map((x) => (typeof x === "string" ? x : ""))
      : [],
    paidValues: Array.isArray(r.paidValues)
      ? (r.paidValues as unknown[])
          .map((x) => coerceNumberOrNull(x))
          .map((n) => (n === null ? 0 : n))
      : [],
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