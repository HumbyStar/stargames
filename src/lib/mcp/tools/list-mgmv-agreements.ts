import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { PROD_ENV, supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_mgmv_agreements",
  title: "Listar acordos MGMV",
  description:
    "Lista acordos MGMV de produção com filtro opcional por status (ex.: active, completed) e por acordos com parcelas em atraso.",
  inputSchema: {
    status: z.string().describe("Status do acordo, ex.: active.").optional(),
    overdue_only: z.boolean().describe("Apenas acordos com próxima parcela vencida.").optional(),
    limit: z.number().int().describe("Máximo de linhas (padrão 50).").optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, overdue_only, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const max = Math.min(Math.max(limit ?? 50, 1), 200);
    let q = supabase
      .from("mgmv_agreements")
      .select(
        "id,client_id,client_name,client_phone,status,total_agreement_value,paid_value,remaining_value,installments_count,paid_installments,pending_installments,next_due_date,review_status",
      )
      .eq("env", PROD_ENV);
    if (status) q = q.eq("status", status);
    if (overdue_only) q = q.lt("next_due_date", new Date().toISOString().slice(0, 10));
    const { data, error } = await q.order("next_due_date", { ascending: true }).limit(max);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { agreements: data ?? [] },
    };
  },
});