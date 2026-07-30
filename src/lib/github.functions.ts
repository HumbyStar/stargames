import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Integração GitHub — publicação de backups, exports e changelog.
// O código-fonte do sistema é sincronizado pelo GitHub nativo do Lovable;
// aqui tratamos apenas do conteúdo gerado pelo próprio sistema.
// ---------------------------------------------------------------------------

const SETTINGS_ID = "github";
const SETTINGS_ENV = "producao";
const BACKUP_BUCKET = "system-backups";
const MAX_PUSH_BYTES = 45 * 1024 * 1024; // limite prático da contents API

export interface GithubConfig {
  repoOwner: string;
  repoName: string;
  branch: string;
  autoPushBackup: boolean;
}

export interface GithubStatus {
  hasToken: boolean;
  config: GithubConfig;
  connected: boolean;
  account: { login: string; name: string | null; avatarUrl: string | null } | null;
  repo: { fullName: string; private: boolean; htmlUrl: string; defaultBranch: string } | null;
  error: string | null;
}

const EMPTY_CONFIG: GithubConfig = {
  repoOwner: "",
  repoName: "",
  branch: "",
  autoPushBackup: false,
};

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const [admin, adminMaster] = await Promise.all([
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin_master" }),
  ]);
  if (admin.error) throw new Error(admin.error.message);
  if (adminMaster.error) throw new Error(adminMaster.error.message);
  if (!admin.data && !adminMaster.data) throw new Error("Forbidden: admin only");
}

async function loadConfig(supabaseAdmin: any): Promise<GithubConfig> {
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("preferences")
    .eq("id", SETTINGS_ID)
    .maybeSingle();
  const prefs = (data?.preferences ?? {}) as Partial<GithubConfig>;
  return {
    repoOwner: prefs.repoOwner ?? "",
    repoName: prefs.repoName ?? "",
    branch: prefs.branch ?? "",
    autoPushBackup: Boolean(prefs.autoPushBackup),
  };
}

async function requireRepo(supabaseAdmin: any): Promise<GithubConfig> {
  const config = await loadConfig(supabaseAdmin);
  if (!config.repoOwner || !config.repoName) {
    throw new Error("Configure o repositório de destino antes de publicar.");
  }
  return config;
}

function stamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
}

export const getGithubStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GithubStatus> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const config = await loadConfig(supabaseAdmin);
    const hasToken = Boolean(process.env.GITHUB_TOKEN);
    if (!hasToken) {
      return { hasToken, config, connected: false, account: null, repo: null, error: null };
    }

    const { githubFetch } = await import("./github.server");
    try {
      const me = await githubFetch("/user");
      let repo: GithubStatus["repo"] = null;
      if (config.repoOwner && config.repoName) {
        try {
          const r = await githubFetch(`/repos/${config.repoOwner}/${config.repoName}`);
          repo = {
            fullName: r.full_name,
            private: Boolean(r.private),
            htmlUrl: r.html_url,
            defaultBranch: r.default_branch,
          };
        } catch (err) {
          return {
            hasToken,
            config,
            connected: true,
            account: { login: me.login, name: me.name ?? null, avatarUrl: me.avatar_url ?? null },
            repo: null,
            error: err instanceof Error ? err.message : "Repositório inacessível",
          };
        }
      }
      return {
        hasToken,
        config,
        connected: true,
        account: { login: me.login, name: me.name ?? null, avatarUrl: me.avatar_url ?? null },
        repo,
        error: null,
      };
    } catch (err) {
      return {
        hasToken,
        config,
        connected: false,
        account: null,
        repo: null,
        error: err instanceof Error ? err.message : "Falha ao validar o token",
      };
    }
  });

const configSchema = z.object({
  repoOwner: z.string().trim().max(100).regex(/^[A-Za-z0-9-_.]*$/, "Owner inválido"),
  repoName: z.string().trim().max(120).regex(/^[A-Za-z0-9-_.]*$/, "Nome de repositório inválido"),
  branch: z.string().trim().max(120).default(""),
  autoPushBackup: z.boolean(),
});

