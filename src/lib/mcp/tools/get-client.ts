import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { PROD_ENV, supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_client",
  title: "Detalhes do cliente",
  description:
    "Retorna a ficha de um cliente de produção: dados cadastrais, produtos (status financeiro, situação, valores) e acordos MGMV.",
  inputSchema: {
    client_id: z.string().describe("ID do cliente (use search_clients para descobrir)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ client_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data: client, error } = await supabase
      .from("clients")
      .select("id,name,phone,client_type,mgmv,folder,notes,customer_data,created_at")
      .eq("env", PROD_ENV)
      .eq("id", client_id)
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!client) return { content: [{ type: "text", text: "Cliente não encontrado" }], isError: true };

    const [{ data: products }, { data: agreements }] = await Promise.all([
      supabase
        .from("products")
        .select(
          "id,name,platform,financial_status,situation,total_value,paid_value,due_date,register_date,included_in_mgmv",
        )
        .eq("env", PROD_ENV)
        .eq("client_id", client_id)
        .order("register_date", { ascending: false })
        .limit(200),
      supabase
        .from("mgmv_agreements")
        .select(
          "id,status,total_agreement_value,paid_value,remaining_value,installments_count,paid_installments,pending_installments,next_due_date,review_status",
        )
        .eq("env", PROD_ENV)
        .eq("client_id", client_id),
    ]);

    const payload = { client, products: products ?? [], mgmv_agreements: agreements ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});