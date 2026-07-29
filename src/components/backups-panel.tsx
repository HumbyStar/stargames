import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CalendarClock,
  AlertTriangle,
  Copy,
  Download,
  HardDrive,
  Loader2,
  Play,
  RefreshCcw,
  TerminalSquare,
  Trash2,
  BarChart3,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui-bits";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createBackupNow,
  deleteBackup,
  getBackupDownloadUrl,
  getBackupSchedule,
  listBackups,
  resumeBackup,
  setBackupSchedule,
  type BackupDebugEntry,
  type BackupErrorDetails,
  type BackupRow,
  type BackupScheduleInfo,
} from "@/lib/backup.functions";
import { formatDateBR } from "@/lib/store";
import { cn } from "@/lib/utils";
import { BackupSummaryModal } from "@/components/backup-summary-modal";
import { RestoreBackupModal } from "@/components/restore-backup-modal";
import type { BusinessSummary } from "@/lib/backup.functions";
import { useUiStore } from "@/lib/ui-store";

function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "—";
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function statusBadge(status: BackupRow["status"]) {
  const map: Record<BackupRow["status"], string> = {
    completed: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    running: "bg-sky-500/15 text-sky-600 border-sky-500/30",
    pending: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    failed: "bg-destructive/15 text-destructive border-destructive/30",
  };
  const label: Record<BackupRow["status"], string> = {
    completed: "Concluído",
    running: "Executando",
    pending: "Aguardando",
    failed: "Falhou",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        map[status],
      )}
    >
      {label[status]}
    </span>
  );
}

