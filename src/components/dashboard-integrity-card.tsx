import { useEffect, useState } from "react";
import { RefreshCw, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { useStore, type ImportDiagnostics } from "@/lib/store";
import { toast } from "sonner";

/**
 * Verifica integridade entre contadores locais do dashboard (state em memória)
 * e o que está no banco oficial (mesma fonte usada em Configurações).
 * Mostra alerta se divergir e oferece botão para recarregar o snapshot.
 */
export function DashboardIntegrityCard() {
  const clients = useStore((s) => s.clients);
  const products = useStore((s) => s.products);
  const fetchDiagnostics = useStore((s) => s.fetchDiagnostics);
  const refreshSnapshot = useStore((s) => s.refreshSnapshot);

  const [diag, setDiag] = useState<ImportDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const localMgmv = clients.filter((c) => c.mgmv).length;

  async function check() {
    setLoading(true);
    try {
      const d = await fetchDiagnostics();
      setDiag(d);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshSnapshot();
      const d = await fetchDiagnostics();
      setDiag(d);
      toast.success("Snapshot recarregado do banco oficial.");
    } catch (err) {
      toast.error("Falha ao recarregar snapshot.", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRefreshing(false);
    }
  }

  const rows = diag
    ? [
        { label: "Clientes", local: clients.length, db: diag.clientsCount },
        { label: "Produtos", local: products.length, db: diag.productsCount },
        { label: "Acordos MGMV", local: localMgmv, db: diag.agreementsCount },
      ]
    : [];

  const divergences = rows.filter((r) => r.local !== r.db);
  const allMatch = diag !== null && divergences.length === 0;

  return (
    <Card title="Verificação de integridade">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">Consultando banco…</span>
              </>
            ) : allMatch ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-[color:var(--success)]" />
                <span>Dashboard sincronizado com o banco oficial.</span>
              </>
            ) : diag ? (
              <>
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <span className="text-destructive">
                  {divergences.length} divergência(s) detectada(s) — recarregue o snapshot.
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Sem dados de verificação.</span>
            )}
          </div>
          <Button
            size="sm"
            variant={allMatch ? "outline" : "default"}
            onClick={handleRefresh}
            disabled={refreshing || loading}
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Atualizar snapshot
          </Button>
        </div>

        {diag && (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Métrica</th>
                  <th className="px-3 py-2 text-right font-medium">Dashboard</th>
                  <th className="px-3 py-2 text-right font-medium">Banco (Configurações)</th>
                  <th className="px-3 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ok = r.local === r.db;
                  return (
                    <tr key={r.label} className="border-t border-border">
                      <td className="px-3 py-2">{r.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.local}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.db}</td>
                      <td className="px-3 py-2 text-right">
                        {ok ? (
                          <span className="inline-flex items-center gap-1 text-[color:var(--success)]">
                            <CheckCircle2 className="h-3.5 w-3.5" /> OK
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-destructive">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {r.db - r.local > 0 ? `+${r.db - r.local}` : r.db - r.local} no banco
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}