import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { PROD_ENV, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_products",
  title: "Listar produtos",
  description:
    "Lista produtos de produção com filtros opcionais por status financeiro (Pago, Reserva, Pendente, MGMV), situação (Em Aberto, Enviado, Retirado, Removido) e vencidos.",
  inputSchema: {
    financial_status: z.string().describe("Status financeiro exato, ex.: Pago.").optional(),
    situation: z.string().describe("Situação exata, ex.: Em Aberto.").optional(),
    overdue_only: z.boolean().describe("Apenas itens com vencimento no passado.").optional(),
    limit: z.number().int().describe("Máximo de linhas (padrão 50).").optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ financial_status, situation, overdue_only, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const max = Math.min(Math.max(limit ?? 50, 1), 200);
    let q = supabase
      .from("products")
      .select(
        "id,client_id,name,platform,financial_status,situation,total_value,paid_value,due_date,register_date",
      )
      .eq("env", PROD_ENV);
    if (financial_status) q = q.eq("financial_status", financial_status);
    if (situation) q = q.eq("situation", situation);
    if (overdue_only) q = q.lt("due_date", new Date().toISOString().slice(0, 10));
    const { data, error } = await q.order("due_date", { ascending: true }).limit(max);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { products: data ?? [] },
    };
  },
});