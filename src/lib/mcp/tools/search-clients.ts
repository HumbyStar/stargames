import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { PROD_ENV, supabaseForUser } from "../supabase";

export default defineTool({
  name: "search_clients",
  title: "Buscar clientes",
  description:
    "Busca clientes de produção por nome ou telefone e devolve id, nome, telefone e tipo (comum/MGMV).",
  inputSchema: {
    query: z.string().describe("Trecho do nome ou do telefone do cliente."),
    limit: z.number().int().describe("Quantidade máxima de resultados (padrão 20).").optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const max = Math.min(Math.max(limit ?? 20, 1), 50);
    const term = `%${query.trim()}%`;
    const { data, error } = await supabase
      .from("clients")
      .select("id,name,phone,client_type,mgmv,folder")
      .eq("env", PROD_ENV)
      .or(`name.ilike.${term},phone.ilike.${term}`)
      .order("name")
      .limit(max);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { clients: data ?? [] },
    };
  },
});