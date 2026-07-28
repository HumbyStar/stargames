import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({ text: z.string().min(1).max(20_000) });

export interface CustomerFiscalData {
  fullName: string;
  cpfCnpj: string;
  email: string;
  phone: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  notes: string;
  missing: string[];
}

const SYSTEM = `Você é um assistente fiscal brasileiro que organiza dados de clientes para emissão de NOTA FISCAL.
Receba texto livre (colado ou digitado pelo usuário) e extraia os campos abaixo com máxima precisão.
- Não invente dados: se o campo não estiver no texto, devolva string vazia e adicione o nome do campo em "missing".
- CPF/CNPJ: somente dígitos.
- Telefone: somente dígitos (DDD + número).
- CEP: 8 dígitos, sem hífen.
- UF: 2 letras maiúsculas.
Responda APENAS JSON válido no formato:
{
  "fullName": "", "cpfCnpj": "", "email": "", "phone": "",
  "cep": "", "street": "", "number": "", "complement": "",
  "neighborhood": "", "city": "", "state": "",
  "notes": "", "missing": []
}`;

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export const analyzeCustomerData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<CustomerFiscalData> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY ausente no servidor.");

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
          { role: "user", content: data.text },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
      }),
    });

    if (res.status === 429) throw new Error("Limite de uso da IA atingido. Tente em instantes.");
    if (res.status === 402) throw new Error("Créditos de IA esgotados no workspace.");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Falha na IA (${res.status}): ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      throw new Error("A IA retornou JSON inválido. Tente novamente.");
    }

    const missing = Array.isArray(parsed.missing)
      ? (parsed.missing as unknown[]).map((x) => String(x)).filter(Boolean)
      : [];

    return {
      fullName: s(parsed.fullName),
      cpfCnpj: s(parsed.cpfCnpj).replace(/\D/g, ""),
      email: s(parsed.email),
      phone: s(parsed.phone).replace(/\D/g, ""),
      cep: s(parsed.cep).replace(/\D/g, "").slice(0, 8),
      street: s(parsed.street),
      number: s(parsed.number),
      complement: s(parsed.complement),
      neighborhood: s(parsed.neighborhood),
      city: s(parsed.city),
      state: s(parsed.state).toUpperCase().slice(0, 2),
      notes: s(parsed.notes),
      missing,
    };
  });