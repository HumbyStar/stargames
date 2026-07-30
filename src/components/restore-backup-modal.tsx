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
  type BackupRow,
  type RestorePreview,
  type RestoreResult,
  type ValidationReport,
} from "@/lib/backup.functions";
import { formatDateBR } from "@/lib/store";
import { cn } from "@/lib/utils";

type Step = "source" | "preview" | "validation" | "done";

const MAX_UPLOAD_MB = 500;

function fmt(n: number): string {
  return (n ?? 0).toLocaleString("pt-BR");
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as any);
  }
  return btoa(binary);
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

  const [step, setStep] = useState<Step>("source");
  const [source, setSource] = useState<"existing" | "upload">(initialSource);
  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [backupId, setBackupId] = useState<string>("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadedBase64, setUploadedBase64] = useState<string>("");
  const [previewData, setPreviewData] = useState<RestorePreview | null>(null);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [includeStorage, setIncludeStorage] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RestoreResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("source");
    setSource(initialSource);
    setBackupId("");
    setUploadFile(null);
    setUploadedBase64("");
    setPreviewData(null);
    setSelectedTables(new Set());
    setMode("merge");
    setIncludeStorage(false);
    setConfirmText("");
    setResult(null);
    void list().then((rows) => {
      const completed = rows.filter((r) => r.status === "completed");
      setBackups(completed);
      if (completed[0]) setBackupId(completed[0].id);
    });
  }, [open, initialSource, list]);

  const canPreview = useMemo(() => {
    if (source === "existing") return Boolean(backupId);
    return Boolean(uploadedBase64);
  }, [source, backupId, uploadedBase64]);

  const handleFile = async (file: File | null) => {
    setUploadFile(file);
    if (!file) {
      setUploadedBase64("");
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setUploadFile(null);
      setUploadedBase64("");
      toast.error(`Arquivo maior que ${MAX_UPLOAD_MB} MB.`);
      return;
    }
    setLoading(true);
    try {
      const b64 = await fileToBase64(file);
      setUploadedBase64(b64);
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao ler arquivo.");
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = async () => {
    setLoading(true);
    try {
      const res = await preview({
        data:
          source === "existing"
            ? { backupId }
            : { uploadedZipBase64: uploadedBase64 },
      });
      setPreviewData(res);
      setSelectedTables(new Set(res.availableTables));
      setStep("preview");
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao ler backup.");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (mode === "replace" && confirmText !== "REPLACE") {
      toast.error('Digite "REPLACE" para confirmar a substituição.');
      return;
    }
    setLoading(true);
    toast.loading("Restaurando backup…", { id: "restore" });
    try {
      const res = await restore({
        data: {
          ...(source === "existing"
            ? { backupId }
            : { uploadedZipBase64: uploadedBase64 }),
          mode,
          tables: Array.from(selectedTables),
          includeStorage,
          confirmReplace: mode === "replace" ? confirmText : undefined,
        },
      });
      setResult(res);
      setStep("done");
      toast.success("Restauração concluída.", { id: "restore" });
      // Dispara reset em cache/realtime.
      window.dispatchEvent(new CustomEvent("app:reset"));
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao restaurar.", { id: "restore" });
    } finally {
      setLoading(false);
    }
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
                  </div>
                ) : (
                  <div className="text-[11px] text-muted-foreground">
                    Até {MAX_UPLOAD_MB} MB.
                  </div>
                )}
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
                  ? "Todos os registros recebem novos identificadores e ficam isolados. A produção não será alterada."
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
                variant={mode === "replace" ? "destructive" : "default"}
                disabled={loading || selectedTables.size === 0}
                onClick={() => void handleApply()}
              >
                {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                {mode === "replace" ? "Substituir tudo agora" : "Aplicar merge"}
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