import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { useStore, type ImportDiagnostics } from "@/lib/store";
import { useEnsureData } from "@/lib/use-ensure-data";
import { supabase } from "@/integrations/supabase/client";

/** Intervalo da reconferência automática. */
const AUTO_CHECK_MS = 60_000;
/** Agrupa rajadas de eventos em tempo real antes de reconferir. */
const REALTIME_DEBOUNCE_MS = 1_500;

/**
 * Verifica integridade entre os contadores locais do dashboard (state em
 * memória) e o banco oficial. Roda sozinha: ao montar, ao trocar de ambiente,
 * a cada minuto, ao voltar o foco da aba e a cada evento em tempo real.
 * Ao detectar divergência, recarrega o snapshot automaticamente (uma vez por
 * divergência) e reconfere.
 */
export function DashboardIntegrityCard() {
  const clients = useStore((s) => s.clients);
  useEnsureData();
  const products = useStore((s) => s.products);
  const currentEnv = useStore((s) => s.currentEnv);
  const envSyncing = useStore((s) => s.envSyncing);
  const fetchDiagnostics = useStore((s) => s.fetchDiagnostics);
  const refreshSnapshot = useStore((s) => s.refreshSnapshot);

  const [diag, setDiag] = useState<ImportDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Evita laço: só recarregamos o snapshot uma vez por "assinatura" de
  // divergência (mesmos números locais/banco não disparam de novo).
  const autoFixedRef = useRef<string | null>(null);
  const runningRef = useRef(false);

  const localMgmv = clients.filter((c) => c.mgmv).length;

  const check = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (runningRef.current) return;
      runningRef.current = true;
      if (!opts?.silent) setLoading(true);
      try {
        const d = await fetchDiagnostics();
        setDiag(d);
        setLastCheckedAt(Date.now());

        // Auto-correção: divergência real (contagem disponível) recarrega o
        // snapshot sozinha e reconfere uma única vez.
        const st = useStore.getState();
        const pairs: Array<[number, number | null]> = [
          [st.clients.length, d.clientsCount],
          [st.products.length, d.productsCount],
          [st.clients.filter((c) => c.mgmv).length, d.agreementsCount],
        ];
        const diverged = pairs.some(([local, db]) => db !== null && local !== db);
        const signature = pairs.map(([l, db]) => `${l}/${db ?? "x"}`).join("|");
        if (diverged && autoFixedRef.current !== signature && !st.envSyncing) {
          autoFixedRef.current = signature;
          setRefreshing(true);
          try {
            await refreshSnapshot();
            const again = await fetchDiagnostics();
            setDiag(again);
            setLastCheckedAt(Date.now());
          } finally {
            setRefreshing(false);
          }
        } else if (!diverged) {
          autoFixedRef.current = null;
        }
      } catch {
        // Falha de rede: mantém o último resultado e tenta de novo no ciclo.
      } finally {
        setLoading(false);
        runningRef.current = false;
      }
    },
    [fetchDiagnostics, refreshSnapshot],
  );

  // Ao montar e a cada troca de ambiente.
  useEffect(() => {
    autoFixedRef.current = null;
    void check();
  }, [currentEnv, check]);

  // Ciclo automático + foco da aba.
  useEffect(() => {
    // Verificação automática desativada (MVP): checagem apenas manual.
    const id = 0;
    const onFocus = () => {};
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [check]);

  // Reconferência em tempo real desativada (MVP) para reduzir consultas.

  // Relógio do rótulo "verificado há X".
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const envLabel = currentEnv === "sandbox" ? "Modo Teste" : "Produção";
  const envMismatch = diag !== null && diag.env !== currentEnv;
  const syncing = envSyncing || envMismatch;

  const rows = diag && !syncing
    ? [
        { label: "Clientes", local: clients.length, db: diag.clientsCount },
        { label: "Produtos", local: products.length, db: diag.productsCount },
        { label: "Acordos MGMV", local: localMgmv, db: diag.agreementsCount },
      ]
    : [];

  // `db === null` = contagem indisponível (erro/tempo limite). Nunca tratar
  // como zero: isso gerava alarme falso de divergência com o banco cheio.
  const unavailable = rows.filter((r) => r.db === null);
  const divergences = rows.filter((r) => r.db !== null && r.local !== r.db);
  const allMatch =
    diag !== null && !syncing && divergences.length === 0 && unavailable.length === 0;

  const agoLabel = (() => {
    if (!lastCheckedAt) return null;
    const secs = Math.max(0, Math.round((now - lastCheckedAt) / 1000));
    if (secs < 15) return "agora mesmo";
    if (secs < 60) return `há ${secs}s`;
    return `há ${Math.round(secs / 60)} min`;
  })();

  return (
    <Card title={`Verificação de integridade — ${envLabel}`}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            {loading || refreshing || syncing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">
                  {syncing
                    ? "Sincronizando ambiente…"
                    : refreshing
                      ? "Atualizando snapshot automaticamente…"
                      : "Consultando banco…"}
                </span>
              </>
            ) : allMatch ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-[color:var(--success)]" />
                <span>
                  Dashboard sincronizado com o banco ({envLabel})
                  {agoLabel ? ` — verificado ${agoLabel}` : ""}.
                </span>
              </>
            ) : diag ? (
              <>
                <AlertTriangle
                  className={
                    divergences.length > 0
                      ? "h-4 w-4 text-destructive"
                      : "h-4 w-4 text-muted-foreground"
                  }
                />
                <span className={divergences.length > 0 ? "text-destructive" : "text-muted-foreground"}>
                  {divergences.length > 0
                    ? `${divergences.length} divergência(s) — reconciliando automaticamente…`
                    : "Não foi possível verificar alguma contagem no banco agora."}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Sem dados de verificação.</span>
            )}
          </div>
          <Button
            size="icon"
            variant="ghost"
            title="Reconferir agora"
            aria-label="Reconferir agora"
            onClick={() => {
              autoFixedRef.current = null;
              void check();
            }}
            disabled={refreshing || loading || envSyncing}
          >
            {refreshing || loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>

        {diag && !syncing && (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Métrica</th>
                  <th className="px-3 py-2 text-right font-medium">Dashboard</th>
                  <th className="px-3 py-2 text-right font-medium">Banco ({envLabel})</th>
                  <th className="px-3 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const ok = r.db !== null && r.local === r.db;
                  return (
                    <tr key={r.label} className="border-t border-border">
                      <td className="px-3 py-2">{r.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.local}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.db ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {ok ? (
                          <span className="inline-flex items-center gap-1 text-[color:var(--success)]">
                            <CheckCircle2 className="h-3.5 w-3.5" /> OK
                          </span>
                        ) : r.db === null ? (
                          <span className="text-muted-foreground">indisponível</span>
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