import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  MonitorDown,
  Download,
  Loader2,
  RefreshCw,
  Trash2,
  WifiOff,
  HardDrive,
  FileArchive,
  CheckCircle2,
} from "lucide-react";
import { Card } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createBackupNow,
  executeBackupNow,
  getBackupDownloadUrl,
  listBackups,
} from "@/lib/backup.functions";
import {
  exportLocalBackupZip,
  installLocalPackageFromZip,
  type LocalInstallProgress,
} from "@/lib/local-package";
import { clearLocalPackage, getLocalMeta, type LocalPackageMeta } from "@/lib/local-db";
import {
  getLocalModePreference,
  isLocalMode,
  setLocalModePreference,
  setLocalPackageInstalled,
  subscribeLocalMode,
  type LocalModePreference,
} from "@/lib/local-mode";
import { flushLocalPersistence } from "@/lib/local-persistence";
import {
  canPromptInstall,
  isStandaloneInstall,
  promptInstall,
  subscribeInstallPrompt,
} from "@/lib/pwa";
import { useStore } from "@/lib/store";

/** Backup considerado "fresco" o suficiente para virar pacote local. */
const FRESH_MS = 6 * 60 * 60 * 1000;

function fmtDate(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleString("pt-BR") : "—";
}

export function LocalInstallCard() {
  const [meta, setMeta] = useState<LocalPackageMeta | null>(null);
  const [pref, setPref] = useState<LocalModePreference>("auto");
  const [localActive, setLocalActive] = useState(false);
  const [installable, setInstallable] = useState(false);
  const [busy, setBusy] = useState<null | "package" | "export" | "clear">(null);
  const [step, setStep] = useState("");
  const [progress, setProgress] = useState(0);

  const clients = useStore((s) => s.clients);
  const products = useStore((s) => s.products);
  const importHistory = useStore((s) => s.importHistory);
  const preferences = useStore((s) => s.preferences);
  const rules = useStore((s) => s.rules);
  const security = useStore((s) => s.security);

  const list = useServerFn(listBackups);
  const create = useServerFn(createBackupNow);
  const execute = useServerFn(executeBackupNow);
  const downloadUrl = useServerFn(getBackupDownloadUrl);

  const refreshMeta = useCallback(async () => {
    const m = await getLocalMeta().catch(() => null);
    setMeta(m);
    setLocalPackageInstalled(Boolean(m));
  }, []);

  useEffect(() => {
    void refreshMeta();
    setPref(getLocalModePreference());
    setLocalActive(isLocalMode());
    setInstallable(canPromptInstall());
    const offMode = subscribeLocalMode(() => setLocalActive(isLocalMode()));
    const offPrompt = subscribeInstallPrompt(() => setInstallable(canPromptInstall()));
    return () => {
      offMode();
      offPrompt();
    };
  }, [refreshMeta]);

  const totalRows = useMemo(
    () => Object.values(meta?.rowCounts ?? {}).reduce((s, n) => s + n, 0),
    [meta],
  );

  const runPackage = async () => {
    setBusy("package");
    setProgress(2);
    try {
      setStep("Procurando o backup mais recente…");
      const backups = await list();
      const completed = backups
        .filter((b) => b.status === "completed" && b.storagePath)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      let target = completed[0] ?? null;
      const fresh =
        target && Date.now() - new Date(target.finishedAt ?? target.createdAt).getTime() < FRESH_MS;

      if (!fresh) {
        setStep("Gerando um backup atualizado do sistema…");
        setProgress(10);
        const created = await create();
        if (created.shouldExecute) {
          await execute({ data: { id: created.id } });
        }
        // Aguarda o backup concluir (o servidor grava o status na tabela).
        for (let i = 0; i < 120; i += 1) {
          const rows = await list();
          const row = rows.find((b) => b.id === created.id);
          if (row?.status === "completed") {
            target = row;
            break;
          }
          if (row?.status === "failed") throw new Error(row.error ?? "Backup falhou.");
          setProgress(10 + Math.min(25, i));
          await new Promise((r) => setTimeout(r, 3000));
        }
        if (!target || target.status !== "completed") {
          throw new Error("O backup ainda está em andamento. Tente novamente em instantes.");
        }
      }

      setStep("Baixando o pacote de dados…");
      setProgress(45);
      const { url } = await downloadUrl({ data: { id: target!.id } });
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Falha no download (${res.status}).`);
      const blob = await res.blob();

      setStep("Instalando os dados neste computador…");
      setProgress(60);
      const installed = await installLocalPackageFromZip(blob, {
        backupId: target!.id,
        onProgress: (p: LocalInstallProgress) => {
          setProgress(60 + Math.round(p.percent * 0.38));
          if (p.table) setStep(`Gravando ${p.table}…`);
        },
      });
      setMeta(installed);
      setLocalPackageInstalled(true);
      setProgress(100);
      setStep("Pacote local atualizado.");
      toast.success("Sistema instalado localmente com os dados atualizados.");
    } catch (error) {
      toast.error("Não foi possível preparar a instalação local.", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const runExport = async () => {
    setBusy("export");
    try {
      if (isLocalMode()) await flushLocalPersistence();
      const result = await exportLocalBackupZip({
        clients,
        products,
        importHistory,
        preferences,
        rules,
        security,
        uiState: {},
      });
      const blob = new Blob([result.bytes as unknown as BlobPart], { type: "application/zip" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(href);
      toast.success("ZIP gerado. Importe primeiro no Modo Teste para conferir.");
    } catch (error) {
      toast.error("Falha ao exportar as alterações locais.", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const runClear = async () => {
    setBusy("clear");
    try {
      await clearLocalPackage();
      setLocalPackageInstalled(false);
      setMeta(null);
      toast.success("Dados locais removidos deste computador.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <div className="space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <MonitorDown className="size-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Instalar sistema (Windows)</h3>
              <p className="max-w-prose text-xs text-muted-foreground">
                Instala o sistema neste computador e guarda uma cópia completa dos dados. Se a
                internet ou o banco na nuvem cair, o sistema continua abrindo com os últimos dados
                baixados — e o que você editar offline volta como um ZIP para conferir no Modo Teste.
              </p>
            </div>
          </div>
          <Badge variant={localActive ? "default" : meta ? "secondary" : "outline"}>
            {localActive ? "Modo Local ativo" : meta ? "Pacote instalado" : "Não instalado"}
          </Badge>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Dados baixados em" value={fmtDate(meta?.installedAt)} />
          <Stat label="Registros no PC" value={totalRows.toLocaleString("pt-BR")} />
          <Stat
            label="Alterações offline"
            value={meta?.changeCount ? `${meta.changeCount} (${fmtDate(meta.changedAt)})` : "Nenhuma"}
          />
        </div>

        {busy === "package" && (
          <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {step}
            </div>
            <Progress value={progress} />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void runPackage()} disabled={busy !== null}>
            {busy === "package" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : meta ? (
              <RefreshCw className="size-4" />
            ) : (
              <Download className="size-4" />
            )}
            {meta ? "Atualizar dados locais" : "Baixar dados e instalar"}
          </Button>

          {isStandaloneInstall() ? (
            <Button variant="outline" disabled className="gap-2">
              <CheckCircle2 className="size-4" /> App instalado
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={!installable}
              onClick={() => {
                void promptInstall().then((r) => {
                  if (r === "unavailable") {
                    toast.info(
                      "Use o menu do navegador (⋮) → “Instalar Star Games” para criar o atalho no Windows.",
                    );
                  }
                });
              }}
            >
              <HardDrive className="size-4" />
              Instalar atalho no Windows
            </Button>
          )}

          <Button variant="outline" onClick={() => void runExport()} disabled={busy !== null}>
            {busy === "export" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileArchive className="size-4" />
            )}
            Exportar alterações (.zip)
          </Button>

          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => void runClear()}
            disabled={busy !== null || !meta}
          >
            <Trash2 className="size-4" /> Remover dados locais
          </Button>
        </div>

        <div className="space-y-1.5 rounded-xl border border-border bg-muted/30 p-3">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Quando usar o banco local
          </Label>
          <Select
            value={pref}
            onValueChange={(v) => {
              const next = v as LocalModePreference;
              setPref(next);
              setLocalModePreference(next);
              setLocalActive(isLocalMode());
            }}
          >
            <SelectTrigger className="w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automático — só quando ficar sem conexão</SelectItem>
              <SelectItem value="always">Sempre local (trabalhar offline agora)</SelectItem>
              <SelectItem value="off">Nunca (usar sempre a nuvem)</SelectItem>
            </SelectContent>
          </Select>
          <p className="flex items-start gap-2 pt-1 text-[11px] text-muted-foreground">
            <WifiOff className="mt-0.5 size-3.5 shrink-0" />
            No Modo Local nada é enviado para a nuvem. Para publicar o que foi feito offline, exporte
            o ZIP, importe no Modo Teste e só depois em produção.
          </p>
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-semibold">{value}</p>
    </div>
  );
}