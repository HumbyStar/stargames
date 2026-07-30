import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Loader2,
  Upload,
  Database,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  FlaskConical,
  Download,
  Info,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listBackups,
  previewBackupRestore,
  restoreBackup,
  validateBackupRestore,
  createBackupUploadUrl,
  discardUploadedBackup,
  type BackupRow,
  type RestorePreview,
  type RestoreResult,
  type ValidationReport,
} from "@/lib/backup.functions";
import { supabase } from "@/integrations/supabase/client";
import { formatDateBR } from "@/lib/store";
import { cn } from "@/lib/utils";

type Step = "source" | "preview" | "validation" | "done";

const MAX_UPLOAD_MB = 500;

/** Tabelas mínimas que um backup Star Games precisa conter. */
const REQUIRED_TABLES = ["clients", "products"];

interface ZipPrecheck {
  fileName: string;
  sizeMB: number;
  schemaVersion: number | null;
  generatedAt: string | null;
  tables: Array<{ table: string; rows: number }>;
  errors: string[];
  warnings: string[];
}

interface ErrorInfo {
  stage: string;
  message: string;
  hint?: string;
  file?: string;
}

function fmt(n: number): string {
  return (n ?? 0).toLocaleString("pt-BR");
}

/**
 * Lê o ZIP no próprio navegador ANTES de enviar: confere manifesto, versão de
 * schema e a presença dos arquivos de dados. Evita subir centenas de MB de um
 * arquivo que o servidor recusaria depois.
 */
async function precheckZip(file: File): Promise<ZipPrecheck> {
  const out: ZipPrecheck = {
    fileName: file.name,
    sizeMB: file.size / 1024 / 1024,
    schemaVersion: null,
    generatedAt: null,
    tables: [],
    errors: [],
    warnings: [],
  };
  if (!/\.zip$/i.test(file.name)) {
    out.errors.push("O arquivo precisa ter extensão .zip.");
    return out;
  }
  let zip: any;
  try {
    const JSZip = (await import("jszip")).default;
    zip = await JSZip.loadAsync(file);
  } catch {
    out.errors.push("Não foi possível abrir o ZIP — arquivo corrompido ou incompleto.");
    return out;
  }
  const mf = zip.file("manifest.json");
  if (!mf) {
    out.errors.push(
      "manifest.json ausente na raiz do ZIP — este arquivo não é um backup Star Games.",
    );
    return out;
  }
  let manifest: any;
  try {
    manifest = JSON.parse(await mf.async("string"));
  } catch {
    out.errors.push("manifest.json ilegível (JSON inválido).");
    return out;
  }
  out.schemaVersion = Number(manifest.schemaVersion ?? 1);
  out.generatedAt = manifest.generatedAt ?? null;
  if (!Number.isFinite(out.schemaVersion) || out.schemaVersion < 1) {
    out.errors.push(`Versão de schema inválida no manifesto: ${manifest.schemaVersion}`);
  }

  const dataFiles = Object.keys(zip.files).filter(
    (n) => n.startsWith("database/data/") && n.endsWith(".jsonl"),
  );
  if (dataFiles.length === 0) {
    out.errors.push("Pasta database/data ausente — o backup não contém dados de tabelas.");
    return out;
  }
  const counts: Record<string, number> = manifest.rowCounts ?? {};
  out.tables = dataFiles
    .map((n) => {
      const table = n.replace("database/data/", "").replace(/\.jsonl$/, "");
      return { table, rows: Number(counts[table] ?? 0) };
    })
    .sort((a, b) => b.rows - a.rows);

  const present = new Set(out.tables.map((t) => t.table));
  const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
  if (missing.length > 0) {
    out.errors.push(`Tabelas obrigatórias ausentes no backup: ${missing.join(", ")}.`);
  }
  for (const t of out.tables) {
    const declared = Number(counts[t.table] ?? 0);
    const entry = zip.file(`database/data/${t.table}.jsonl`);
    if (declared > 0 && entry && (entry as any)._data?.uncompressedSize === 0) {
      out.warnings.push(
        `${t.table}: o manifesto declara ${fmt(declared)} registro(s), mas o arquivo está vazio.`,
      );
    }
  }
  if (out.tables.every((t) => t.rows === 0)) {
    out.warnings.push("O manifesto não informa contagens — os totais só aparecerão na análise.");
  }
  return out;
}

