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

export const classifyProductsForNf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<NfClassificationResult[]> => {
    const { aderirNCM, ncmEntrada, normalizarTexto } = await import("@/lib/ncm-rules");

    // 1) Catálogo já classificado (product_ncm) tem prioridade.
    const keys = data.products.map((p) => normalizarTexto(p.name));
    const catalog = new Map<string, { ncm: string; category: string }>();
    const { data: rows } = await context.supabase
      .from("product_ncm")
      .select("name_key, platform_key, ncm, category")
      .in("name_key", Array.from(new Set(keys)));
    for (const r of rows ?? []) {
      catalog.set(`${r.name_key}__${r.platform_key}`, {
        ncm: String(r.ncm ?? ""),
        category: String(r.category ?? ""),
      });
    }

    // 2) O que não estiver no catálogo usa a regra determinística local.
    return data.products.map((p) => {
      const hit = catalog.get(`${normalizarTexto(p.name)}__${normalizarTexto(p.platform)}`);
      if (hit && hit.ncm.replace(/\D/g, "").length === 8) {
        return { id: p.id, ncm: hit.ncm, category: hit.category || "Sem categoria" };
      }
      const r = aderirNCM(ncmEntrada(p.name, p.platform));
      return { id: p.id, ncm: r.ncm, category: r.descricao };
    });
  });
