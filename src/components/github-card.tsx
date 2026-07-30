import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Github,
  HardDrive,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui-bits";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getGithubStatus,
  saveGithubConfig,
  listGithubRepos,
  verifyGithubRepoAccess,
  pushBackupToGithub,
  pushExportsToGithub,
  pushChangelogToGithub,
  type GithubStatus,
} from "@/lib/github.functions";
import { listBackups } from "@/lib/backup.functions";
import { emitAppEvent } from "@/lib/app-events";

type RepoOption = {
  id?: number;
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const LS_REPO = "stargames.github.repo";
const LS_BRANCH = "stargames.github.branch";
const LS_REPO_ID = "stargames.github.repoId";
const LS_REPOS_CACHE = "stargames.github.repos.cache";
const CACHE_TTL_MS = 30 * 60 * 1000;

type ReposCache = {
  login: string;
  savedAt: number;
  complete: boolean;
  repos: RepoOption[];
};

function readReposCache(): ReposCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_REPOS_CACHE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReposCache;
    if (!Array.isArray(parsed?.repos) || typeof parsed.savedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeReposCache(cache: ReposCache) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_REPOS_CACHE, JSON.stringify(cache));
  } catch {
    /* storage indisponível */
  }
}

function clearReposCache() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LS_REPOS_CACHE);
  } catch {
    /* storage indisponível */
  }
}

function minutesAgo(ts: number) {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return "agora mesmo";
  if (mins === 1) return "há 1 minuto";
  return `há ${mins} minutos`;
}

function readLocalPref(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeLocalPref(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* storage indisponível */
  }
}

