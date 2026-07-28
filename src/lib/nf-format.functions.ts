import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({
  products: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        platform: z.string().default(""),
        totalValue: z.number().nonnegative(),
      }),
    )
    .min(1)
    .max(200),
});

export interface NfClassificationResult {
  id: string;
  ncm: string;
  category: string;
}

const SYSTEM = `Você é um assistente fiscal brasileiro que classifica produtos para NOTA FISCAL.
Para cada produto abaixo (identificado por "id"), retorne o NCM (8 dígitos) e a Categoria fiscal em português.
Contexto: os produtos são principalmente jogos de videogame em mídia física, consoles, acessórios e mídias digitais.
Exemplos comuns:
- Jogos de videogame em mídia física (disco/cartucho/UMD): NCM 8523.49.90.
- Consoles de videogame: NCM 9504.50.00.
- Acessórios (controle/joystick): NCM 9504.50.00.
Regras:
- Nunca invente. Se não souber com certeza, use category="Sem classificação" e ncm="".
- Agrupe produtos semelhantes com o MESMO NCM e a MESMA Categoria (texto idêntico).
- Responda APENAS JSON válido no formato:
  { "items": [ { "id": "...", "ncm": "8523.49.90", "category": "Jogos de videogame mídia física" } ] }`;

export const classifyProductsForNf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<NfClassificationResult[]> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY ausente no servidor.");

    const userMsg =
      "Classifique os produtos abaixo (JSON):\n" +
      JSON.stringify(
        data.products.map((p) => ({
          id: p.id,
          name: p.name,
          platform: p.platform,
        })),
      );

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
          { role: "system", content: SYSTEM },
          { role: "user", content: userMsg },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      }),
    });

    if (res.status === 429)
      throw new Error("Limite de uso da IA atingido. Tente em instantes.");
    if (res.status === 402)
      throw new Error("Créditos de IA esgotados no workspace.");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Falha na IA (${res.status}): ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: { items?: Array<{ id?: unknown; ncm?: unknown; category?: unknown }> } = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("A IA retornou JSON inválido. Tente novamente.");
    }

    const items = Array.isArray(parsed.items) ? parsed.items : [];
    const byId = new Map<string, NfClassificationResult>();
    for (const it of items) {
      const id = typeof it?.id === "string" ? it.id : "";
      if (!id) continue;
      byId.set(id, {
        id,
        ncm: typeof it.ncm === "string" ? it.ncm : "",
        category: typeof it.category === "string" ? it.category : "",
      });
    }

    return data.products.map(
      (p) =>
        byId.get(p.id) ?? { id: p.id, ncm: "", category: "Sem classificação" },
    );
  });