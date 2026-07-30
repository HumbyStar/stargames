// Helpers server-only para falar com a API do GitHub.
// Nunca importar em componentes — o token vive apenas aqui.

const GITHUB_API = "https://api.github.com";

export function getGithubToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "Token do GitHub não configurado. Peça ao administrador para salvar o secret GITHUB_TOKEN.",
    );
  }
  return token;
}

export async function githubFetch(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<any> {
  const token = init.token ?? getGithubToken();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${GITHUB_API}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[github] ${init.method ?? "GET"} ${path} -> ${res.status}: ${text}`);
    let message = text;
    try {
      const parsed = JSON.parse(text);
      message = parsed.message ?? text;
    } catch {
      /* corpo não-JSON */
    }
    throw new Error(`GitHub respondeu ${res.status}: ${message}`);
  }
  return text ? JSON.parse(text) : null;
}

/** Converte bytes em base64 sem estourar a pilha com arquivos grandes. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Cria ou atualiza um arquivo no repositório (contents API).
 * Se o arquivo já existir, busca o `sha` antes para não falhar com 409.
 */
export async function putRepoFile(opts: {
  owner: string;
  repo: string;
  path: string;
  contentBase64: string;
  message: string;
  branch?: string;
}): Promise<{ path: string; htmlUrl: string | null }> {
  const { owner, repo, path, contentBase64, message, branch } = opts;
  const encodedPath = path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");

  let sha: string | undefined;
  try {
    const existing = await githubFetch(
      `/repos/${owner}/${repo}/contents/${encodedPath}${branch ? `?ref=${encodeURIComponent(branch)}` : ""}`,
    );
    if (existing && !Array.isArray(existing) && existing.sha) sha = existing.sha as string;
  } catch {
    // 404 = arquivo novo; segue sem sha.
  }

  const result = await githubFetch(`/repos/${owner}/${repo}/contents/${encodedPath}`, {
    method: "PUT",
    body: JSON.stringify({ message, content: contentBase64, sha, branch }),
  });
  return {
    path,
    htmlUrl: result?.content?.html_url ?? null,
  };
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const columns = Array.from(
    rows.reduce<Set<string>>((set, row) => {
      Object.keys(row).forEach((k) => set.add(k));
      return set;
    }, new Set()),
  );
  const escape = (value: unknown) => {
    if (value === null || value === undefined) return "";
    const str = typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n;]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((c) => escape(row[c])).join(","));
  return lines.join("\n");
}