export const saveGithubConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => configSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings").upsert(
      {
        id: SETTINGS_ID,
        env: SETTINGS_ENV,
        preferences: data,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "id,env" },
    );
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const listGithubRepos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { githubFetch } = await import("./github.server");
    const collected: any[] = [];
    let complete = true;
    let pagesLoaded = 0;

    // 1) repositórios do usuário (todas as páginas, até 500)
    for (let page = 1; page <= 5; page++) {
      const batch = await githubFetch(
        `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      );
      if (!Array.isArray(batch) || batch.length === 0) break;
      collected.push(...batch);
      pagesLoaded = page;
      if (batch.length < 100) break;
      if (page === 5) complete = false; // pode haver mais páginas
    }

    // 2) fallback: tokens de GitHub App só enxergam repos via installations
    if (collected.length === 0) {
      try {
        const inst = await githubFetch("/installation/repositories?per_page=100");
        if (Array.isArray(inst?.repositories)) collected.push(...inst.repositories);
      } catch {
        /* token clássico/fine-grained: rota indisponível */
      }
    }

    const unique = new Map<string, any>();
    for (const r of collected) if (r?.full_name) unique.set(r.full_name, r);

    const repos = Array.from(unique.values()).map((r: any) => ({
      fullName: r.full_name as string,
      owner: r.owner?.login as string,
      name: r.name as string,
      private: Boolean(r.private),
      defaultBranch: (r.default_branch as string) ?? "main",
      updatedAt: (r.updated_at as string) ?? null,
    }));

    return { repos, complete, pagesLoaded, total: repos.length };
  });

export const pushBackupToGithub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ backupId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const config = await requireRepo(supabaseAdmin);
    const { putRepoFile, toBase64 } = await import("./github.server");

    const { data: row, error } = await supabaseAdmin
      .from("system_backups")
      .select("id, storage_path, size_bytes, created_at, env, status")
      .eq("id", data.backupId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.storage_path) throw new Error("Backup sem arquivo disponível.");
    if (row.status !== "completed") {
      throw new Error("Só é possível publicar backups concluídos.");
    }
    if ((row.size_bytes ?? 0) > MAX_PUSH_BYTES) {
      throw new Error(
        `Backup de ${((row.size_bytes ?? 0) / 1024 / 1024).toFixed(1)} MB excede o limite de 45 MB da API do GitHub.`,
      );
    }

    const { data: file, error: dlErr } = await supabaseAdmin.storage
      .from(BACKUP_BUCKET)
      .download(row.storage_path);
    if (dlErr || !file) throw new Error(dlErr?.message ?? "Falha ao baixar o backup.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_PUSH_BYTES) {
      throw new Error("Arquivo maior que 45 MB — envio pelo GitHub não é possível.");
    }

    const path = `backups/star-games-${stamp(new Date(row.created_at))}.zip`;
    const result = await putRepoFile({
      owner: config.repoOwner,
      repo: config.repoName,
      branch: config.branch || undefined,
      path,
      contentBase64: toBase64(bytes),
      message: `chore(backup): snapshot ${stamp(new Date(row.created_at))} (${row.env})`,
    });
    return { path: result.path, htmlUrl: result.htmlUrl, sizeBytes: bytes.byteLength };
  });

export const pushExportsToGithub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const config = await requireRepo(supabaseAdmin);
    const { putRepoFile, toCsv } = await import("./github.server");

    const { data: envRow } = await context.supabase.rpc("current_env");
    const env: "producao" | "sandbox" = envRow === "sandbox" ? "sandbox" : "producao";

    const tables = ["clients", "products", "mgmv_agreements"] as const;
    const written: { path: string; rows: number }[] = [];
    const day = stamp().slice(0, 10);

    for (const table of tables) {
      const rows: Record<string, unknown>[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data: page, error } = await supabaseAdmin
          .from(table)
          .select("*")
          .eq("env", env)
          .order("id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw new Error(`${table}: ${error.message}`);
        rows.push(...((page ?? []) as Record<string, unknown>[]));
        if (!page || page.length < pageSize) break;
      }
      const csv = toCsv(rows);
      const path = `exports/${day}/${table}.csv`;
      await putRepoFile({
        owner: config.repoOwner,
        repo: config.repoName,
        branch: config.branch || undefined,
        path,
        contentBase64: btoa(unescape(encodeURIComponent(csv || "sem registros\n"))),
        message: `chore(export): ${table} — ${day} (${env})`,
      });
      written.push({ path, rows: rows.length });
    }
    return { files: written };
  });

export const pushChangelogToGithub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const config = await requireRepo(supabaseAdmin);
    const { putRepoFile } = await import("./github.server");

    const { data: rows, error } = await supabaseAdmin
      .from("audit_log")
      .select("changed_at, action, table_name, row_id, user_email")
      .order("changed_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const actionLabel: Record<string, string> = {
      INSERT: "criou",
      UPDATE: "alterou",
      DELETE: "removeu",
    };
    const lines: string[] = [
      "# Changelog operacional — Star Games",
      "",
      `Gerado automaticamente em ${new Date().toLocaleString("pt-BR")}. Últimas ${rows?.length ?? 0} ações registradas.`,
      "",
    ];
    let currentDay = "";
    for (const r of rows ?? []) {
      const date = new Date(r.changed_at as string);
      const day = date.toLocaleDateString("pt-BR");
      if (day !== currentDay) {
        currentDay = day;
        lines.push("", `## ${day}`, "");
      }
      const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      const who = (r.user_email as string) ?? "sistema";
      const what = actionLabel[r.action as string] ?? (r.action as string);
      lines.push(`- \`${time}\` **${who}** ${what} registro em \`${r.table_name}\`${r.row_id ? ` (${r.row_id})` : ""}`);
    }

    const md = lines.join("\n") + "\n";
    const result = await putRepoFile({
      owner: config.repoOwner,
      repo: config.repoName,
      branch: config.branch || undefined,
      path: "CHANGELOG.md",
      contentBase64: btoa(unescape(encodeURIComponent(md))),
      message: `docs(changelog): atualização ${stamp()}`,
    });
    return { path: result.path, htmlUrl: result.htmlUrl, entries: rows?.length ?? 0 };
  });

const issueSchema = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().max(8000).default(""),
  labels: z.array(z.string().trim().max(50)).max(10).default([]),
});

export const createGithubIssue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => issueSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const config = await requireRepo(supabaseAdmin);
    const { githubFetch } = await import("./github.server");
    const issue = await githubFetch(`/repos/${config.repoOwner}/${config.repoName}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: data.title,
        body: `${data.body}\n\n---\nAberto pelo Star Games por ${(context.claims as { email?: string } | null)?.email ?? context.userId}.`,
        labels: data.labels,
      }),
    });
    return { number: issue.number as number, htmlUrl: issue.html_url as string };
  });