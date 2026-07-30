import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { History, ShieldCheck, ShieldAlert, RefreshCw, Loader2 } from "lucide-react";
import { Card } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listSandboxImportAudit, type SandboxAuditRow } from "@/lib/backup.functions";
import { cn } from "@/lib/utils";

const MODE_LABELS: Record<string, string> = {
  merge: "Mesclar",
  replace: "Substituir tudo",
  "validacao-merge": "Validação (mesclar)",
  "validacao-replace": "Validação (substituir)",
};

const SOURCE_LABELS: Record<string, string> = {
  "backup-salvo": "Backup salvo",
  "upload-zip": "Upload ZIP",
  "lista-txt": "Lista TXT",
  "zip-notion": "ZIP Notion",
};

function total(counts: Record<string, number>): number {
  return Object.values(counts ?? {}).reduce((s, n) => s + (Number(n) || 0), 0);
}

/** Histórico de tudo que foi importado ou validado dentro do Modo Teste. */
export function SandboxAuditCard() {
  const load = useServerFn(listSandboxImportAudit);
  const [rows, setRows] = useState<SandboxAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setRows(await load());
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <History className="size-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Auditoria de importações em teste</h3>
              <p className="max-w-prose text-xs text-muted-foreground">
                Cada importação ou validação feita no Modo Teste fica registrada aqui, junto
                com a conferência de que a produção não foi alterada.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Atualizar
          </Button>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
            {loading ? "Carregando…" : "Nenhuma importação registrada no Modo Teste ainda."}
          </div>
        ) : (
          <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
            {rows.map((r) => (
              <div key={r.id} className="p-3 text-xs">
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {SOURCE_LABELS[r.source] ?? r.source}
                      {r.fileName ? ` · ${r.fileName}` : ""}
                    </div>
                    <div className="text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString("pt-BR")}
                      {r.userEmail ? ` · ${r.userEmail}` : ""}
                      {r.durationMs ? ` · ${(r.durationMs / 1000).toFixed(1)}s` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant="secondary">{MODE_LABELS[r.mode] ?? r.mode}</Badge>
                    <Badge variant="outline">{total(r.rowCounts).toLocaleString("pt-BR")} linhas</Badge>
                    <Badge
                      className={cn(
                        "gap-1",
                        r.productionUntouched
                          ? "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
                          : "bg-destructive/15 text-destructive hover:bg-destructive/15",
                      )}
                    >
                      {r.productionUntouched ? (
                        <ShieldCheck className="size-3" />
                      ) : (
                        <ShieldAlert className="size-3" />
                      )}
                      {r.productionUntouched ? "Produção intacta" : "Isolamento violado"}
                    </Badge>
                  </div>
                </button>

                {expanded === r.id && (
                  <div className="mt-3 space-y-2 rounded-md border border-border/60 bg-muted/30 p-2">
                    {r.error && <div className="text-destructive">{r.error}</div>}
                    <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                      {Object.entries(r.rowCounts ?? {}).map(([table, n]) => (
                        <div key={table} className="flex justify-between gap-2">
                          <span className="truncate text-muted-foreground">{table}</span>
                          <span className="tabular-nums">{Number(n).toLocaleString("pt-BR")}</span>
                        </div>
                      ))}
                    </div>
                    {r.tables.length > 0 && (
                      <div className="text-muted-foreground">
                        Tabelas: {r.tables.join(", ")}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
