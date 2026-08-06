import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type Db = SupabaseClient<Database>;

export interface NcmItem {
  name: string;
  platform: string;
}

export interface NcmResult extends NcmItem {
  ncm: string;
  category: string;
  confidence: number;
  rationale: string;
  status: "ok" | "review";
}

export function ncmKey(value: string): string {
  return (value ?? "").trim().toLowerCase();
}

/** Capítulos NCM plausíveis para o segmento (jogos, consoles, acessórios, colecionáveis). */
const ALLOWED_PREFIXES = [
  "8523", // mídias gravadas (jogos em disco/cartucho)
  "9504", // consoles, máquinas de jogos e acessórios
  "8471", // teclados/dispositivos de entrada
  "8517", // headsets/comunicação
  "8518", // fones e alto-falantes
  "8544", // cabos
  "8507", // baterias
  "8504", // fontes/carregadores
  "9503", // brinquedos/action figures/colecionáveis
  "4901", // livros/artbooks
  "4911", // impressos, pôsteres, cards
  "6109", // camisetas
  "3926", // artigos de plástico (suportes, capas)
  "7117", // bijuterias/chaveiros metálicos
  "9505", // artigos de festa/colecionáveis diversos
];

export function isPlausibleNcm(ncm: string): boolean {
  const d = (ncm ?? "").replace(/\D/g, "");
  if (d.length !== 8) return false;
  return ALLOWED_PREFIXES.some((p) => d.startsWith(p));
}

export const NCM_SYSTEM = `Você é um especialista em classificação fiscal brasileira (NCM/TIPI) para uma loja de games.
Classifique CADA item recebido (nome do produto + plataforma) com o NCM de 8 dígitos correto e uma categoria fiscal curta em português.

Referências obrigatórias do segmento:
- Jogo de videogame em mídia física (disco Blu-ray/DVD/UMD, cartucho): 85234990.
- Console/videogame e máquinas de jogo: 95045000.
- Controle/joystick/acessório de console: 95045000.
- Headset/fone com microfone: 85183000.
- Cabo (HDMI, USB, energia): 85444200.
- Carregador/fonte: 85044090.
- Bateria/pilha recarregável: 85076000.
- Action figure, boneco, miniatura colecionável: 95030099.
- Card colecionável, pôster, artbook impresso: 49111090 (livro: 49019900).
- Camiseta de algodão: 61091000.
- Chaveiro metálico: 71171900.

Regras rígidas:
- NUNCA invente. Se não tiver certeza, use ncm:"" , category:"Sem classificação" e confidence baixo.
- Itens equivalentes devem receber o MESMO ncm e a MESMA category (texto idêntico).
- confidence é um número de 0 a 1.
- rationale: no máximo 140 caracteres explicando a escolha.
- Responda APENAS JSON válido:
{"items":[{"i":0,"ncm":"85234990","category":"Jogo de videogame em mídia física","confidence":0.95,"rationale":"..."}]}`;

export const NCM_AUDIT_SYSTEM = `Você é um auditor fiscal brasileiro. Receberá itens já classificados (nome, plataforma, ncm, categoria).
Sua tarefa é CONFERIR cada classificação e corrigir o que estiver errado, com rigor máximo.
Considere as mesmas referências do segmento de games (jogos em mídia física 85234990; consoles e acessórios 95045000; fones 85183000; cabos 85444200; fontes 85044090; baterias 85076000; colecionáveis 95030099; impressos 49111090; livros 49019900; camisetas 61091000; chaveiros 71171900).
Se a classificação estiver correta, repita-a. Se estiver errada, corrija. Se for impossível ter certeza, devolva ncm:"" com category:"Sem classificação" e confidence <= 0.4.
Responda APENAS JSON válido:
{"items":[{"i":0,"ncm":"85234990","category":"Jogo de videogame em mídia física","confidence":0.95,"rationale":"..."}]}`;

interface RawItem {
  i?: unknown;
  ncm?: unknown;
  category?: unknown;
  confidence?: unknown;
  rationale?: unknown;
}

export async function callNcmModel(
  key: string,
  system: string,
  user: string,
): Promise<Map<number, RawItem>> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: "google/gemini-3.6-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });

  if (res.status === 429) throw new Error("Limite de uso da IA atingido. Tente em instantes.");
  if (res.status === 402) throw new Error("Créditos de IA esgotados no workspace.");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Falha na IA (${res.status}): ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  let parsed: { items?: RawItem[] } = {};
  try {
    parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
  } catch {
    throw new Error("A IA retornou JSON inválido.");
  }
  const map = new Map<number, RawItem>();
  for (const it of parsed.items ?? []) {
    const idx = Number(it?.i);
    if (Number.isFinite(idx)) map.set(idx, it);
  }
  return map;
}