function formatElapsed(ms: number | null | undefined): string {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function diagnosticsText(row: BackupRow | null): string {
  if (!row) return "";
  const details = row.errorDetails;
  const lines = [
    `Backup: ${row.id}`,
    `Status: ${row.status}`,
    `Criado em: ${new Date(row.createdAt).toLocaleString("pt-BR")}`,
    `Finalizado em: ${row.finishedAt ? new Date(row.finishedAt).toLocaleString("pt-BR") : "—"}`,
    `Fase do erro: ${details?.phase ?? "—"}`,
    `Tempo até falhar: ${formatElapsed(details?.elapsedMs ?? row.durationMs)}`,
    `Mensagem: ${details?.message ?? row.error ?? "—"}`,
    details?.name ? `Tipo: ${details.name}` : null,
    details?.stack ? `Stack:\n${details.stack}` : null,
    "",
    "Logs do backend:",
    ...(row.debugLog.length > 0
      ? row.debugLog.map(
          (log) =>
            `[${new Date(log.at).toLocaleString("pt-BR")}] ${log.level.toUpperCase()} ${log.phase} (${formatElapsed(log.elapsedMs)}): ${log.message}${log.meta ? ` ${JSON.stringify(log.meta)}` : ""}`,
        )
      : ["Sem logs persistidos para este backup."]
    ),
  ].filter(Boolean);
  return lines.join("\n");
}

function BackupFailureModal({
  row,
  open,
  onClose,
}: {
  row: BackupRow | null;
  open: boolean;
  onClose: () => void;
}) {
  const details: BackupErrorDetails | null = row?.errorDetails ?? null;
  const logs: BackupDebugEntry[] = row?.debugLog ?? [];
  const copyDiagnostics = async () => {
    if (!row) return;
    try {
      await navigator.clipboard.writeText(diagnosticsText(row));
      toast.success("Diagnóstico copiado.");
    } catch {
      toast.error("Não foi possível copiar o diagnóstico.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" /> Backup falhou
          </DialogTitle>
          <DialogDescription>
            Mensagem detalhada e logs persistidos do backend para diagnóstico.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-destructive">
              Motivo principal
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-destructive">
              {details?.message ?? row?.error ?? "Falha desconhecida."}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-card/50 p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Fase</div>
              <div className="mt-1 text-sm font-semibold">{details?.phase ?? "—"}</div>
            </div>
            <div className="rounded-lg border border-border bg-card/50 p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Tempo até falhar</div>
              <div className="mt-1 text-sm font-semibold tabular-nums">
                {formatElapsed(details?.elapsedMs ?? row?.durationMs)}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card/50 p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Tipo</div>
              <div className="mt-1 text-sm font-semibold">{details?.name ?? "Erro"}</div>
            </div>
          </div>

          {details?.stack ? (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <TerminalSquare className="size-3.5" /> Stack do backend
              </div>
              <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground">
                {details.stack}
              </pre>
            </div>
          ) : null}

          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <TerminalSquare className="size-3.5" /> Logs do backend
              </div>
              <Button size="sm" variant="outline" onClick={() => void copyDiagnostics()}>
                <Copy className="mr-2 size-3.5" /> Copiar diagnóstico
              </Button>
            </div>
            {logs.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                Este registro ainda não possui logs persistidos.
              </div>
            ) : (
              <div className="max-h-72 overflow-auto rounded-md border border-border/60 bg-background/70">
                {logs.map((log, idx) => (
                  <div key={`${log.at}-${idx}`} className="border-b border-border/40 p-2 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <span>{new Date(log.at).toLocaleString("pt-BR")}</span>
                      <span className={cn(
                        "rounded px-1.5 py-0.5 font-semibold",
                        log.level === "error"
                          ? "bg-destructive/15 text-destructive"
                          : log.level === "warn"
                            ? "bg-amber-500/15 text-amber-600"
                            : "bg-sky-500/15 text-sky-600",
                      )}>
                        {log.level}
                      </span>
                      <span>{log.phase}</span>
                      <span>{formatElapsed(log.elapsedMs)}</span>
                    </div>
                    <div className="mt-1 whitespace-pre-wrap break-words text-xs">{log.message}</div>
                    {log.meta ? (
                      <pre className="mt-1 whitespace-pre-wrap break-words text-[10px] text-muted-foreground">
                        {JSON.stringify(log.meta, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function BackupsPanel() {
  const list = useServerFn(listBackups);
  const create = useServerFn(createBackupNow);
  const resume = useServerFn(resumeBackup);
  const del = useServerFn(deleteBackup);
  const getUrl = useServerFn(getBackupDownloadUrl);
  const getSchedule = useServerFn(getBackupSchedule);
  const putSchedule = useServerFn(setBackupSchedule);

  const [rows, setRows] = useState<BackupRow[]>([]);
  const [schedule, setSchedule] = useState<BackupScheduleInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [activeBackupId, setActiveBackupId] = useState<string | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryData, setSummaryData] = useState<{
    filename?: string;
    summary: BusinessSummary | null;
  } | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [failureOpen, setFailureOpen] = useState(false);
  const [failureRow, setFailureRow] = useState<BackupRow | null>(null);
  const setSettingsLocked = useUiStore((s) => s.setSettingsLocked);

  useEffect(() => {
    setSettingsLocked(running);
    return () => setSettingsLocked(false);
  }, [running, setSettingsLocked]);

  useEffect(() => {
    if (!running || !runningSince) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - runningSince) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running, runningSince]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [rowsRes, schedRes] = await Promise.all([list(), getSchedule()]);
      setRows(rowsRes);
      setSchedule(schedRes);
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao carregar backups.");
    } finally {
      setLoading(false);
    }
  }, [list, getSchedule]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while a backup is running to detect completion / failure.
  useEffect(() => {
    if (!running || !activeBackupId) return;
    const started = Date.now();
    const MAX_MS = 20 * 60 * 1000;
    const STALL_MS = 30 * 1000;
    let lastProgressAt = Date.now();
    let lastLogSignature = "";
    let resumeAttempts = 0;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      try {
        const rowsRes = await list();
        setRows(rowsRes);
        const row = rowsRes.find((r) => r.id === activeBackupId);
        if (row?.status === "completed") {
          toast.success(`Backup gerado (${formatBytes(row.sizeBytes)}).`, { id: "backup-run" });
          setSummaryData({
            filename: row.storagePath?.split("/").pop(),
            summary: row.businessSummary ?? null,
          });
          setSummaryOpen(true);
          setRunning(false);
          setRunningSince(null);
          setActiveBackupId(null);
          return;
        }
        if (row?.status === "failed") {
          toast.error(row.error ?? "Falha ao gerar backup.", { id: "backup-run" });
          setFailureRow(row);
          setFailureOpen(true);
          setRunning(false);
          setRunningSince(null);
          setActiveBackupId(null);
          return;
        }
        if (row) {
          const sig = `${row.debugLog.length}:${row.debugLog.at(-1)?.at ?? ""}`;
          if (sig !== lastLogSignature) {
            lastLogSignature = sig;
            lastProgressAt = Date.now();
          } else if (
            resumeAttempts < 3 &&
            Date.now() - lastProgressAt > STALL_MS
          ) {
            resumeAttempts += 1;
            lastProgressAt = Date.now();
            toast.loading(
              `Retomando backup (tentativa ${resumeAttempts})…`,
              { id: "backup-run" },
            );
            try {
              await resume({ data: { id: activeBackupId } });
            } catch (err) {
              console.warn("[backup] resume failed:", err);
            }
          }
        }
        if (Date.now() - started > MAX_MS) {
          toast.error("Tempo esgotado (20 min). Verifique o histórico.", { id: "backup-run" });
          setRunning(false);
          setRunningSince(null);
          setActiveBackupId(null);
          return;
        }
      } catch {
        // ignore transient errors while polling
      }
    };
    const iv = setInterval(() => void poll(), 3000);
    return () => {
      stopped = true;
      clearInterval(iv);
    };
  }, [running, activeBackupId, list, resume]);

  const totalSize = useMemo(
    () => rows.reduce((s, r) => s + (r.sizeBytes ?? 0), 0),
    [rows],
  );

  const handleGenerate = async () => {
    if (running) return;
    setRunning(true);
    setRunningSince(Date.now());
    setElapsed(0);
    toast.loading("Gerando backup completo…", { id: "backup-run" });
    try {
      const res = await create();
      setActiveBackupId(res.id ?? null);
      await refresh();
      if (!res.id) {
        // No id returned — treat as complete.
        toast.success(`Backup gerado (${formatBytes(res.sizeBytes)}).`, { id: "backup-run" });
        setRunning(false);
        setRunningSince(null);
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao gerar backup.", { id: "backup-run" });
      const now = new Date().toISOString();
      setFailureRow({
        id: "erro-imediato",
        createdAt: now,
        finishedAt: now,
        createdBy: null,
        type: "manual",
        status: "failed",
        storagePath: null,
        sizeBytes: null,
        durationMs: null,
        rowCounts: {},
        storageObjectCount: 0,
        error: err?.message ?? "Falha ao gerar backup.",
        errorDetails: {
          message: err?.message ?? "Falha ao gerar backup.",
          name: err?.name,
          phase: "createBackupNow",
        },
        debugLog: [
          {
            at: now,
            level: "error",
            phase: "createBackupNow",
            message: err?.message ?? "Falha ao gerar backup.",
          },
        ],
        businessSummary: null,
      });
      setFailureOpen(true);
      setRunning(false);
      setRunningSince(null);
      setActiveBackupId(null);
    }
  };

  const handleDownload = async (id: string) => {
    try {
      const res = await getUrl({ data: { id } });
      window.open(res.url, "_blank", "noopener");
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao gerar link de download.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Excluir este backup? A ação é irreversível.")) return;
    try {
      await del({ data: { id } });
      toast.success("Backup excluído.");
      await refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao excluir.");
    }
  };

  const handleScheduleChange = async (freq: "off" | "daily" | "weekly") => {
    setSavingSchedule(true);
    try {
      await putSchedule({ data: { frequency: freq } });
      toast.success(
        freq === "off"
          ? "Agendamento automático desativado."
          : freq === "daily"
            ? "Backup diário agendado (03:00 UTC)."
            : "Backup semanal agendado (domingos 03:00 UTC).",
      );
      const s = await getSchedule();
      setSchedule(s);
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao alterar agenda.");
    } finally {
      setSavingSchedule(false);
    }
  };

  return (
    <div className="space-y-4">
      {running && (
        <div className="sticky top-0 z-30 flex items-center gap-3 rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-3 shadow-sm animate-pulse">
          <Loader2 className="size-4 animate-spin text-sky-600" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-sky-700">
              Backup em execução…
            </div>
            <div className="text-[11px] text-sky-700/80">
              Não feche esta janela. Tempo decorrido: {elapsed}s
            </div>
          </div>
        </div>
      )}
      <Card title="Backup completo">
        <p className="mb-3 text-xs text-muted-foreground">
          Gera um único arquivo .zip com todas as tabelas do sistema, arquivos originais de
          importação e instruções de restauração. Ideal para portabilidade e migração.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-card/50 p-3">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              <HardDrive className="size-3.5" /> Backups guardados
            </div>
            <div className="text-2xl font-semibold tabular-nums">{rows.length}</div>
            <div className="text-xs text-muted-foreground">
              Retenção automática: últimos 14
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card/50 p-3">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              <Download className="size-3.5" /> Espaço utilizado
            </div>
            <div className="text-2xl font-semibold tabular-nums">{formatBytes(totalSize)}</div>
            <div className="text-xs text-muted-foreground">Bucket privado system-backups</div>
          </div>
          <div className="rounded-lg border border-border bg-card/50 p-3">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              <CalendarClock className="size-3.5" /> Agenda
            </div>
            <div className="text-2xl font-semibold">
              {schedule?.frequency === "daily"
                ? "Diário"
                : schedule?.frequency === "weekly"
                  ? "Semanal"
                  : "Desligado"}
            </div>
            <div className="text-xs text-muted-foreground">
              {schedule?.frequency && schedule.frequency !== "off"
                ? "Executa às 03:00 UTC"
                : "Ative para rodar automaticamente"}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={handleGenerate} disabled={running}>
            {running ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Play className="mr-2 size-4" />
            )}
            Gerar backup agora
          </Button>
          <Button variant="outline" onClick={() => void refresh()} disabled={loading || running}>
            <RefreshCcw className={cn("mr-2 size-4", loading && "animate-spin")} />
            Atualizar
          </Button>
          <Button variant="outline" onClick={() => setRestoreOpen(true)} disabled={running}>
            <Undo2 className="mr-2 size-4" />
            Restaurar backup
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Agendamento:</span>
            <Select
              value={schedule?.frequency ?? "off"}
              onValueChange={(v) => handleScheduleChange(v as "off" | "daily" | "weekly")}
              disabled={savingSchedule || running}
            >
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Desligado</SelectItem>
                <SelectItem value="daily">Diário (03:00 UTC)</SelectItem>
                <SelectItem value="weekly">Semanal (dom, 03:00 UTC)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card title="Histórico de backups">
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            Nenhum backup gerado ainda. Clique em <b>Gerar backup agora</b> para criar o primeiro.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2">Data</th>
                  <th className="px-2 py-2">Tipo</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2 text-right">Tamanho</th>
                  <th className="px-2 py-2 text-right">Duração</th>
                  <th className="px-2 py-2 text-right">Conteúdo</th>
                  <th className="px-2 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const rowsTotal = Object.values(r.rowCounts).reduce(
                    (s, v) => s + Number(v || 0),
                    0,
                  );
                  return (
                    <tr key={r.id} className="border-b border-border/40 last:border-b-0">
                      <td className="px-2 py-2">
                        <div className="font-medium">{formatDateBR(r.createdAt)}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {new Date(r.createdAt).toLocaleTimeString("pt-BR")}
                        </div>
                      </td>
                      <td className="px-2 py-2 capitalize">
                        {r.type === "manual" ? "Manual" : "Agendado"}
                      </td>
                      <td className="px-2 py-2">
                        {statusBadge(r.status)}
                        {r.error ? (
                          <div
                            className="mt-1 max-w-[280px] truncate text-[10px] text-destructive"
                            title={r.error}
                          >
                            {r.error}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {formatBytes(r.sizeBytes)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                        {r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                        {rowsTotal.toLocaleString("pt-BR")} linhas
                        {r.storageObjectCount > 0
                          ? ` · ${r.storageObjectCount} arquivos`
                          : ""}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            title="Ver resumo"
                            disabled={r.status !== "completed" || running}
                            onClick={() => {
                              setSummaryData({
                                filename: r.storagePath?.split("/").pop(),
                                summary: r.businessSummary ?? null,
                              });
                              setSummaryOpen(true);
                            }}
                          >
                            <BarChart3 className="size-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            title="Ver erro e logs"
                            disabled={r.status !== "failed" || running}
                            onClick={() => {
                              setFailureRow(r);
                              setFailureOpen(true);
                            }}
                          >
                            <TerminalSquare className="size-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={r.status !== "completed" || running}
                            onClick={() => void handleDownload(r.id)}
                          >
                            <Download className="size-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={running}
                            onClick={() => void handleDelete(r.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <BackupSummaryModal
        open={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        backupSummary={summaryData?.summary ?? null}
        filename={summaryData?.filename}
      />
      <RestoreBackupModal open={restoreOpen} onClose={() => setRestoreOpen(false)} />
      <BackupFailureModal
        open={failureOpen}
        row={failureRow}
        onClose={() => setFailureOpen(false)}
      />
    </div>
  );
}