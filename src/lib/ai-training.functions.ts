import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type OnboardingAnswer = { q: string; a: string };
export type TrainingDoc = { name: string; content: string };

export interface AutomationSuggestion {
  id?: string;
  name: string;
  description: string;
  scope: string;
  trigger: string;
  applies_to: string;
  reasoning: string;
  python_code: string;
  status: "draft" | "approved" | "active" | "archived";
  estimated_ai_savings: string;
  created_at?: string;
  updated_at?: string;
}

export interface TrainingProfile {
  user_id: string;
  business_facts: Record<string, string>;
  onboarding_answers: OnboardingAnswer[];
  documents: TrainingDoc[];
  onboarding_completed: boolean;
  last_analysis_at: string | null;
}

const SYSTEM_CEO = `Você é a IA-CEO da Star Games (cobrança, MGMV, envios e equipe).
Pense como um diretor que estuda o sistema para criar AUTOMAÇÕES EM PYTHON que reduzam o uso de IA conversacional, transformando lógicas repetitivas em scripts determinísticos.
Você é parte do time, conhece importações de ZIP, MGMV, equipe e clientes.
Sempre responda em PT-BR e SOMENTE com JSON válido conforme o esquema pedido.`;

async function callGateway(apiKey: string, system: string, user: string): Promise<string> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    }),
  });
  if (res.status === 429) throw new Error("Muitas requisições à IA. Aguarde alguns segundos.");
  if (res.status === 402) throw new Error("Créditos de IA esgotados no workspace.");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[ai-training] gateway error", res.status, body);
    throw new Error("Falha ao consultar a IA.");
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? "{}";
}

function safeJSON<T>(raw: string, fallback: T): T {
  try {
    const trimmed = raw.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    return JSON.parse(trimmed) as T;
  } catch {
    return fallback;
  }
}

/** Carrega (ou cria) o perfil de treinamento do usuário. */
export const getAiTrainingProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TrainingProfile> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("ai_training_profile")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as unknown as TrainingProfile;
    const { data: created, error: insErr } = await supabase
      .from("ai_training_profile")
      .insert({ user_id: userId })
      .select("*")
      .single();
    if (insErr) throw new Error(insErr.message);
    return created as unknown as TrainingProfile;
  });

/** Salva uma resposta do onboarding e retorna a próxima pergunta gerada pela IA. */
export const submitOnboardingAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { question: string; answer: string; finish?: boolean }) => {
    if (!input?.answer) throw new Error("Resposta vazia");
    return {
      question: String(input.question || "").slice(0, 500),
      answer: String(input.answer).slice(0, 4000),
      finish: !!input.finish,
    };
  })
  .handler(async ({ data, context }): Promise<{ nextQuestion: string | null; completed: boolean }> => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("ai_training_profile")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    const prev = (profile?.onboarding_answers ?? []) as OnboardingAnswer[];
    const next = [...prev, { q: data.question, a: data.answer }];

    await supabase
      .from("ai_training_profile")
      .upsert({
        user_id: userId,
        onboarding_answers: next,
        onboarding_completed: data.finish || next.length >= 8,
      });

    if (data.finish || next.length >= 8) {
      return { nextQuestion: null, completed: true };
    }

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { nextQuestion: null, completed: true };

    const userPrompt = `Histórico até agora (Q/A em PT-BR):\n${next
      .map((x, i) => `${i + 1}. P: ${x.q}\n   R: ${x.a}`)
      .join("\n")}\n\nGere a PRÓXIMA pergunta inteligente, curta e específica para entender o negócio (rotinas, gargalos, decisões repetidas, prioridades, pessoas-chave). Foco: descobrir o que pode virar automação Python.
Responda APENAS JSON: {"question": "..."}`;
    const raw = await callGateway(apiKey, SYSTEM_CEO, userPrompt);
    const parsed = safeJSON<{ question?: string }>(raw, {});
    return { nextQuestion: parsed.question ?? null, completed: false };
  });

/** Gera a primeira pergunta do onboarding. */
export const startOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ question: string }> => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("ai_training_profile")
      .select("onboarding_answers")
      .eq("user_id", userId)
      .maybeSingle();
    const answered = (profile?.onboarding_answers ?? []) as OnboardingAnswer[];
    if (answered.length > 0) {
      const last = answered[answered.length - 1];
      return { question: `Continuando: ${last.q}` };
    }
    return {
      question:
        "Pra eu te entender como um CEO faria: qual é HOJE a parte mais repetitiva e cansativa da sua operação (cobrança, MGMV, envio, equipe ou importação)?",
    };
  });

/** Salva um documento de regras (texto). */
export const addTrainingDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string; content: string }) => {
    if (!input?.content) throw new Error("Documento vazio");
    return {
      name: String(input.name || "regra.txt").slice(0, 120),
      content: String(input.content).slice(0, 50000),
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("ai_training_profile")
      .select("documents")
      .eq("user_id", userId)
      .maybeSingle();
    const docs = (profile?.documents ?? []) as TrainingDoc[];
    const next = [...docs, { name: data.name, content: data.content }];
    await supabase.from("ai_training_profile").upsert({ user_id: userId, documents: next });
    return { ok: true, total: next.length };
  });

