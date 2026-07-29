import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface NfInvoiceRow {
  id: string;
  clientId: string;
  content: string;
  totalCents: number;
  productIds: string[];
  createdAt: string;
  generatedBy: string | null;
}

const SaveSchema = z.object({
  clientId: z.string().uuid(),
  content: z.string().min(1),
  totalCents: z.number().int().nonnegative(),
  productIds: z.array(z.string()).default([]),
});

export const saveNfInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.infer<typeof SaveSchema>) => SaveSchema.parse(data))
  .handler(async ({ data, context }): Promise<NfInvoiceRow> => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("nf_invoices")
      .insert({
        client_id: data.clientId,
        content: data.content,
        total_cents: data.totalCents,
        product_ids: data.productIds,
        generated_by: userId,
      })
      .select("*")
      .single();
    if (error || !row) throw new Error(error?.message ?? "Falha ao salvar nota");
    return {
      id: row.id,
      clientId: row.client_id,
      content: row.content,
      totalCents: row.total_cents,
      productIds: row.product_ids ?? [],
      createdAt: row.created_at,
      generatedBy: row.generated_by,
    };
  });

export const listNfInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { clientId: string }) =>
    z.object({ clientId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }): Promise<NfInvoiceRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("nf_invoices")
      .select("*")
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((row) => ({
      id: row.id,
      clientId: row.client_id,
      content: row.content,
      totalCents: row.total_cents,
      productIds: row.product_ids ?? [],
      createdAt: row.created_at,
      generatedBy: row.generated_by,
    }));
  });

export const deleteNfInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("nf_invoices")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true } as const;
  });