export function GithubCard() {
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposLoaded, setReposLoaded] = useState(false);
  const [reposComplete, setReposComplete] = useState(true);
  const [reposError, setReposError] = useState<string | null>(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [selectedRepoId, setSelectedRepoId] = useState<number | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [accessError, setAccessError] = useState<{ message: string; hints: string[] } | null>(null);
  const [branch, setBranch] = useState("");
  const [reposWarnings, setReposWarnings] = useState<string[]>([]);
  const [cacheInfo, setCacheInfo] = useState<{ savedAt: number; fromCache: boolean } | null>(null);
  const [branchTouched, setBranchTouched] = useState(false);
  const [autoPushBackup, setAutoPushBackup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<{ label: string; url: string | null }[]>([]);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const s = await getGithubStatus();
      setStatus(s);
      const savedRepo =
        s.config.repoOwner && s.config.repoName
          ? `${s.config.repoOwner}/${s.config.repoName}`
          : "";
      // Restaura a última escolha local quando ainda não há config salva.
      const localRepo = readLocalPref(LS_REPO);
      const localBranch = readLocalPref(LS_BRANCH);
      setSelectedRepo(savedRepo || localRepo || "");
      const localId = Number(readLocalPref(LS_REPO_ID));
      setSelectedRepoId(
        s.config.repoId ?? (savedRepo ? null : Number.isFinite(localId) && localId > 0 ? localId : null),
      );
      const restoredBranch = s.config.branch || (savedRepo ? "" : localBranch) || "";
      setBranch(restoredBranch);
      setBranchTouched(Boolean(restoredBranch));
      setAutoPushBackup(s.config.autoPushBackup);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar o status do GitHub");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRepos = async (silent = false, force = false) => {
    const login = status?.account?.login ?? "";
    if (!force) {
      const cache = readReposCache();
      if (
        cache &&
        cache.repos.length > 0 &&
        Date.now() - cache.savedAt < CACHE_TTL_MS &&
        (!login || cache.login === login)
      ) {
        setRepos(cache.repos);
        setReposComplete(cache.complete);
        setReposLoaded(true);
        setReposError(null);
        setCacheInfo({ savedAt: cache.savedAt, fromCache: true });
        return;
      }
    }
    setReposLoading(true);
    setReposError(null);
    try {
      const result = await listGithubRepos();
      setRepos(result.repos);
      setReposComplete(result.complete);
      setReposLoaded(true);
      setReposWarnings(result.warnings ?? []);
      const savedAt = Date.now();
      setCacheInfo({ savedAt, fromCache: false });
      if (result.repos.length > 0) {
        writeReposCache({ login, savedAt, complete: result.complete, repos: result.repos });
      }
      if (result.repos.length === 0) {
        setReposError(
          "Nenhum repositório acessível com esse token. Verifique se o token tem o escopo 'repo' (clássico) ou permissão de leitura em Contents/Metadata (fine-grained), se ele não expirou e se a organização autorizou o token via SSO.",
        );
      } else if (!silent) {
        toast.success(
          `${result.repos.length} repositório(s) carregados${result.complete ? "" : " (lista parcial)"}.`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao listar repositórios";
      setReposError(message);
      setReposLoaded(true);
      if (!silent) toast.error(message);
    } finally {
      setReposLoading(false);
    }
  };

  const handleClearCache = () => {
    clearReposCache();
    setRepos([]);
    setReposLoaded(false);
    setReposError(null);
    setReposWarnings([]);
    setCacheInfo(null);
    toast.success("Cache de repositórios limpo. Clique em \"Atualizar lista\" para recarregar.");
  };

  // Branch padrão detectada para o repositório atual.
  const detectedBranch = useMemo(() => {
    if (status?.repo && status.repo.fullName === selectedRepo) return status.repo.defaultBranch;
    return repos.find((r) => r.fullName === selectedRepo)?.defaultBranch ?? "";
  }, [status?.repo, repos, selectedRepo]);

  // Pré-seleciona a branch padrão enquanto o usuário não digitar a sua.
  useEffect(() => {
    if (!branchTouched && detectedBranch && branch !== detectedBranch) {
      setBranch(detectedBranch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectedBranch, branchTouched]);

  const repoUrl = useMemo(() => {
    if (status?.repo && status.repo.fullName === selectedRepo) return status.repo.htmlUrl;
    return /^[^/\s]+\/[^/\s]+$/.test(selectedRepo.trim())
      ? `https://github.com/${selectedRepo.trim()}`
      : null;
  }, [status?.repo, selectedRepo]);

  /** Confirma com a API que o token enxerga o repositório antes de fixar a seleção. */
  const verifyRepo = async (fullName: string, repoId: number | null) => {
    setVerifying(true);
    setAccessError(null);
    try {
      const res = await verifyGithubRepoAccess({ data: { fullName, repoId } });
      if (res.ok && res.repo) {
        setSelectedRepo(res.repo.fullName);
        setSelectedRepoId(res.repo.id);
        if (!branchTouched) setBranch(res.repo.defaultBranch);
        if (!res.repo.canPush) {
          setAccessError({
            message: `O token enxerga ${res.repo.fullName}, mas não tem permissão de escrita (push).`,
            hints: [
              "Token clássico: use o escopo 'repo' completo.",
              "Token fine-grained: dê permissão de Contents = Read and write.",
              "Confirme que a conta do token é colaboradora com papel Write ou superior.",
            ],
          });
        } else {
          toast.success(`Acesso confirmado a ${res.repo.fullName}.`);
        }
        return res.repo;
      }
      setAccessError({ message: res.error ?? "Repositório inacessível.", hints: res.hints ?? [] });
      return null;
    } catch (err) {
      setAccessError({
        message: err instanceof Error ? err.message : "Falha ao verificar o repositório",
        hints: [],
      });
      return null;
    } finally {
      setVerifying(false);
    }
  };

  const handleSelectRepo = (value: string) => {
    const option = repos.find((r) => r.fullName === value);
    setSelectedRepo(value);
    setSelectedRepoId(option?.id ?? null);
    void verifyRepo(value, option?.id ?? null);
  };

  const handleRetryVerify = () => {
    if (!/^[^/\s]+\/[^/\s]+$/.test(selectedRepo.trim())) {
      toast.error("Informe o repositório no formato dono/repositório.");
      return;
    }
    void verifyRepo(selectedRepo.trim(), selectedRepoId);
  };

  // Carrega a lista de repositórios assim que a conexão estiver validada.
  useEffect(() => {
    if (status?.connected && repos.length === 0 && !reposLoading) {
      void loadRepos(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.connected]);

  const repoOptions = useMemo(() => {
    if (selectedRepo && !repos.some((r) => r.fullName === selectedRepo)) {
      const [owner, name] = selectedRepo.split("/");
      return [
        { fullName: selectedRepo, owner, name, private: true, defaultBranch: "main" },
        ...repos,
      ];
    }
    return repos;
  }, [repos, selectedRepo]);

  const filteredRepoOptions = useMemo(() => {
    const term = repoSearch.trim().toLowerCase();
    if (!term) return repoOptions;
    return repoOptions.filter((r) => r.fullName.toLowerCase().includes(term));
  }, [repoOptions, repoSearch]);

  // Persiste localmente a última escolha para não precisar selecionar de novo.
  useEffect(() => {
    writeLocalPref(LS_REPO, selectedRepo);
  }, [selectedRepo]);
  useEffect(() => {
    writeLocalPref(LS_BRANCH, branch);
  }, [branch]);
  useEffect(() => {
    writeLocalPref(LS_REPO_ID, selectedRepoId ? String(selectedRepoId) : "");
  }, [selectedRepoId]);

  const handleSave = async () => {
    if (!/^[^/\s]+\/[^/\s]+$/.test(selectedRepo.trim())) {
      toast.error("Informe o repositório no formato dono/repositório.");
      return;
    }
    setSaving(true);
    try {
      const verified = await verifyRepo(selectedRepo.trim(), selectedRepoId);
      if (!verified) {
        toast.error("O token não tem acesso a esse repositório — veja as verificações abaixo.");
        return;
      }
      const owner = verified.owner;
      const name = verified.name;
      await saveGithubConfig({
        data: {
          repoOwner: owner,
          repoName: name,
          branch: branch.trim(),
          autoPushBackup,
          repoId: verified.id,
        },
      });
      toast.success("Configuração do GitHub salva.");
      emitAppEvent({
        category: "github",
        title: "Configuração do GitHub atualizada",
        description: selectedRepo ? `Repositório de destino: ${selectedRepo}` : undefined,
        severity: "success",
      });
      await loadStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const ensureRepoSaved = async () => {
    const repo = selectedRepo.trim();
    if (!repo) {
      throw new Error("Selecione ou digite um repositório (dono/repositório) antes de publicar.");
    }
    const savedRepo = status?.config.repoOwner
      ? `${status.config.repoOwner}/${status.config.repoName}`
      : "";
    if (savedRepo === repo && (status?.config.branch ?? "") === branch.trim()) return;
    const [owner = "", name = ""] = repo.split("/");
    if (!owner || !name) {
      throw new Error("Repositório inválido. Use o formato dono/repositório.");
    }
    const verified = await verifyRepo(repo, selectedRepoId);
    if (!verified) {
      throw new Error(
        "O token não tem acesso a esse repositório. Veja as verificações no bloco de erro e escolha o repositório pela lista.",
      );
    }
    await saveGithubConfig({
      data: {
        repoOwner: verified.owner,
        repoName: verified.name,
        branch: branch.trim(),
        autoPushBackup,
        repoId: verified.id,
      },
    });
    await loadStatus();
  };

  const runAction = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await ensureRepoSaved();
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao publicar no GitHub");
    } finally {
      setBusy(null);
    }
  };

  const handlePushBackup = () =>
    runAction("backup", async () => {
      const backups = await listBackups();
      const latest = backups.find((b) => b.status === "completed" && b.storagePath);
      if (!latest) throw new Error("Nenhum backup concluído disponível para publicar.");
      const res = await pushBackupToGithub({ data: { backupId: latest.id } });
      toast.success(`Backup publicado (${formatBytes(res.sizeBytes)}).`);
      setLastResults([{ label: res.path, url: res.htmlUrl }]);
      emitAppEvent({
        category: "github",
        title: "Backup publicado no GitHub",
        description: res.path,
        severity: "success",
      });
    });

  const handlePushExports = () =>
    runAction("exports", async () => {
      const res = await pushExportsToGithub();
      toast.success("Exports (CSV) publicados no repositório.");
      setLastResults(res.files.map((f) => ({ label: `${f.path} · ${f.rows} linhas`, url: null })));
      emitAppEvent({
        category: "github",
        title: "Exports publicados no GitHub",
        description: res.files.map((f) => `${f.path} (${f.rows})`).join(" · "),
        severity: "success",
      });
    });

  const handlePushChangelog = () =>
    runAction("changelog", async () => {
      const res = await pushChangelogToGithub();
      toast.success(`Changelog atualizado com ${res.entries} ações.`);
      setLastResults([{ label: res.path, url: res.htmlUrl }]);
      emitAppEvent({
        category: "github",
        title: "Changelog publicado no GitHub",
        description: `${res.entries} ações registradas`,
        severity: "success",
      });
    });

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando integração do GitHub…
        </div>
      </Card>
    );
  }

  const hasRepo = Boolean(status?.repo);
  const actionsDisabled = busy !== null;

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg border border-border/60 bg-muted/40 p-2">
              <Github className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold">Conectar conta GitHub</h3>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Uma conta de serviço publica backups, exports e o changelog do sistema em um
                repositório. Dê acesso aos demais usuários adicionando-os como colaboradores no
                próprio GitHub.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadStatus()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Atualizar
          </Button>
        </div>

        <div className="mt-5 rounded-lg border border-border/60 bg-card/50 p-4">
          {!status?.hasToken ? (
            <div className="flex items-start gap-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
              <div>
                <p className="font-medium">Token do GitHub não configurado</p>
                <p className="text-muted-foreground">
                  Peça ao administrador para salvar o secret <code>GITHUB_TOKEN</code> (Personal
                  Access Token com escopo <code>repo</code>) para habilitar a publicação.
                </p>
              </div>
            </div>
          ) : status.connected ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="font-medium">
                Conectado como {status.account?.name ?? status.account?.login}
              </span>
              <Badge variant="secondary">@{status.account?.login}</Badge>
              {status.repo && (
                <a
                  className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                  href={status.repo.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {status.repo.fullName} <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              {status.repo && (
                <Badge variant={status.repo.private ? "secondary" : "outline"}>
                  {status.repo.private ? "Privado" : "Público"}
                </Badge>
              )}
            </div>
          ) : (
            <div className="flex items-start gap-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
              <div>
                <p className="font-medium">Não foi possível validar o token</p>
                <p className="text-muted-foreground">{status.error}</p>
              </div>
            </div>
          )}
          {status?.hasToken && status.connected && status.error && (
            <p className="mt-3 text-sm text-destructive">{status.error}</p>
          )}
          {status?.connected && status.scopeWarning && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{status.scopeWarning}</span>
            </div>
          )}
          {status?.connected && status.scopes && status.scopes.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Escopos do token: {status.scopes.join(", ")}
            </p>
          )}
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-base font-semibold">Repositório de destino</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Repositório</Label>
            <div className="flex gap-2">
              <Select value={selectedRepo} onValueChange={handleSelectRepo}>
                <SelectTrigger className="flex-1">
                  <SelectValue
                    placeholder={
                      reposLoading
                        ? "Carregando repositórios..."
                        : repoOptions.length === 0
                          ? "Nenhum repositório disponível"
                          : "Selecione um repositório"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <div className="sticky top-0 z-10 bg-popover p-2">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={repoSearch}
                        onChange={(e) => setRepoSearch(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        placeholder="Buscar repositório..."
                        className="h-8 pl-7"
                      />
                    </div>
                  </div>
                  {reposLoading && (
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando lista...
                    </div>
                  )}
                  {filteredRepoOptions.map((r) => (
                    <SelectItem key={r.fullName} value={r.fullName}>
                      {r.fullName}
                    </SelectItem>
                  ))}
                  {!reposLoading && filteredRepoOptions.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      Nenhum repositório encontrado.
                    </div>
                  )}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={() => void loadRepos(false, true)}
                disabled={reposLoading}
              >
                {reposLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Atualizar lista
              </Button>
              <Button variant="ghost" onClick={handleClearCache} disabled={reposLoading}>
                <Trash2 className="mr-2 h-4 w-4" /> Limpar cache
              </Button>
              <Button
                variant="outline"
                size="icon"
                asChild={Boolean(repoUrl)}
                disabled={!repoUrl}
                title="Abrir no GitHub"
              >
                {repoUrl ? (
                  <a href={repoUrl} target="_blank" rel="noreferrer" aria-label="Abrir no GitHub">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                ) : (
                  <ExternalLink className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {reposLoading
                ? "Buscando repositórios no GitHub..."
                : reposLoaded
                  ? reposComplete
                    ? `${repos.length} repositório(s) — lista completa carregada.`
                    : `${repos.length} repositório(s) carregados — pode haver mais páginas, clique em "Atualizar lista".`
                  : "A lista carrega automaticamente após validar o token."}
              {cacheInfo &&
                (cacheInfo.fromCache
                  ? ` Lista em cache — atualizada ${minutesAgo(cacheInfo.savedAt)}.`
                  : " Lista carregada agora do GitHub.")}
            </p>
            {reposWarnings.length > 0 && (
              <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
                {reposWarnings.map((w) => (
                  <div key={w} className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
            {reposError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{reposError}</span>
              </div>
            )}
            {verifying && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verificando acesso ao repositório...
              </p>
            )}
            {accessError && (
              <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="font-medium">{accessError.message}</span>
                </div>
                {accessError.hints.length > 0 && (
                  <>
                    <p className="font-medium">Verifique nesta ordem:</p>
                    <ul className="list-disc space-y-1 pl-5">
                      {accessError.hints.map((h) => (
                        <li key={h}>{h}</li>
                      ))}
                    </ul>
                  </>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void loadRepos(false, true)}
                    disabled={reposLoading}
                  >
                    <RefreshCw className="mr-2 h-3.5 w-3.5" /> Atualizar lista
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleRetryVerify} disabled={verifying}>
                    {verifying ? (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    )}
                    Tentar novamente
                  </Button>
                </div>
                <p className="text-[11px] opacity-80">
                  Dica: escolha o repositório pela lista suspensa — assim o nome e o id vêm direto da
                  API e não há risco de divergência de digitação.
                </p>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="gh-branch">Branch (opcional)</Label>
            <Input
              id="gh-branch"
              value={branch}
              onChange={(e) => {
                setBranchTouched(true);
                setBranch(e.target.value);
              }}
              placeholder={detectedBranch || "padrão do repositório"}
            />
            {detectedBranch && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                Branch padrão detectada: <code>{detectedBranch}</code>
                {branch !== detectedBranch && (
                  <button
                    type="button"
                    className="text-primary underline-offset-4 hover:underline"
                    onClick={() => {
                      setBranch(detectedBranch);
                      setBranchTouched(false);
                    }}
                  >
                    usar padrão
                  </button>
                )}
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <Label htmlFor="gh-repo-manual">Ou digite o repositório manualmente</Label>
          <Input
            id="gh-repo-manual"
            value={selectedRepo}
            onChange={(e) => {
              setSelectedRepo(e.target.value);
              setSelectedRepoId(null);
              setAccessError(null);
            }}
            onBlur={() => {
              if (/^[^/\s]+\/[^/\s]+$/.test(selectedRepo.trim())) {
                void verifyRepo(selectedRepo.trim(), null);
              }
            }}
            placeholder="HumbyStar/stargames"
          />
        </div>

        <div className="mt-4 flex items-center justify-between rounded-lg border border-border/60 bg-card/50 px-4 py-3">
          <div>
            <p className="text-sm font-medium">Sugerir publicação após cada backup</p>
            <p className="text-xs text-muted-foreground">
              Mantém o repositório como cópia externa dos snapshots concluídos.
            </p>
          </div>
          <Switch checked={autoPushBackup} onCheckedChange={setAutoPushBackup} />
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Salvar configuração
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-base font-semibold">Publicar no repositório</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          O código-fonte do sistema é sincronizado pelo GitHub nativo do Lovable. Aqui você envia o
          conteúdo gerado pela operação.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Button
            variant="outline"
            className="h-auto flex-col items-start gap-1 p-4 text-left"
            onClick={() => void handlePushBackup()}
            disabled={actionsDisabled}
          >
            <span className="flex items-center gap-2 font-medium">
              {busy === "backup" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <HardDrive className="h-4 w-4" />
              )}
              Último backup (.zip)
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              Envia o snapshot mais recente para /backups (até 45 MB).
            </span>
          </Button>
          <Button
            variant="outline"
            className="h-auto flex-col items-start gap-1 p-4 text-left"
            onClick={() => void handlePushExports()}
            disabled={actionsDisabled}
          >
            <span className="flex items-center gap-2 font-medium">
              {busy === "exports" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              Exports CSV
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              Clientes, produtos e acordos MGMV em /exports.
            </span>
          </Button>
          <Button
            variant="outline"
            className="h-auto flex-col items-start gap-1 p-4 text-left"
            onClick={() => void handlePushChangelog()}
            disabled={actionsDisabled}
          >
            <span className="flex items-center gap-2 font-medium">
              {busy === "changelog" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              Changelog
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              Últimas 500 ações auditadas em CHANGELOG.md.
            </span>
          </Button>
        </div>

        {!hasRepo && (
          <p className="mt-3 text-xs text-muted-foreground">
            Informe o repositório (ex.: HumbyStar/stargames) — ele é salvo automaticamente ao
            publicar.
          </p>
        )}

        {lastResults.length > 0 && (
          <div className="mt-4 rounded-lg border border-border/60 bg-card/50 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Publicado agora
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {lastResults.map((r) => (
                <li key={r.label} className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  {r.url ? (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {r.label}
                    </a>
                  ) : (
                    <span>{r.label}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}