/** Varre o sistema, analisa padrões reais e devolve automações Python sugeridas. */
export const analyzeAndSuggestAutomations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ suggestions: AutomationSuggestion[]; insights: string[] }> => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("IA indisponível");

    const [clientsR, productsR, mgmvR, mgmvInstR, tasksR, importsR, auditR, profileR] =
      await Promise.all([
        supabase.from("clients").select("id", { count: "exact", head: true }),
        supabase.from("products").select("id, status", { count: "exact" }).limit(500),
        supabase.from("mgmv_agreements").select("id", { count: "exact", head: true }),
        supabase.from("mgmv_installments").select("id, due_date, status").limit(500),
        supabase.from("team_tasks").select("type, status, priority").limit(500),
        supabase.from("import_history").select("status, errors, created_at").order("created_at", { ascending: false }).limit(50),
        supabase.from("audit_log").select("table_name, action").limit(500),
        supabase.from("ai_training_profile").select("*").eq("user_id", userId).maybeSingle(),
      ]);

    const productsByStatus: Record<string, number> = {};
    for (const p of (productsR.data ?? []) as Array<{ status?: string }>) {
      const k = p.status ?? "unknown";
      productsByStatus[k] = (productsByStatus[k] ?? 0) + 1;
    }
    const tasksByType: Record<string, number> = {};
    for (const t of (tasksR.data ?? []) as Array<{ type?: string }>) {
      const k = t.type ?? "unknown";
      tasksByType[k] = (tasksByType[k] ?? 0) + 1;
    }
    const auditByTable: Record<string, number> = {};
    for (const a of (auditR.data ?? []) as Array<{ table_name?: string }>) {
      const k = a.table_name ?? "unknown";
      auditByTable[k] = (auditByTable[k] ?? 0) + 1;
    }
    const importsErrors = (importsR.data ?? []).reduce(
      (acc, r: { errors?: number }) => acc + (r.errors ?? 0),
      0,
    );
    const overdueMgmv = ((mgmvInstR.data ?? []) as Array<{ due_date?: string; status?: string }>).filter(
      (i) => i.status !== "paid" && i.due_date && new Date(i.due_date) < new Date(),
    ).length;

    const profile = (profileR.data ?? {}) as Partial<TrainingProfile>;

    const snapshot = {
      clientsTotal: clientsR.count ?? 0,
      productsTotal: productsR.count ?? 0,
      productsByStatus,
      mgmvAgreements: mgmvR.count ?? 0,
      mgmvOverdueInstallments: overdueMgmv,
      tasksByType,
      auditTopTables: Object.fromEntries(
        Object.entries(auditByTable).sort((a, b) => b[1] - a[1]).slice(0, 6),
      ),
      importsRecent: (importsR.data ?? []).length,
      importsErrors,
      businessFacts: profile.business_facts ?? {},
      onboardingAnswers: profile.onboarding_answers ?? [],
      documents: (profile.documents ?? []).map((d) => d.name),
    };

    const userPrompt = `Analise o estado real do sistema e sugira de 3 a 6 AUTOMAÇÕES EM PYTHON que reduzam o uso de IA conversacional (ou seja, transformem decisões repetitivas em código determinístico).
Cada automação deve referenciar as áreas: importação ZIP, clientes/MGMV, equipe/tarefas, ou visão CEO geral.
Use o snapshot real abaixo para priorizar onde há mais volume / erros.

SNAPSHOT:
${JSON.stringify(snapshot, null, 2)}

Responda APENAS JSON neste formato:
{
  "insights": ["frase curta 1", "frase 2", "frase 3"],
  "suggestions": [
    {
      "name": "Nome curto",
      "description": "O que ela faz, em PT-BR claro",
      "scope": "import|clientes|mgmv|equipe|ceo",
      "trigger": "manual|diario|por_evento",
      "applies_to": "Onde no sistema isso é aplicado (ex: tabela mgmv_installments, importação de ZIP, audit_log)",
      "reasoning": "Por que essa automação reduz uso de IA / esforço humano",
      "python_code": "Código Python completo e EXECUTÁVEL, comentado em PT-BR, usando supabase-py ou pandas conforme o caso",
      "estimated_ai_savings": "Estimativa qualitativa (ex: 'evita ~80% das chamadas à IA para classificar parcelas')"
    }
  ]
}`;
    const raw = await callGateway(apiKey, SYSTEM_CEO, userPrompt);
    const parsed = safeJSON<{ insights?: string[]; suggestions?: AutomationSuggestion[] }>(raw, {});
    const suggestions = (parsed.suggestions ?? []).slice(0, 8).map((s) => ({
      ...s,
      status: "draft" as const,
    }));

    // persist
    if (suggestions.length) {
      await supabase.from("ai_automations").insert(
        suggestions.map((s) => ({
          user_id: userId,
          name: s.name?.slice(0, 200) ?? "Automação",
          description: s.description ?? "",
          scope: s.scope ?? "general",
          trigger: s.trigger ?? "manual",
          applies_to: s.applies_to ?? "",
          reasoning: s.reasoning ?? "",
          python_code: s.python_code ?? "",
          estimated_ai_savings: s.estimated_ai_savings ?? "",
          status: "draft",
        })),
      );
    }

    await supabase
      .from("ai_training_profile")
      .upsert({ user_id: userId, last_analysis_at: new Date().toISOString() });

    return { suggestions, insights: parsed.insights ?? [] };
  });

export const listAutomations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AutomationSuggestion[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("ai_automations")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as AutomationSuggestion[];
  });

export const setAutomationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status: "draft" | "approved" | "active" | "archived" }) => {
    if (!input?.id) throw new Error("id ausente");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("ai_automations")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });