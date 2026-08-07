import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { NcmResult } from "@/lib/product-ncm.server";

const BatchInput = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        platform: z.string().default(""),
      }),
    )
    .min(1)
    .max(30),
});

export const classifyNcmBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => BatchInput.parse(d))
  .handler(async ({ data, context }): Promise<{ results: NcmResult[]; saved: number }> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("LOVABLE_API_KEY ausente no servidor.");
    const { classifyWithDoubleCheck, upsertNcmRows } = await import("@/lib/product-ncm.server");
    const results = await classifyWithDoubleCheck(key, data.items);
    const saved = await upsertNcmRows(context.supabase, results);
    return { results, saved };
  });

const PendingInput = z.object({
  limit: z.number().int().min(1).max(2000).default(500),
  platform: z.string().default(""),
});

export const applyNcmRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PendingInput.parse(d ?? {}))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ processed: number; saved: number; remaining: number }> => {
      const { data: rows, error } = await context.supabase.rpc("product_catalog", {
        _search: "",
        _platform: data.platform,
        _sort: "qty_desc",
        _page: 1,
        _page_size: Math.min(data.limit, 200),
        _only_missing_ncm: true,
      });
      if (error) throw new Error(error.message);
      const list = (rows ?? []) as Array<Record<string, unknown>>;
      const items = list.map((r) => ({
        name: String(r.name ?? ""),
        platform: String(r.platform ?? ""),
      }));
      const remaining = Number(list[0]?.total_count ?? 0);
      if (!items.length) return { processed: 0, saved: 0, remaining: 0 };
      const { classifyByRules, upsertNcmRows } = await import("@/lib/product-ncm.server");
      const results = classifyByRules(items);
      const saved = await upsertNcmRows(context.supabase, results);
      return { processed: results.length, saved, remaining };
    },
  );

export const listPendingNcmItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PendingInput.parse(d ?? {}))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ items: Array<{ name: string; platform: string }>; remaining: number }> => {
      const { data: rows, error } = await context.supabase.rpc("product_catalog", {
        _search: "",
        _platform: data.platform,
        _sort: "qty_desc",
        _page: 1,
        _page_size: Math.min(data.limit, 200),
        _only_missing_ncm: true,
      });
      if (error) throw new Error(error.message);
      const list = (rows ?? []) as Array<Record<string, unknown>>;
      return {
        items: list.map((r) => ({
          name: String(r.name ?? ""),
          platform: String(r.platform ?? ""),
        })),
        remaining: Number(list[0]?.total_count ?? 0),
      };
    },
  );
