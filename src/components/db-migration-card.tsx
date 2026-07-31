import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  Info,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildDbMigrationPackage,
  previewDbMigration,
  type MigrationPackageResult,
  type MigrationPreview,
} from "@/lib/db-migration.functions";
import {
  MIGRATION_DESTINATIONS,
  destinationById,
  type MigrationDestinationId,
  type MigrationMode,
} from "@/lib/db-migration-formats";
import { useSandbox } from "@/lib/use-sandbox";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DbMigrationCard() {
  const { state } = useSandbox();
  const currentEnv: "producao" | "sandbox" = state.active ? "sandbox" : "producao";

  const [env, setEnv] = useState<"producao" | "sandbox">(currentEnv);
  const [destination, setDestination] = useState<MigrationDestinationId>("supabase");
  const [mode, setMode] = useState<MigrationMode>("full");
  const [preview, setPreview] = useState<MigrationPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<MigrationPackageResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runPreview = useServerFn(previewDbMigration);
  const runBuild = useServerFn(buildDbMigrationPackage);

  useEffect(() => setEnv(currentEnv), [currentEnv]);

  const loadPreview = useCallback(
    async (target: "producao" | "sandbox") => {
      setLoadingPreview(true);
      setError(null);
      try {
        const data = await runPreview({ data: { env: target } });
        setPreview(data);
      } catch (err) {
        setPreview(null);
        setError(err instanceof Error ? err.message : "Falha ao ler a estrutura do banco.");
      } finally {
        setLoadingPreview(false);
      }
    },
    [runPreview],
  );

  useEffect(() => {
    void loadPreview(env);
    setResult(null);
  }, [env, loadPreview]);

  const dest = useMemo(() => destinationById(destination)!, [destination]);

  const handleBuild = async () => {
    setBuilding(true);
    setError(null);
    setResult(null);
    try {
      const data = await runBuild({ data: { destination, mode, env } });
      setResult(data);
      toast.success("Pacote de migração gerado", {
        description: `${data.filename} • ${formatBytes(data.sizeBytes)}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao gerar o pacote.";
      setError(message);
      toast.error("Não foi possível gerar o pacote", { description: message });
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
        <div className="mb-4 flex items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <Database className="size-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold">Migrar banco de dados</h3>
            <p className="text-sm text-muted-foreground">
              Gere um pacote pronto para clonar este sistema em outra conta ou provedor de nuvem.
              Estrutura, dados e instruções vêm no mesmo arquivo.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Ambiente de origem</Label>
            <Select value={env} onValueChange={(v) => setEnv(v as "producao" | "sandbox")}>
              <SelectTrigger className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="producao">Produção</SelectItem>
                <SelectItem value="sandbox">Modo Teste</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Destino</Label>
            <Select
              value={destination}
              onValueChange={(v) => setDestination(v as MigrationDestinationId)}
            >
              <SelectTrigger className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MIGRATION_DESTINATIONS.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Conteúdo</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as MigrationMode)}>
              <SelectTrigger className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Clone completo (estrutura + dados)</SelectItem>
                <SelectItem value="schema">Somente estrutura (projeto em branco)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
          <p className="text-sm font-medium">{dest.label}</p>
          <p className="mt-1 text-sm text-muted-foreground">{dest.summary}</p>
          <ol className="mt-3 space-y-1 text-sm text-muted-foreground">
            {dest.howTo.map((step, i) => (
              <li key={step} className="flex gap-2">
                <span className="text-primary">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={handleBuild} disabled={building || loadingPreview} className="gap-2 min-h-11">
            {building ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {building ? "Gerando pacote…" : "Gerar pacote de migração"}
          </Button>
          <Button
            variant="outline"
            className="gap-2 min-h-11"
            onClick={() => void loadPreview(env)}
            disabled={loadingPreview}
          >
            <RefreshCw className={cn("size-4", loadingPreview && "animate-spin")} />
            Revalidar
          </Button>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {result && (
          <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Pacote pronto</p>
                <p className="truncate text-sm text-muted-foreground">
                  {result.filename} • {formatBytes(result.sizeBytes)} •{" "}
                  {result.totalRows.toLocaleString("pt-BR")} registros
                </p>
                <a
                  href={result.url}
                  className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-2 hover:underline"
                  download
                >
                  <Download className="size-4" />
                  Baixar agora (link válido por 30 minutos)
                </a>
              </div>
            </div>
            {result.warnings.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
                {result.warnings.map((w, i) => (
                  <li key={`${w.table ?? "geral"}-${i}`} className="flex gap-2 text-sm">
                    {w.level === "info" ? (
                      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                    )}
                    <span className="text-muted-foreground">
                      {w.table ? <strong className="text-foreground">{w.table}: </strong> : null}
                      {w.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-xs">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold">Pré-validação do ambiente</h4>
          {preview && (
            <span className="text-xs text-muted-foreground">
              {preview.totalRows.toLocaleString("pt-BR")} registros • {preview.enums} tipos •{" "}
              {preview.functions} funções • {preview.policies} regras de acesso
            </span>
          )}
        </div>

        {loadingPreview && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Lendo a estrutura do banco…
          </p>
        )}

        {!loadingPreview && preview && (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {preview.tables.map((t) => (
              <div
                key={t.name}
                className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-sm"
              >
                <span className="truncate font-medium">{t.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {t.rows.toLocaleString("pt-BR")} linhas • {t.columns} campos
                </span>
              </div>
            ))}
          </div>
        )}

        {!loadingPreview && !preview && !error && (
          <p className="text-sm text-muted-foreground">Nenhuma informação carregada ainda.</p>
        )}
      </div>
    </div>
  );
}