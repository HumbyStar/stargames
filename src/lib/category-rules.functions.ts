import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { CategoryRule } from "@/lib/category-rules";

/** Linha dedicada em app_settings para as regras de categoria. */
const ROW_ID = "category_rules";

const RuleSchema = z.object({
  id: z.string().min(1),
  nome: z.string().min(1).max(120),
  categoryId: z.string().uuid().nullable(),
  palavras: z.array(z.string().max(80)).max(400),
});

function parseRules(value: unknown): CategoryRule[] {
  const list = (value as Record<string, unknown> | null | undefined)?.["categoryRules"];
  const parsed = z.array(RuleSchema).safeParse(list);
  return parsed.success ? parsed.data : [];
}

/** Lê as regras de categoria do ambiente atual. */
export const getCategoryRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CategoryRule[]> => {
    const { data, error } = await context.supabase
      .from("app_settings")
      .select("rules")
      .eq("id", ROW_ID)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return parseRules((data as { rules?: unknown } | null)?.rules);
  });

/** Grava a lista completa de regras (substitui). */
export const saveCategoryRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rules: z.array(RuleSchema).max(100) }).parse(d))
  .handler(async ({ data, context }): Promise<CategoryRule[]> => {
    const supabase = context.supabase;
    const { data: existing, error: readErr } = await supabase
      .from("app_settings")
      .select("id")
      .eq("id", ROW_ID)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);

    const payload = { rules: { categoryRules: data.rules } };
    if (existing) {
      const { error } = await supabase.from("app_settings").update(payload).eq("id", ROW_ID);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("app_settings")
        .insert({ id: ROW_ID, ...payload } as never);
      if (error) throw new Error(error.message);
    }
    return data.rules;
  });
