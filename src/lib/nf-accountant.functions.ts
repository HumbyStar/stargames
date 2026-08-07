import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface NfAccountantItem {
  id: string;
  name: string;
  platform: string;
  totalValue: number;
  ncm: string;
  category: string;
}

export interface NfAccountantPayload {
  header: string;
  items: NfAccountantItem[];
  totalValue: number;
}

/** Monta a versão "item a item" (contador) de uma nota fiscal já gerada. */
export const buildAccountantNf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<NfAccountantPayload> => {
    const { aderirNCM, ncmEntrada, normalizarTexto } = await import("@/lib/ncm-rules");
    const { formatNcm } = await import("@/lib/nf-format");

    const { data: inv, error } = await context.supabase
      .from("nf_invoices")
      .select("content, product_ids, total_cents")
      .eq("id", data.id)
      .single();
    if (error || !inv) throw new Error(error?.message ?? "Nota não encontrada.");

    const lines = String(inv.content ?? "").split("\n");
    const idx = lines.findIndex((l) => /^Lote\s+\d+/i.test(l.trim()));
    const header = (idx > 0 ? lines.slice(0, idx) : lines).join("\n").trim();

    const ids: string[] = (inv.product_ids as string[] | null) ?? [];
    if (ids.length === 0) {
      return { header, items: [], totalValue: (inv.total_cents ?? 0) / 100 };
    }

    const { data: prods } = await context.supabase
      .from("products")
      .select("id, name, platform, total_value")
      .in("id", ids);

    const rows = (prods ?? []).map((p) => ({
      id: String(p.id),
      name: String(p.name ?? ""),
      platform: String(p.platform ?? ""),
      totalValue: Number(p.total_value ?? 0),
    }));

    const keys = Array.from(new Set(rows.map((p) => normalizarTexto(p.name))));
    const catalog = new Map<string, { ncm: string; category: string }>();
    if (keys.length > 0) {
      const { data: cat } = await context.supabase
        .from("product_ncm")
        .select("name_key, platform_key, ncm, category")
        .in("name_key", keys);
      for (const r of cat ?? []) {
        catalog.set(`${r.name_key}__${r.platform_key}`, {
          ncm: String(r.ncm ?? ""),
          category: String(r.category ?? ""),
        });
      }
    }

    const items: NfAccountantItem[] = rows.map((p) => {
      const hit = catalog.get(`${normalizarTexto(p.name)}__${normalizarTexto(p.platform)}`);
      if (hit && hit.ncm.replace(/\D/g, "").length === 8) {
        return {
          ...p,
          ncm: formatNcm(hit.ncm),
          category: hit.category || "Sem categoria",
        };
      }
      const r = aderirNCM(ncmEntrada(p.name, p.platform));
      return { ...p, ncm: formatNcm(r.ncm), category: r.descricao };
    });

    // Mantém a ordem dos ids salvos na nota.
    items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

    return {
      header,
      items,
      totalValue: items.reduce((s, i) => s + i.totalValue, 0),
    };
  });
