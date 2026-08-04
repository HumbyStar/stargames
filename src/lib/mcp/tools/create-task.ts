import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { PROD_ENV, supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_task",
  title: "Criar tarefa da equipe",
  description:
    "Cria uma tarefa operacional para a equipe (cobrança, MGMV, envio, importação, etc.) no ambiente de produção.",
  inputSchema: {
    title: z.string().describe("Título curto da tarefa."),
    description: z.string().describe("Detalhes da tarefa.").optional(),
    task_type: z
      .string()
      .describe("Tipo: cobranca, mgmv, envio, importacao, revisao_ia, cadastro, financeiro, atendimento.")
      .optional(),
    priority: z.string().describe("baixa, media, alta ou urgente.").optional(),
    client_id: z.string().describe("Cliente relacionado, se houver.").optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    }
    const userId = ctx.getUserId();
    if (!userId) {
      return { content: [{ type: "text", text: "Usuário não identificado" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("team_tasks")
      .insert({
        title: input.title.trim().slice(0, 200),
        description: input.description?.slice(0, 2000) ?? null,
        task_type: input.task_type ?? null,
        priority: input.priority ?? "media",
        client_id: input.client_id ?? null,
        created_by: userId,
        source: "mcp",
        env: PROD_ENV,
      })
      .select("id,title,status,priority,task_type")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { task: data },
    };
  },
});