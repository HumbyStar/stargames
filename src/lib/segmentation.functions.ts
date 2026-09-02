import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { fichaFromTextWithDefaults } from "@/lib/ficha-parse";
import type { SegmentProduct, SegmentRow } from "@/lib/segmentation-format";

export interface CategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  sort: number;
}

export interface PlatformStat {
  platformKey: string;
  platform: string;
  productsCount: number;
  categoryId: string | null;
}

const FiltersSchema = z.object({
  categoryId: z.string().uuid().nullable().optional(),
  platform: z.string().nullable().optional(),
  min: z.number().nonnegative().default(0),
  max: z.number().nonnegative().nullable().optional(),
  basis: z.enum(["total", "paid", "total_all"]).default("total"),
  excludeSituations: z.array(z.string()).default([]),
  sort: z
    .enum(["value_desc", "value_asc", "count_desc", "count_asc", "name_asc", "name_desc"])
    .default("value_desc"),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(5000).default(20),
});

type Filters = z.infer<typeof FiltersSchema>;

function rpcArgs(f: Filters) {
  return {
    _category_id: f.categoryId ?? undefined,
    _platform: f.platform || undefined,
    _min: f.min ?? 0,
    _max: f.max ?? undefined,
    _basis: f.basis,
    _exclude_situations: f.excludeSituations,
    _sort: f.sort,
    _page: f.page,
    _page_size: f.pageSize,
  };
}

function emailFromFicha(customerData: string | null): string {
  if (!customerData) return "";
  try {
    return fichaFromTextWithDefaults(customerData).email ?? "";
  } catch {
    return "";
  }
}

/** Árvore de categorias + estatísticas de plataformas do ambiente atual. */
export const getSegmentationSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ categories: CategoryNode[]; platforms: PlatformStat[]; situations: string[] }> => {
      const supabase = context.supabase;
      const [cats, stats, sit] = await Promise.all([
        supabase
          .from("product_categories")
          .select("id,name,parent_id,sort")
          .order("sort", { ascending: true }),
        supabase.rpc("segment_platform_stats"),
        supabase.from("products").select("situation").limit(5000),
      ]);
      if (cats.error) throw new Error(cats.error.message);
      if (stats.error) throw new Error(stats.error.message);

      const situations = Array.from(
        new Set((sit.data ?? []).map((r) => (r.situation ?? "").trim()).filter(Boolean)),
      ).sort();

      return {
        categories: (cats.data ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          parentId: c.parent_id,
          sort: c.sort,
        })),
        platforms: (stats.data ?? []).map((p) => ({
          platformKey: p.platform_key,
          platform: p.platform,
          productsCount: Number(p.products_count ?? 0),
          categoryId: p.category_id ?? null,
        })),
        situations,
      };
    },
  );

/** Página de clientes segmentados + totais do grupo. */
export const segmentClients = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => FiltersSchema.parse(d))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ rows: SegmentRow[]; totalCount: number; groupTotal: number }> => {
      const { data: rows, error } = await context.supabase.rpc("segment_clients", rpcArgs(data));
      if (error) throw new Error(error.message);
      const list = rows ?? [];
      return {
        rows: list.map((r) => ({
          clientId: r.client_id,
          name: r.client_name,
          phone: r.phone,
          email: emailFromFicha(r.customer_data),
          productsCount: Number(r.products_count ?? 0),
          spent: Number(r.spent ?? 0),
        })),
        totalCount: Number(list[0]?.total_count ?? 0),
        groupTotal: Number(list[0]?.group_total ?? 0),
      };
    },
  );

/** Produtos que compõem o valor gasto de um cliente. */
export const segmentClientProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        categoryId: z.string().uuid().nullable().optional(),
        platform: z.string().nullable().optional(),
        basis: z.enum(["total", "paid", "total_all"]).default("total"),
        excludeSituations: z.array(z.string()).default([]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<SegmentProduct[]> => {
    const { data: rows, error } = await context.supabase.rpc("segment_client_products", {
      _client_id: data.clientId,
      _category_id: data.categoryId ?? undefined,
      _platform: data.platform || undefined,
      _basis: data.basis,
      _exclude_situations: data.excludeSituations,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      platform: p.platform,
      category: p.category,
      registerDate: p.register_date,
      situation: p.situation,
      financialStatus: p.financial_status,
      value: Number(p.value ?? 0),
    }));
  });

/** Cria uma categoria (principal quando parentId é nulo). */
export const createProductCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(60),
        parentId: z.string().uuid().nullable().optional(),
        sort: z.number().int().default(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<CategoryNode> => {
    const { data: row, error } = await context.supabase
      .from("product_categories")
      .insert({ name: data.name, parent_id: data.parentId ?? null, sort: data.sort })
      .select("id,name,parent_id,sort")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id, name: row.name, parentId: row.parent_id, sort: row.sort };
  });

export const renameProductCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(60) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("product_categories")
      .update({ name: data.name })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteProductCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("product_categories")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Vincula (ou desvincula, com categoryId nulo) várias plataformas de uma vez. */
export const setPlatformCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        platforms: z.array(z.object({ key: z.string().min(1), label: z.string() })).min(1),
        categoryId: z.string().uuid().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; count: number }> => {
    const supabase = context.supabase;
    const keys = data.platforms.map((p) => p.key);

    if (!data.categoryId) {
      const { error } = await supabase.from("platform_categories").delete().in("platform_key", keys);
      if (error) throw new Error(error.message);
      return { ok: true, count: keys.length };
    }

    const { error: delErr } = await supabase
      .from("platform_categories")
      .delete()
      .in("platform_key", keys);
    if (delErr) throw new Error(delErr.message);

    const { error } = await supabase.from("platform_categories").insert(
      data.platforms.map((p) => ({
        platform_key: p.key,
        platform: p.label,
        category_id: data.categoryId!,
      })),
    );
    if (error) throw new Error(error.message);
    return { ok: true, count: keys.length };
  });

/** Registro de auditoria da exportação de segmentação. */
export const logSegmentExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        format: z.string(),
        rows: z.number().int(),
        filters: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const claimsEmail = (context.claims as { email?: string } | null)?.email ?? null;
    await supabaseAdmin.from("audit_log").insert({
      table_name: "segmentation_export",
      action: "INSERT",
      user_id: context.userId,
      user_email: claimsEmail,
      new_data: { format: data.format, rows: data.rows, filters: data.filters },
    });
    return { ok: true };
  });