/** Classifica com dupla verificação: 1ª passada + auditoria independente. */
export async function classifyWithDoubleCheck(
  key: string,
  items: NcmItem[],
): Promise<NcmResult[]> {
  const listing = items
    .map((p, i) => `${i}. ${p.name}${p.platform ? ` [${p.platform}]` : ""}`)
    .join("\n");

  const first = await callNcmModel(
    key,
    NCM_SYSTEM,
    `Classifique os itens abaixo:\n${listing}`,
  );

  const auditPayload = items
    .map((p, i) => {
      const r = first.get(i);
      return `${i}. ${p.name}${p.platform ? ` [${p.platform}]` : ""} -> ncm=${String(r?.ncm ?? "")} categoria=${String(r?.category ?? "")}`;
    })
    .join("\n");

  let second: Map<number, RawItem>;
  try {
    second = await callNcmModel(
      key,
      NCM_AUDIT_SYSTEM,
      `Confira e corrija as classificações abaixo:\n${auditPayload}`,
    );
  } catch {
    second = new Map();
  }

  return items.map((p, i) => {
    const a = first.get(i);
    const b = second.get(i);
    const digitsA = String(a?.ncm ?? "").replace(/\D/g, "");
    const digitsB = String(b?.ncm ?? "").replace(/\D/g, "");
    const agree = digitsA.length === 8 && digitsA === digitsB;
    const chosen = digitsB.length === 8 ? digitsB : digitsA;
    const category =
      String((b?.category as string) ?? (a?.category as string) ?? "").trim() ||
      "Sem classificação";
    const rationale = String((b?.rationale as string) ?? (a?.rationale as string) ?? "").slice(0, 200);
    const rawConf = Number(b?.confidence ?? a?.confidence ?? 0);
    const baseConf = Number.isFinite(rawConf) ? Math.min(Math.max(rawConf, 0), 1) : 0;
    const valid = isPlausibleNcm(chosen);
    const confidence = valid ? (agree ? Math.max(baseConf, 0.9) : Math.min(baseConf, 0.7)) : 0.2;
    const ok = valid && agree && confidence >= 0.8;
    return {
      name: p.name,
      platform: p.platform,
      ncm: valid ? chosen : "",
      category: ok ? category : category || "Sem classificação",
      confidence,
      rationale,
      status: ok ? "ok" : "review",
    };
  });
}

/** Grava (insere ou atualiza) as classificações, sem sobrescrever edições manuais. */
export async function upsertNcmRows(db: Db, rows: NcmResult[]): Promise<number> {
  let saved = 0;
  for (const r of rows) {
    const nameKey = ncmKey(r.name);
    const platformKey = ncmKey(r.platform);
    const { data: existing } = await db
      .from("product_ncm")
      .select("id, source")
      .eq("name_key", nameKey)
      .eq("platform_key", platformKey)
      .maybeSingle();

    if (existing?.source === "manual") continue;

    const payload = {
      name_key: nameKey,
      platform_key: platformKey,
      name: r.name,
      platform: r.platform,
      ncm: r.ncm,
      category: r.category,
      confidence: r.confidence,
      rationale: r.rationale,
      source: "ai",
      status: r.status,
      verified_at: new Date().toISOString(),
    };

    const { error } = existing
      ? await db.from("product_ncm").update(payload).eq("id", existing.id)
      : await db.from("product_ncm").insert(payload);
    if (!error) saved += 1;
  }
  return saved;
}

/** Grava uma classificação manual (trava contra sobrescrita da IA). */
export async function saveManualNcm(
  db: Db,
  input: { name: string; platform: string; ncm: string; category: string },
): Promise<void> {
  const digits = input.ncm.replace(/\D/g, "");
  const nameKey = ncmKey(input.name);
  const platformKey = ncmKey(input.platform);
  const payload = {
    name_key: nameKey,
    platform_key: platformKey,
    name: input.name.trim(),
    platform: input.platform.trim(),
    ncm: digits,
    category: input.category.trim(),
    source: "manual",
    status: digits.length === 8 ? "ok" : "review",
    confidence: 1,
    rationale: "Definido manualmente pelo usuário.",
    verified_at: new Date().toISOString(),
  };
  const { data: existing } = await db
    .from("product_ncm")
    .select("id")
    .eq("name_key", nameKey)
    .eq("platform_key", platformKey)
    .maybeSingle();
  const { error } = existing
    ? await db.from("product_ncm").update(payload).eq("id", existing.id)
    : await db.from("product_ncm").insert(payload);
  if (error) throw new Error(error.message);
}
