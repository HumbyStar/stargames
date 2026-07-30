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
  /** id numérico do repositório no GitHub — imune a renomeação/caixa alta. */
  repoId: number | null;
}

export interface GithubStatus {
  hasToken: boolean;
  config: GithubConfig;
  connected: boolean;
  account: { login: string; name: string | null; avatarUrl: string | null } | null;
  repo: { fullName: string; private: boolean; htmlUrl: string; defaultBranch: string } | null;
  error: string | null;
  errorStatus?: number | null;
  errorHints?: string[];
  scopes?: string[] | null;
  scopeWarning?: string | null;
}

const EMPTY_CONFIG: GithubConfig = {
  repoOwner: "",
  repoName: "",
  branch: "",
  autoPushBackup: false,
  repoId: null,
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
    repoId: typeof prefs.repoId === "number" ? prefs.repoId : null,
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

/** Traduz erros da API do GitHub em mensagens acionáveis em português. */
function describeGithubError(err: unknown): string {
  const e = err as Error & { status?: number; meta?: { rateRemaining: number | null; rateResetAt: string | null } };
  const raw = e?.message ?? "Falha na comunicação com o GitHub";
  const status = e?.status;
  if (status === 401) {
    return (
      "401 — token inválido, revogado ou expirado. Gere um novo Personal Access Token no GitHub " +
      "(Settings → Developer settings → Tokens) e salve novamente o secret GITHUB_TOKEN."
    );
  }
  if (status === 403) {
    const rate = e?.meta;
    if (rate && rate.rateRemaining === 0) {
      const when = rate.rateResetAt ? new Date(rate.rateResetAt).toLocaleTimeString("pt-BR") : "em breve";
      return `403 — limite de requisições do GitHub atingido. O acesso é liberado por volta de ${when}.`;
    }
    return (
      "403 — o token não tem permissão para esta operação. Verifique o escopo 'repo' (token clássico) " +
      "ou as permissões de Contents/Metadata (fine-grained) e, em repositórios de organização, autorize o token via SSO."
    );
  }
  return raw;
}

function scopeWarningFor(scopes: string[] | null | undefined): string | null {
  if (!scopes) return null; // fine-grained/GitHub App não expõe escopos
  if (scopes.length === 0) {
    return "O token não possui nenhum escopo — repositórios privados não serão listados nem aceitarão publicação.";
  }
  if (!scopes.includes("repo") && !scopes.includes("public_repo")) {
    return `O token tem apenas os escopos: ${scopes.join(", ")}. Adicione o escopo "repo" para acessar repositórios privados.`;
  }
  if (!scopes.includes("repo") && scopes.includes("public_repo")) {
    return "O token só tem 'public_repo' — repositórios privados não aparecerão na lista.";
  }
  return null;
}

/** Checklist mostrado quando o GitHub responde 404 para um repositório. */
function notFoundHints(target: string): string[] {
  return [
    `O nome precisa ser exatamente o do GitHub (maiúsculas/minúsculas contam): confira "${target}".`,
    "Token fine-grained limitado a repositórios selecionados: inclua este repositório em Repository access.",
    'Token clássico sem o escopo "repo": repositórios privados retornam 404 em vez de 403.',
    "Repositório de organização com SSO: autorize o token em Configure SSO na página de tokens do GitHub.",
    "A conta do token precisa ser dona ou colaboradora do repositório (convite pendente também causa 404).",
    "Prefira escolher o repositório pela lista suspensa — assim o nome e o id vêm direto da API.",
  ];
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

    const { githubFetch, githubFetchWithMeta } = await import("./github.server");
    try {
      const { data: me, meta } = await githubFetchWithMeta("/user");
      const scopes = meta.scopes;
      const scopeWarning = scopeWarningFor(scopes);
      let repo: GithubStatus["repo"] = null;
      if (config.repoOwner && config.repoName) {
        try {
          // Quando temos o id, consultamos por id: imune a renomeação e caixa alta.
          const r = config.repoId
            ? await githubFetch(`/repositories/${config.repoId}`)
            : await githubFetch(`/repos/${config.repoOwner}/${config.repoName}`);
          repo = {
            fullName: r.full_name,
            private: Boolean(r.private),
            htmlUrl: r.html_url,
            defaultBranch: r.default_branch,
          };
        } catch (err) {
          const raw = describeGithubError(err);
          const target = `${config.repoOwner}/${config.repoName}`;
          let message = raw;
          const status404 = (err as { status?: number })?.status === 404;
          const hints = status404 ? notFoundHints(target) : [];
          if ((err as { status?: number })?.status === 404) {
            // 404 no GitHub também significa "existe, mas o token não enxerga".
            let suggestion = "";
            try {
              const mine = await githubFetch(
                "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
              );
              const match = (Array.isArray(mine) ? mine : []).find(
                (r: any) =>
                  String(r.full_name).toLowerCase() === target.toLowerCase() ||
                  String(r.name).toLowerCase() === config.repoName.toLowerCase(),
              );
              if (match && match.full_name !== target) {
                suggestion = ` Encontrei um repositório parecido acessível pelo token: ${match.full_name} — selecione exatamente esse nome.`;
              }
            } catch {
              /* ignora falha da sugestão */
            }
            message =
              `O GitHub retornou 404 para "${target}". Isso acontece quando o repositório não existe com esse nome exato, ` +
              `ou quando o token não tem acesso a ele (token fine-grained limitado a repositórios selecionados, falta do escopo "repo" para repositórios privados, ` +
              `ou organização exigindo autorização SSO).${suggestion}`;
          }
          return {
            hasToken,
            config,
            connected: true,
            account: { login: me.login, name: me.name ?? null, avatarUrl: me.avatar_url ?? null },
            repo: null,
            error: message,
            errorStatus: (err as { status?: number })?.status ?? null,
            errorHints: hints,
            scopes,
            scopeWarning,
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
        errorStatus: null,
        errorHints: [],
        scopes,
        scopeWarning,
      };
    } catch (err) {
      return {
        hasToken,
        config,
        connected: false,
        account: null,
        repo: null,
        error: describeGithubError(err),
        errorStatus: (err as { status?: number })?.status ?? null,
        errorHints: [],
        scopes: null,
        scopeWarning: null,
      };
    }
  });

const configSchema = z.object({
  repoOwner: z.string().trim().max(100).regex(/^[A-Za-z0-9-_.]*$/, "Owner inválido"),
  repoName: z.string().trim().max(120).regex(/^[A-Za-z0-9-_.]*$/, "Nome de repositório inválido"),
  branch: z.string().trim().max(120).default(""),
  autoPushBackup: z.boolean(),
  repoId: z.number().int().positive().nullable().default(null),
});

/**
 * Confirma que o token realmente enxerga o repositório antes de salvar a seleção.
 * Consulta por id quando disponível (à prova de renomeação) e cai para dono/nome.
 */
export const verifyGithubRepoAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        fullName: z.string().trim().min(3).max(240),
        repoId: z.number().int().positive().nullable().default(null),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { githubFetch } = await import("./github.server");
    const [owner = "", name = ""] = data.fullName.split("/");
    if (!owner || !name) {
      return {
        ok: false as const,
        repo: null,
        status: 400,
        error: "Formato inválido. Use dono/repositório.",
        hints: [],
      };
    }
    try {
      const r = data.repoId
        ? await githubFetch(`/repositories/${data.repoId}`)
        : await githubFetch(`/repos/${owner}/${name}`);
      return {
        ok: true as const,
        repo: {
          id: r.id as number,
          fullName: r.full_name as string,
          owner: r.owner?.login as string,
          name: r.name as string,
          private: Boolean(r.private),
          htmlUrl: r.html_url as string,
          defaultBranch: (r.default_branch as string) ?? "main",
          canPush: Boolean(r.permissions?.push),
        },
        status: 200,
        error: null,
        hints: [] as string[],
      };
    } catch (err) {
      const status = (err as { status?: number })?.status ?? 0;
      let message = describeGithubError(err);
      let hints: string[] = [];
      if (status === 404) {
        hints = notFoundHints(data.fullName);
        let suggestion = "";
        try {
          const mine = await githubFetch(
            "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
          );
          const match = (Array.isArray(mine) ? mine : []).find(
            (r: any) =>
              String(r.full_name).toLowerCase() === data.fullName.toLowerCase() ||
              String(r.name).toLowerCase() === name.toLowerCase(),
          );
          if (match && match.full_name !== data.fullName) {
            suggestion = ` Existe um repositório acessível com nome parecido: ${match.full_name} — selecione exatamente esse.`;
          }
        } catch {
          /* sugestão é opcional */
        }
        message = `O GitHub retornou 404 para "${data.fullName}" — o token não enxerga esse repositório.${suggestion}`;
      }
      return { ok: false as const, repo: null, status, error: message, hints };
    }
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
    const { githubFetch, githubFetchWithMeta } = await import("./github.server");
    const collected: any[] = [];
    let complete = true;
    let pagesLoaded = 0;
    let scopes: string[] | null = null;

    // 1) repositórios do usuário (todas as páginas, até 500)
    try {
      for (let page = 1; page <= 5; page++) {
        const { data: batch, meta } = await githubFetchWithMeta(
          `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
        );
        if (page === 1) scopes = meta.scopes;
        if (!Array.isArray(batch) || batch.length === 0) break;
        collected.push(...batch);
        pagesLoaded = page;
        if (batch.length < 100) break;
        if (page === 5) complete = false; // pode haver mais páginas
      }
    } catch (err) {
      throw new Error(describeGithubError(err));
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
      id: r.id as number,
      fullName: r.full_name as string,
      owner: r.owner?.login as string,
      name: r.name as string,
      private: Boolean(r.private),
      defaultBranch: (r.default_branch as string) ?? "main",
      updatedAt: (r.updated_at as string) ?? null,
    }));

    const warnings: string[] = [];
    const scopeWarning = scopeWarningFor(scopes);
    if (scopeWarning) warnings.push(scopeWarning);
    if (!complete) {
      warnings.push(
        "A lista pode estar incompleta (mais de 500 repositórios). Use a busca ou digite o repositório manualmente.",
      );
    }

    return { repos, complete, pagesLoaded, total: repos.length, scopes, warnings };
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