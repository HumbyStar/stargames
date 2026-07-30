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
  pushBackupToGithub,
  pushExportsToGithub,
  pushChangelogToGithub,
  type GithubStatus,
} from "@/lib/github.functions";
import { listBackups } from "@/lib/backup.functions";
import { emitAppEvent } from "@/lib/app-events";

type RepoOption = {
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

export function GithubCard() {
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [autoPushBackup, setAutoPushBackup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResults, setLastResults] = useState<{ label: string; url: string | null }[]>([]);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const s = await getGithubStatus();
      setStatus(s);
      setSelectedRepo(
        s.config.repoOwner && s.config.repoName
          ? `${s.config.repoOwner}/${s.config.repoName}`
          : "",
      );
      setBranch(s.config.branch ?? "");
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

  const loadRepos = async () => {
    setReposLoading(true);
    try {
      const list = await listGithubRepos();
      setRepos(list);
      if (list.length === 0) toast.info("Nenhum repositório acessível com esse token.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao listar repositórios");
    } finally {
      setReposLoading(false);
    }
  };

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

  const handleSave = async () => {
    if (!/^[^/\s]+\/[^/\s]+$/.test(selectedRepo.trim())) {
      toast.error("Informe o repositório no formato dono/repositório.");
      return;
    }
    const [owner = "", name = ""] = selectedRepo.split("/");
    setSaving(true);
    try {
      await saveGithubConfig({
        data: { repoOwner: owner, repoName: name, branch: branch.trim(), autoPushBackup },
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
    await saveGithubConfig({
      data: { repoOwner: owner, repoName: name, branch: branch.trim(), autoPushBackup },
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
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-base font-semibold">Repositório de destino</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Repositório</Label>
            <div className="flex gap-2">
              <Select value={selectedRepo} onValueChange={setSelectedRepo}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Selecione um repositório" />
                </SelectTrigger>
                <SelectContent>
                  {repoOptions.map((r) => (
                    <SelectItem key={r.fullName} value={r.fullName}>
                      {r.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={() => void loadRepos()}
                disabled={reposLoading}
              >
                {reposLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="gh-branch">Branch (opcional)</Label>
            <Input
              id="gh-branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="padrão do repositório"
            />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <Label htmlFor="gh-repo-manual">Ou digite o repositório manualmente</Label>
          <Input
            id="gh-repo-manual"
            value={selectedRepo}
            onChange={(e) => setSelectedRepo(e.target.value)}
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