export function RestoreBackupModal({
  open,
  onClose,
  initialSource = "existing",
}: {
  open: boolean;
  onClose: () => void;
  initialSource?: "existing" | "upload";
}) {
  const list = useServerFn(listBackups);
  const preview = useServerFn(previewBackupRestore);
  const restore = useServerFn(restoreBackup);
  const validate = useServerFn(validateBackupRestore);
  const makeUploadUrl = useServerFn(createBackupUploadUrl);
  const discardUpload = useServerFn(discardUploadedBackup);

  const [step, setStep] = useState<Step>("source");
  const [source, setSource] = useState<"existing" | "upload">(initialSource);
  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [backupId, setBackupId] = useState<string>("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string>("");
  const [uploadPct, setUploadPct] = useState(0);
  const [previewData, setPreviewData] = useState<RestorePreview | null>(null);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [includeStorage, setIncludeStorage] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [precheck, setPrecheck] = useState<ZipPrecheck | null>(null);
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("source");
    setSource(initialSource);
    setBackupId("");
    setUploadFile(null);
    setUploadedPath("");
    setUploadPct(0);
    setPreviewData(null);
    setSelectedTables(new Set());
    setMode("merge");
    setIncludeStorage(false);
    setConfirmText("");
    setResult(null);
    setReport(null);
    setPrecheck(null);
    setErrorInfo(null);
    void list().then((rows) => {
      const completed = rows.filter((r) => r.status === "completed");
      setBackups(completed);
      if (completed[0]) setBackupId(completed[0].id);
    });
  }, [open, initialSource, list]);

  const canPreview = useMemo(() => {
    if (source === "existing") return Boolean(backupId);
    return Boolean(uploadedPath);
  }, [source, backupId, uploadedPath]);

  const handleFile = async (file: File | null) => {
    setUploadFile(file);
    setUploadPct(0);
    setPrecheck(null);
    setErrorInfo(null);
    if (!file) {
      setUploadedPath("");
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setUploadFile(null);
      setUploadedPath("");
      setErrorInfo({
        stage: "Seleção do arquivo",
        message: `Arquivo maior que ${MAX_UPLOAD_MB} MB.`,
        hint: "Gere um backup mais recente ou restaure a partir de um backup salvo no sistema.",
        file: file.name,
      });
      return;
    }
    setLoading(true);
    toast.loading("Verificando o arquivo…", { id: "upload-zip" });
    try {
      // 1) Pré-validação local: estrutura e compatibilidade antes de subir.
      const check = await precheckZip(file);
      setPrecheck(check);
      if (check.errors.length > 0) {
        setUploadedPath("");
        setErrorInfo({
          stage: "Pré-validação do ZIP",
          message: check.errors.join(" "),
          hint: "O ZIP precisa conter manifest.json na raiz e a pasta database/data com os arquivos .jsonl gerados pelo próprio sistema.",
          file: file.name,
        });
        toast.error("Arquivo reprovado na pré-validação.", { id: "upload-zip" });
        return;
      }
      toast.loading("Enviando arquivo…", { id: "upload-zip" });
      // Envio direto ao armazenamento: o ZIP não passa pela requisição do app,
      // por isso backups grandes (dezenas/centenas de MB) não estouram memória.
      const { path, token, bucket } = await makeUploadUrl({
        data: { fileName: file.name, size: file.size },
      });
      setUploadPct(10);
      const { error } = await supabase.storage
        .from(bucket)
        .uploadToSignedUrl(path, token, file, { contentType: "application/zip" });
      if (error) throw new Error(error.message);
      setUploadPct(100);
      setUploadedPath(path);
      toast.success("Arquivo enviado.", { id: "upload-zip" });
    } catch (err: any) {
      setUploadedPath("");
      setUploadPct(0);
      setErrorInfo({
        stage: "Envio do arquivo",
        message: err?.message ?? "Falha ao enviar o arquivo.",
        hint: "Verifique sua conexão e tente enviar novamente. Arquivos muito grandes podem levar alguns minutos.",
        file: file.name,
      });
      toast.error(err?.message ?? "Falha ao enviar o arquivo.", { id: "upload-zip" });
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = async () => {
    setLoading(true);
    setErrorInfo(null);
    toast.loading("Analisando backup…", { id: "preview-zip" });
    try {
      const res = await preview({
        data:
          source === "existing"
            ? { backupId }
            : { uploadedPath },
      });
      setPreviewData(res);
      setSelectedTables(new Set(res.availableTables));
      setStep("preview");
      toast.dismiss("preview-zip");
    } catch (err: any) {
      setErrorInfo({
        stage: "Análise do backup",
        message: err?.message ?? "Falha ao ler backup.",
        hint: "Erros de manifesto ou de versão de schema indicam um ZIP gerado por outra versão do sistema.",
        file: uploadFile?.name,
      });
      toast.error(err?.message ?? "Falha ao ler backup.", { id: "preview-zip" });
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    const sandboxTarget = previewData?.targetEnv === "sandbox";
    if (!sandboxTarget && mode === "replace" && confirmText !== "REPLACE") {
      toast.error('Digite "REPLACE" para confirmar a substituição.');
      return;
    }
    setLoading(true);
    setErrorInfo(null);
    toast.loading(
      sandboxTarget ? "Zerando ambiente de teste e restaurando…" : "Restaurando backup…",
      { id: "restore" },
    );
    try {
      const res = await restore({
        data: {
          ...(source === "existing"
            ? { backupId }
            : { uploadedPath }),
          mode: sandboxTarget ? "replace" : mode,
          tables: Array.from(selectedTables),
          includeStorage,
          confirmReplace: !sandboxTarget && mode === "replace" ? confirmText : undefined,
        },
      });
      setResult(res);
      setStep("done");
      if (res.errors && res.errors.length > 0) {
        setErrorInfo({
          stage: `Gravação (${res.errors[0].table})`,
          message: res.errors[0].message,
          hint: "Normalmente indica incompatibilidade de schema entre o backup e o banco atual (coluna ou tipo diferente).",
          file: res.filename,
        });
        toast.error("Restauração concluída com erros em algumas tabelas.", { id: "restore" });
      } else {
        toast.success("Restauração concluída.", { id: "restore" });
      }
      // Remove o ZIP temporário enviado.
      if (uploadedPath) {
        void discardUpload({ data: { path: uploadedPath } }).catch(() => {});
        setUploadedPath("");
      }
      // Dispara reset em cache/realtime.
      window.dispatchEvent(new CustomEvent("app:reset"));
    } catch (err: any) {
      setErrorInfo({
        stage: "Restauração",
        message: err?.message ?? "Falha ao restaurar.",
        hint: "Nenhuma alteração parcial fica no ambiente de teste: refaça a operação após corrigir a causa acima.",
        file: uploadFile?.name,
      });
      toast.error(err?.message ?? "Falha ao restaurar.", { id: "restore" });
    } finally {
      setLoading(false);
    }
  };

  const handleValidate = async () => {
    setLoading(true);
    setErrorInfo(null);
    toast.loading("Validando no Modo Teste…", { id: "validate" });
    try {
      const res = await validate({
        data: {
          ...(source === "existing"
            ? { backupId }
            : { uploadedPath }),
          mode,
          tables: Array.from(selectedTables),
        },
      });
      setReport(res);
      setStep("validation");
      toast.success("Validação concluída — nada foi gravado.", { id: "validate" });
    } catch (err: any) {
      setErrorInfo({
        stage: "Validação (sem gravar)",
        message: err?.message ?? "Falha ao validar.",
        file: uploadFile?.name,
      });
      toast.error(err?.message ?? "Falha ao validar.", { id: "validate" });
    } finally {
      setLoading(false);
    }
  };

  const downloadReport = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `validacao-${report.filename.replace(/\.zip$/i, "")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleTable = (t: string) => {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar via backup</DialogTitle>
          <DialogDescription>
            Restaura dados a partir de um backup Star Games (.zip).
          </DialogDescription>
        </DialogHeader>

        {step === "source" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSource("existing")}
                className={cn(
                  "flex items-center gap-2 rounded-md border p-3 text-left text-sm transition",
                  source === "existing"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40",
                )}
              >
                <Database className="size-4" />
                <div>
                  <div className="font-medium">Backup do sistema</div>
                  <div className="text-[11px] text-muted-foreground">
                    Escolher entre os backups salvos
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setSource("upload")}
                className={cn(
                  "flex items-center gap-2 rounded-md border p-3 text-left text-sm transition",
                  source === "upload"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40",
                )}
              >
                <Upload className="size-4" />
                <div>
                  <div className="font-medium">Upload de ZIP</div>
                  <div className="text-[11px] text-muted-foreground">
                    Enviar um arquivo .zip externo
                  </div>
                </div>
              </button>
            </div>

            {source === "existing" ? (
              <div className="space-y-2">
                <Label>Backup salvo</Label>
                {backups.length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                    Nenhum backup concluído disponível. Gere um backup primeiro.
                  </div>
                ) : (
                  <Select value={backupId} onValueChange={setBackupId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {backups.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {formatDateBR(b.createdAt)} — {b.type === "manual" ? "Manual" : "Agendado"}
                          {b.sizeBytes ? ` · ${(b.sizeBytes / 1024 / 1024).toFixed(1)} MB` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Arquivo .zip</Label>
                <Input
                  type="file"
                  accept=".zip"
                  onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
                />
                {uploadFile ? (
                  <div className="text-[11px] text-muted-foreground">
                    {uploadFile.name} · {(uploadFile.size / 1024 / 1024).toFixed(1)} MB
                    {uploadedPath ? " · enviado" : uploadPct > 0 ? " · enviando…" : ""}
                  </div>
                ) : (
                  <div className="text-[11px] text-muted-foreground">
                    Até {MAX_UPLOAD_MB} MB.
                  </div>
                )}
                {uploadPct > 0 && !uploadedPath && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${uploadPct}%` }}
                    />
                  </div>
                )}

                {precheck && precheck.errors.length === 0 && (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-[11px] text-emerald-700 dark:text-emerald-300">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <CheckCircle2 className="size-3.5" /> Estrutura do ZIP validada
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      Schema v{precheck.schemaVersion} ·{" "}
                      {precheck.generatedAt
                        ? new Date(precheck.generatedAt).toLocaleString("pt-BR")
                        : "data desconhecida"}{" "}
                      · {precheck.tables.length} tabela(s)
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {precheck.tables.slice(0, 12).map((t) => (
                        <span
                          key={t.table}
                          className="rounded-full border border-border bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {t.table}
                          {t.rows > 0 ? ` · ${fmt(t.rows)}` : ""}
                        </span>
                      ))}
                    </div>
                    {precheck.warnings.map((w) => (
                      <div key={w} className="mt-1 text-amber-600 dark:text-amber-400">
                        Atenção: {w}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {errorInfo && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-[11px] text-destructive">
                <div className="font-semibold">Falha na etapa: {errorInfo.stage}</div>
                {errorInfo.file ? (
                  <div className="mt-0.5 text-muted-foreground">Arquivo: {errorInfo.file}</div>
                ) : null}
                <div className="mt-1 break-words">{errorInfo.message}</div>
                {errorInfo.hint ? (
                  <div className="mt-1 text-muted-foreground">Como resolver: {errorInfo.hint}</div>
                ) : null}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button disabled={!canPreview || loading} onClick={() => void handlePreview()}>
                {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Analisar backup
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "preview" && previewData && (
          <div className="space-y-4">
            <div
              className={cn(
                "rounded-md border p-3 text-xs",
                previewData.targetEnv === "sandbox"
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "border-border bg-muted/40",
              )}
            >
              <div className="font-semibold">
                Destino: {previewData.targetEnv === "sandbox" ? "SANDBOX (Modo Teste)" : "PRODUÇÃO"}
              </div>
              <div className="mt-0.5">
                {previewData.targetEnv === "sandbox"
                  ? "O ambiente de teste será ZERADO antes de carregar este backup. Todos os registros recebem novos identificadores e ficam isolados — a produção não será alterada."
                  : "Os dados serão gravados no ambiente real."}
              </div>
              {previewData.skippedTables.length > 0 && (
                <div className="mt-1 opacity-80">
                  Não importadas em teste: {previewData.skippedTables.join(", ")}
                </div>
              )}
            </div>
            <div className="rounded-md border border-border bg-card/50 p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">{previewData.filename}</div>
                  <div className="text-muted-foreground">
                    Gerado em{" "}
                    {previewData.generatedAt
                      ? new Date(previewData.generatedAt).toLocaleString("pt-BR")
                      : "—"}{" "}
                    · schema v{previewData.schemaVersion}
                  </div>
                </div>
                <div className="text-muted-foreground">
                  {previewData.storageObjectCount} arquivo(s) originais
                </div>
              </div>
            </div>

            {previewData.businessSummary ? (
              <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-card/50 p-3 text-xs sm:grid-cols-4">
                <Metric
                  label="Clientes"
                  b={previewData.businessSummary.clients.total}
                  c={previewData.current.clients.total}
                />
                <Metric
                  label="Produtos"
                  b={previewData.businessSummary.products.total}
                  c={previewData.current.products.total}
                />
                <Metric
                  label="Acordos MGMV"
                  b={previewData.businessSummary.mgmv.agreements}
                  c={previewData.current.mgmv.agreements}
                />
                <Metric
                  label="Parcelas pendentes"
                  b={previewData.businessSummary.mgmv.installmentsPending}
                  c={previewData.current.mgmv.installmentsPending}
                  invert
                />
                <Metric
                  label="NFs"
                  b={previewData.businessSummary.nfInvoices.total}
                  c={previewData.current.nfInvoices.total}
                />
                <Metric
                  label="Inadimplência (R$)"
                  b={Math.round(previewData.businessSummary.financeiro.overdueCents / 100)}
                  c={Math.round(previewData.current.financeiro.overdueCents / 100)}
                  invert
                />
                <Metric
                  label="A receber (R$)"
                  b={Math.round(previewData.businessSummary.financeiro.receivableCents / 100)}
                  c={Math.round(previewData.current.financeiro.receivableCents / 100)}
                />
                <Metric
                  label="Recebido (R$)"
                  b={Math.round(previewData.businessSummary.financeiro.receivedCents / 100)}
                  c={Math.round(previewData.current.financeiro.receivedCents / 100)}
                />
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                Backup sem resumo de negócio (formato antigo). Restauração ainda funciona.
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Tabelas a restaurar
              </Label>
              <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-border p-2 text-xs sm:grid-cols-3">
                {previewData.availableTables.map((t) => (
                  <label key={t} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedTables.has(t)}
                      onChange={() => toggleTable(t)}
                    />
                    <span>
                      {t}{" "}
                      <span className="text-muted-foreground">
                        ({fmt(previewData.rowCounts[t] ?? 0)})
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 rounded-md border border-border p-3">
                <Label>Modo</Label>
                {previewData.targetEnv === "sandbox" ? (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
                    No Modo Teste sempre é <strong>zerar e carregar</strong>: o ambiente de
                    teste é limpo por completo antes da importação, para você comparar os
                    dados sem sobras da execução anterior.
                  </div>
                ) : (
                  <>
                <Select value={mode} onValueChange={(v) => setMode(v as any)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="merge">
                      Merge (upsert por id — mantém extras)
                    </SelectItem>
                    <SelectItem value="replace">
                      Substituir tudo (apaga antes de inserir)
                    </SelectItem>
                  </SelectContent>
                </Select>
                {mode === "replace" ? (
                  <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-2">
                    <div className="flex items-center gap-1 text-[11px] text-destructive">
                      <AlertTriangle className="size-3" /> Ação destrutiva. Digite REPLACE para confirmar:
                    </div>
                    <Input
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder="REPLACE"
                      className="h-7 text-xs"
                    />
                  </div>
                ) : null}
                  </>
                )}
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <div className="text-sm font-medium">Incluir arquivos originais</div>
                  <div className="text-[11px] text-muted-foreground">
                    Reenvia HTMLs originais para o Storage
                  </div>
                </div>
                <Switch checked={includeStorage} onCheckedChange={setIncludeStorage} />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("source")}>
                Voltar
              </Button>
              <Button
                variant="secondary"
                disabled={
                  loading ||
                  selectedTables.size === 0 ||
                  previewData.targetEnv !== "sandbox"
                }
                title={
                  previewData.targetEnv !== "sandbox"
                    ? "Disponível apenas no Modo Teste — entre no sandbox para validar sem escrever."
                    : undefined
                }
                onClick={() => void handleValidate()}
              >
                {loading ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <FlaskConical className="mr-2 size-4" />
                )}
                Validar no sandbox (não aplica)
              </Button>
              <Button
                variant={
                  previewData.targetEnv !== "sandbox" && mode === "replace"
                    ? "destructive"
                    : "default"
                }
                disabled={loading || selectedTables.size === 0}
                onClick={() => void handleApply()}
              >
                {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                {previewData.targetEnv === "sandbox"
                  ? "Zerar teste e carregar backup"
                  : mode === "replace"
                    ? "Substituir tudo agora"
                    : "Aplicar merge"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "validation" && report && (
          <div className="space-y-4">
            <div
              className={cn(
                "flex items-start gap-2 rounded-md border p-3 text-xs",
                report.productionUntouched
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "border-destructive/40 bg-destructive/10 text-destructive",
              )}
            >
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              <div>
                <div className="font-semibold">
                  {report.productionUntouched
                    ? "Produção intacta — nenhuma escrita realizada"
                    : "Atenção: as contagens de produção mudaram durante a validação"}
                </div>
                <div className="mt-0.5 opacity-80">
                  Simulação no Modo Teste em {(report.durationMs / 1000).toFixed(1)}s ·{" "}
                  {report.mode === "replace" ? "Substituir tudo" : "Merge"} · {report.filename}
                </div>
              </div>
            </div>

            <div className="max-h-56 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border/60 text-left uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-1">Tabela</th>
                    <th className="px-2 py-1 text-right">Backup</th>
                    <th className="px-2 py-1 text-right">Sandbox hoje</th>
                    <th className="px-2 py-1 text-right">Inserir</th>
                    <th className="px-2 py-1 text-right">Remover</th>
                    <th className="px-2 py-1 text-right">Projetado</th>
                  </tr>
                </thead>
                <tbody>
                  {report.tables.map((t) => (
                    <tr key={t.table} className="border-b border-border/40 last:border-b-0">
                      <td className="px-2 py-1">{t.table}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmt(t.inBackup)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmt(t.currentSandbox)}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-emerald-600">
                        +{fmt(t.toInsert)}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1 text-right tabular-nums",
                          t.toDelete > 0 && "text-destructive",
                        )}
                      >
                        {t.toDelete > 0 ? `-${fmt(t.toDelete)}` : "—"}
                      </td>
                      <td className="px-2 py-1 text-right font-semibold tabular-nums">
                        {fmt(t.projected)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-card/50 p-3 text-xs sm:grid-cols-4">
              <Metric
                label="Clientes"
                b={report.projectedSummary.clients.total}
                c={report.currentSummary.clients.total}
              />
              <Metric
                label="Produtos"
                b={report.projectedSummary.products.total}
                c={report.currentSummary.products.total}
              />
              <Metric
                label="Acordos MGMV"
                b={report.projectedSummary.mgmv.agreements}
                c={report.currentSummary.mgmv.agreements}
              />
              <Metric
                label="Parcelas pendentes"
                b={report.projectedSummary.mgmv.installmentsPending}
                c={report.currentSummary.mgmv.installmentsPending}
                invert
              />
              <Metric
                label="NFs"
                b={report.projectedSummary.nfInvoices.total}
                c={report.currentSummary.nfInvoices.total}
              />
              <Metric
                label="Inadimplência (R$)"
                b={Math.round(report.projectedSummary.financeiro.overdueCents / 100)}
                c={Math.round(report.currentSummary.financeiro.overdueCents / 100)}
                invert
              />
              <Metric
                label="A receber (R$)"
                b={Math.round(report.projectedSummary.financeiro.receivableCents / 100)}
                c={Math.round(report.currentSummary.financeiro.receivableCents / 100)}
              />
              <Metric
                label="Recebido (R$)"
                b={Math.round(report.projectedSummary.financeiro.receivedCents / 100)}
                c={Math.round(report.currentSummary.financeiro.receivedCents / 100)}
              />
            </div>

            {report.issues.length > 0 ? (
              <div className="space-y-1 rounded-md border border-border p-3 text-xs">
                <div className="mb-1 font-semibold">Pontos de atenção</div>
                {report.issues.map((i, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "flex items-start gap-2",
                      i.level === "error" && "text-destructive",
                      i.level === "warn" && "text-amber-600 dark:text-amber-400",
                      i.level === "info" && "text-muted-foreground",
                    )}
                  >
                    {i.level === "info" ? (
                      <Info className="mt-0.5 size-3 shrink-0" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                    )}
                    <span>{i.message}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-4" /> Nenhum problema de integridade encontrado.
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("preview")}>
                Voltar
              </Button>
              <Button variant="secondary" onClick={downloadReport}>
                <Download className="mr-2 size-4" />
                Baixar relatório
              </Button>
              <Button
                variant={mode === "replace" ? "destructive" : "default"}
                disabled={loading}
                onClick={() => void handleApply()}
              >
                {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Aplicar no sandbox
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700">
              <CheckCircle2 className="size-4" />
              Restauração concluída em {(result.durationMs / 1000).toFixed(1)}s.
              {result.storageFilesRestored > 0
                ? ` ${result.storageFilesRestored} arquivo(s) originais reenviados.`
                : ""}
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/60 text-left uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-1">Tabela</th>
                    <th className="px-2 py-1 text-right">Inseridas</th>
                    <th className="px-2 py-1 text-right">Ignoradas</th>
                  </tr>
                </thead>
                <tbody>
                  {result.tablesRestored.map((r) => (
                    <tr key={r.table} className="border-b border-border/40 last:border-b-0">
                      <td className="px-2 py-1">{r.table}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmt(r.inserted)}</td>
                      <td
                        className={cn(
                          "px-2 py-1 text-right tabular-nums",
                          r.skipped > 0 && "text-destructive",
                        )}
                      >
                        {fmt(r.skipped)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>Fechar</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Metric({
  label,
  b,
  c,
  invert = false,
}: {
  label: string;
  b: number;
  c: number;
  invert?: boolean;
}) {
  const delta = b - c;
  const good = invert ? delta < 0 : delta > 0;
  const zero = delta === 0;
  return (
    <div className="rounded border border-border/60 bg-background p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{fmt(b)}</div>
      <div className="text-[10px] text-muted-foreground">Atual: {fmt(c)}</div>
      {!zero && (
        <div
          className={cn(
            "text-[10px] font-semibold tabular-nums",
            good ? "text-emerald-600" : "text-destructive",
          )}
        >
          {delta > 0 ? "+" : ""}
          {fmt(delta)}
        </div>
      )}
    </div>
  );
}