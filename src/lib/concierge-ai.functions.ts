import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Intenções operacionais que o Concierge sabe executar.
 * Tudo é mapeado para fluxos/modais/filtros JÁ EXISTENTES no sistema.
 */
export type ConciergeIntent =
  | "search_client"
  | "open_card"
  | "open_section"
  | "open_client_create"
  | "open_product_create"
  | "ambiguous"
  | "unknown";

export type ConciergeCardId =
  | "pending"
  | "overdue-reservations"
  | "active-reservations"
  | "mgmv-overdue"
  | "mgmv-clients"
  | "paid-awaiting-shipment"
  | "shipped"
  | "withdrawals"
  | "abandons"
  | "review-required"
  | "ai-reviewed"
  | "total-clients"
  | "total-products";

export type ConciergeSection =
  | "dashboard"
  | "clientes"
  | "collection"
  | "mgmv"
  | "import"
  | "config"
  | "equipe";

export interface ConciergeIntentResult {
  intent: ConciergeIntent;
  confidence: number;
  cardId?: ConciergeCardId;
  section?: ConciergeSection;
  clientQuery?: string;
  message?: string;
  requiresConfirmation?: boolean;
}

const SYSTEM_PROMPT = `Você é o interpretador de intenção do Concierge Operacional da Star Games (gestão de cobranças, MGMV e envios).
Sua tarefa: ler um comando curto em português e devolver UM JSON estruturado representando a INTENÇÃO operacional.
Você NÃO conversa, NÃO explica, NÃO inventa. Só classifica e estrutura.

Intents possíveis:
- "search_client": usuário quer encontrar/abrir um cliente. Preencha clientQuery com o nome/telefone.
- "open_card": abrir um filtro operacional existente. Preencha cardId.
- "open_section": navegar para uma seção. Preencha section.
- "open_client_create": cadastrar novo cliente.
- "open_product_create": adicionar produto. Se o usuário citou cliente, preencha clientQuery.
- "ambiguous": comando vago, peça esclarecimento curto em message.
- "unknown": fora do escopo. Em message, oriente o usuário.

cardId aceitos:
- "pending" (pendências em aberto / cobrar pendentes / cobrar clientes)
- "overdue-reservations" (reservas vencidas / reservas atrasadas / remarcadas vencendo)
- "active-reservations" (reservas ativas em aberto)
- "mgmv-overdue" (MGMV em atraso / parcela MGMV vencida / cobrar MGMV)
- "mgmv-clients" (todos clientes MGMV)
- "paid-awaiting-shipment" (pagos aguardando envio / enviar pedidos pagos)
- "shipped" (produtos já enviados)
- "withdrawals" (desistências)
- "abandons" (abandonos)
- "review-required" (revisão MGMV necessária)
- "ai-reviewed" (revisados com IA)
- "total-clients" (todos os clientes comuns)
- "total-products" (todos os produtos)

section aceitos: "dashboard", "clientes", "collection", "mgmv", "import", "config", "equipe".

Se a ação for crítica (marcar pago, excluir, remarcar, salvar importação, marcar enviado, cancelar acordo, alterar status), defina requiresConfirmation: true e direcione para abrir o cliente/registro (search_client) — NUNCA execute direto.

Responda APENAS com JSON válido neste formato:
{"intent":"...","confidence":0..1,"cardId":"...","section":"...","clientQuery":"...","message":"...","requiresConfirmation":false}

Omita campos que não se aplicam. confidence reflete sua certeza.`;

function tryParseJSON(text: string): ConciergeIntentResult | null {
  try {
    const cleaned = text
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "");
    const parsed = JSON.parse(cleaned) as ConciergeIntentResult;
    if (!parsed?.intent) return null;
    return parsed;
  } catch {
    return null;
  }
}

function requireRole(claims: unknown): void {
  // Permission re-check é feita no banco/RPC quando aplicável; aqui exigimos sessão.
  if (!claims) throw new Error("Sessão inválida");
}

/**
 * Interpreta um comando textual e devolve a intenção estruturada.
 */
export const resolveConciergeIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { text: string }) => {
    if (!input?.text || typeof input.text !== "string") {
      throw new Error("Comando vazio");
    }
    const trimmed = input.text.trim().slice(0, 500);
    if (!trimmed) throw new Error("Comando vazio");
    return { text: trimmed };
  })
  .handler(async ({ data, context }): Promise<ConciergeIntentResult> => {
    requireRole(context.claims);
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return {
        intent: "unknown",
        confidence: 0,
        message: "IA indisponível no momento.",
      };
    }

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: data.text },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      }),
    });

    if (res.status === 429) {
      return { intent: "unknown", confidence: 0, message: "Muitas requisições. Tente novamente em instantes." };
    }
    if (res.status === 402) {
      return { intent: "unknown", confidence: 0, message: "Créditos de IA esgotados no workspace." };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[concierge-intent] gateway error", res.status, body);
      return { intent: "unknown", confidence: 0, message: "Não consegui interpretar o comando agora." };
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? "";
    const parsed = tryParseJSON(content);
    if (!parsed) {
      return {
        intent: "ambiguous",
        confidence: 0.3,
        message: "Pode reformular? Não entendi o pedido.",
      };
    }
    return parsed;
  });

/**
 * Transcreve um áudio enviado pelo navegador. Recebe base64 + mime.
 */
export const transcribeConciergeAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { audioBase64: string; mime: string }) => {
    if (!input?.audioBase64) throw new Error("Áudio vazio");
    if (!input?.mime) throw new Error("Formato de áudio desconhecido");
    return { audioBase64: input.audioBase64, mime: input.mime };
  })
  .handler(async ({ data, context }): Promise<{ text: string }> => {
    requireRole(context.claims);
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("IA indisponível");

    // Decode base64 -> Uint8Array
    const bin = atob(data.audioBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const ext = (() => {
      const m = data.mime.split(";")[0];
      if (m.includes("wav")) return "wav";
      if (m.includes("mp4") || m.includes("m4a")) return "m4a";
      if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
      if (m.includes("ogg")) return "ogg";
      return "webm";
    })();

    const fd = new FormData();
    fd.append("model", "openai/gpt-4o-mini-transcribe");
    fd.append("file", new Blob([bytes], { type: data.mime }), `cmd.${ext}`);
    fd.append("language", "pt");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[concierge-stt] gateway error", res.status, body);
      throw new Error(res.status === 402 ? "Créditos de IA esgotados." : "Não consegui transcrever o áudio.");
    }
    const json = (await res.json()) as { text?: string };
    return { text: (json.text ?? "").trim() };
  });