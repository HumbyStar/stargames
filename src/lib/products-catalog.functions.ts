import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ListInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(25),
  search: z.string().default(""),
  platform: z.string().default(""),
  sort: z
    .enum(["name_asc", "name_desc", "qty_desc", "paid_desc", "value_desc"])
    .default("name_asc"),
  onlyMissingNcm: z.boolean().default(false),
});

export interface CatalogRow {
  name: string;
  platform: string;
  totalQty: number;
  paidQty: number;
  openQty: number;
  totalValue: number;
  paidValue: number;
  ncm: string;
  category: string;
  source: string;
  status: string;
  confidence: number | null;
  rationale: string | null;
}

export const listProductCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListInput.parse(d ?? {}))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      rows: CatalogRow[];
      total: number;
      page: number;
      pageSize: number;
    }> => {
      const { data: rows, error } = await context.supabase.rpc("product_catalog", {
        _search: data.search,
        _platform: data.platform,
        _sort: data.sort,
        _page: data.page,
        _page_size: data.pageSize,
        _only_missing_ncm: data.onlyMissingNcm,
      });
      if (error) throw new Error(error.message);

      const list = (rows ?? []) as Array<Record<string, unknown>>;
      return {
        rows: list.map((r) => ({
          name: String(r.name ?? ""),
          platform: String(r.platform ?? ""),
          totalQty: Number(r.total_qty ?? 0),
          paidQty: Number(r.paid_qty ?? 0),
          openQty: Number(r.open_qty ?? 0),
          totalValue: Number(r.total_value ?? 0),
          paidValue: Number(r.paid_value ?? 0),
          ncm: String(r.ncm ?? ""),
          category: String(r.ncm_category ?? ""),
          source: String(r.ncm_source ?? ""),
          status: String(r.ncm_status ?? ""),
          confidence: r.ncm_confidence == null ? null : Number(r.ncm_confidence),
          rationale: r.ncm_rationale == null ? null : String(r.ncm_rationale),
        })),
        total: Number(list[0]?.total_count ?? 0),
        page: data.page,
        pageSize: data.pageSize,
      };
    },
  );

export interface ProductReports {
  totals: {
    total: number;
    paid: number;
    open: number;
    total_value: number;
    paid_value: number;
  };
  platformsPaid: Array<{ platform: string; qty: number; value: number }>;
  platformsOpen: Array<{ platform: string; qty: number; value: number }>;
  productsPaid: Array<{ name: string; platform: string; qty: number; value: number }>;
  productsOpen: Array<{ name: string; platform: string; qty: number; value: number }>;
}

export const getProductReports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ limit: z.number().int().min(1).max(50).default(20) }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<ProductReports> => {
    const { data: json, error } = await context.supabase.rpc("product_reports", {
      _limit: data.limit,
    });
    if (error) throw new Error(error.message);
    const r = (json ?? {}) as Partial<ProductReports>;
    return {
      totals: r.totals ?? { total: 0, paid: 0, open: 0, total_value: 0, paid_value: 0 },
      platformsPaid: r.platformsPaid ?? [],
      platformsOpen: r.platformsOpen ?? [],
      productsPaid: r.productsPaid ?? [],
      productsOpen: r.productsOpen ?? [],
    };
  });

const SaveInput = z.object({
  name: z.string().min(1),
  platform: z.string().default(""),
  ncm: z.string().default(""),
  category: z.string().default(""),
});

export const saveProductNcm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SaveInput.parse(d))
  .handler(async ({ data, context }) => {
    const digits = data.ncm.replace(/\D/g, "");
    const key = (v: string) => v.trim().toLowerCase();
    const { error } = await context.supabase.from("product_ncm").upsert(
      {
        name_key: key(data.name),
        platform_key: key(data.platform),
        name: data.name.trim(),
        platform: data.platform.trim(),
        ncm: digits,
        category: data.category.trim(),
        source: "manual",
        status: digits.length === 8 ? "ok" : "review",
        confidence: 1,
        rationale: "Definido manualmente pelo usuário.",
        verified_at: new Date().toISOString(),
      },
      { onConflict: "env,sandbox_owner,name_key,platform_key" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
