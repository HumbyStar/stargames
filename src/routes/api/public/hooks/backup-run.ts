import { createFileRoute } from "@tanstack/react-router";

// Endpoint chamado pelo pg_cron para gerar backup agendado.
// Autenticação: apikey publishable no header (padrão dos cron endpoints).
// O prefixo /api/public/* já bypassa auth do site publicado; validamos o
// apikey aqui para bloquear execuções externas anônimas.

export const Route = createFileRoute("/api/public/hooks/backup-run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey =
          request.headers.get("apikey") ??
          request.headers.get("x-supabase-apikey") ??
          "";
        const expected =
          process.env.SUPABASE_PUBLISHABLE_KEY ??
          process.env.SUPABASE_ANON_KEY ??
          "";
        if (!expected || apikey !== expected) {
          return new Response(
            JSON.stringify({ ok: false, error: "unauthorized" }),
            { status: 401, headers: { "Content-Type": "application/json" } },
          );
        }

        try {
          const body = await request.json().catch(() => ({}) as any);
          const backupId = typeof body?.backupId === "string" ? body.backupId : null;
          const mod = await import("@/lib/backup.functions");
          // Continuação de um backup pausado (execução em etapas) ou
          // início de um backup agendado.
          const result = backupId
            ? await mod.continueBackupById(backupId)
            : await mod.runScheduledBackup();
          return Response.json({ ok: true, ...result });
        } catch (err: any) {
          console.error("[backup-run] failed:", err);
          return new Response(
            JSON.stringify({ ok: false, error: err?.message ?? String(err) }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});