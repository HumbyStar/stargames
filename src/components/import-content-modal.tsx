import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useStore, type ImportHistoryEntry } from "@/lib/store";

/**
 * Janela de auditoria usada para reconstruir o conteúdo de importações antigas.
 * O limite inferior nunca passa da importação anterior, para não misturar
 * registros de duas importações feitas com poucos minutos de diferença.
 */
function windowFor(entry: ImportHistoryEntry, previousDate?: string) {
  const end = new Date(entry.date).getTime() + 5_000;
  let start = end - (entry.durationMs ?? 0) - 5 * 60_000;
  if (previousDate) {
    const prev = new Date(previousDate).getTime() + 1_000;
    if (prev > start) start = prev;
  }
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

function money(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "—";
}

function plainNumber(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2).replace(".", ",") : "";
}

interface RecordRow {
  clientId: string;
  clientName: string;
  clientPhone: string;
  clientCreated: boolean;
  productName: string;
  platform: string;
  total: unknown;
  paid: unknown;
  status: string;
  situation: string;
}

interface ClientGroup {
  clientId: string;
  name: string;
  phone: string;
  created: boolean;
  rows: RecordRow[];
  total: number;
  paid: number;
}

/**
 * Mostra o conteúdo de uma importação em três formatos: os registros que o
 * sistema realmente criou (clientes + produtos), o mesmo conteúdo no formato
 * aceito pela importação por lista, e o texto original colado (quando houver).
 */
export function ImportContentModal({
  entry,
  onClose,
}: {
  entry: ImportHistoryEntry | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("registros");
  const history = useStore((s) => s.importHistory);

  useEffect(() => {
    if (!entry) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setRows([]);
    setTab("registros");
    const previous = history
      .filter((h) => new Date(h.date).getTime() < new Date(entry.date).getTime())
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    const { start, end } = windowFor(entry, previous?.date);
    void (async () => {
      const { data, error: err } = await supabase
        .from("audit_log")
        .select("table_name, new_data, changed_at, user_id")
        .in("table_name", ["clients", "products"])
        .eq("action", "INSERT")
        .gte("changed_at", start)
        .lte("changed_at", end)
        .order("changed_at", { ascending: true })
        .limit(5000);
      if (!alive) return;
      setLoading(false);
      if (err) {
        setError(
          "Não foi possível reconstruir os registros desta importação (acesso ao histórico de auditoria restrito a administradores).",
        );
        if (entry.rawContent) setTab("texto");
        return;
      }
      const audited = data ?? [];
      const filtered = audited.filter(
        (r) => !entry.userId || !r.user_id || r.user_id === entry.userId,
      );
      const created = new Map<string, { name: string; phone: string }>();
      for (const r of filtered) {
        if (r.table_name !== "clients") continue;
        const d = (r.new_data ?? {}) as Record<string, unknown>;
        if (d.id)
          created.set(String(d.id), {
            name: String(d.name ?? "—"),
            phone: String(d.phone ?? ""),
          });
      }
      // Clientes que já existiam antes desta importação: busca nome/telefone
      // atuais direto na tabela de clientes.
      const missing = new Set<string>();
      for (const r of filtered) {
        if (r.table_name !== "products") continue;
        const d = (r.new_data ?? {}) as Record<string, unknown>;
        const cid = d.client_id ? String(d.client_id) : "";
        if (cid && !created.has(cid)) missing.add(cid);
      }
      const existing = new Map<string, { name: string; phone: string }>();
      if (missing.size > 0) {
        const { data: clientRows } = await supabase
          .from("clients")
          .select("id, name, phone")
          .in("id", Array.from(missing));
        if (!alive) return;
        for (const c of clientRows ?? []) {
          existing.set(String(c.id), {
            name: String(c.name ?? "—"),
            phone: String(c.phone ?? ""),
          });
        }
      }
      const out: RecordRow[] = [];
      for (const r of filtered) {
        if (r.table_name !== "products") continue;
        const d = (r.new_data ?? {}) as Record<string, unknown>;
        const cid = String(d.client_id ?? "");
        const info = created.get(cid) ?? existing.get(cid);
        out.push({
          clientId: cid,
          clientName: info?.name ?? "(cliente removido)",
          clientPhone: info?.phone ?? "",
          clientCreated: created.has(cid),
          productName: String(d.name ?? "—"),
          platform: String(d.platform ?? "—"),
          total: d.total_value,
          paid: d.paid_value,
          status: String(d.financial_status ?? "—"),
          situation: String(d.situation ?? "—"),
        });
      }
      // Clientes criados sem nenhum produto atrelado também aparecem.
      const withProducts = new Set(out.map((r) => r.clientId));
      for (const [cid, info] of created) {
        if (withProducts.has(cid)) continue;
        out.push({
          clientId: cid,
          clientName: info.name,
          clientPhone: info.phone,
          clientCreated: true,
          productName: "—",
          platform: "—",
          total: null,
          paid: null,
          status: "—",
          situation: "—",
        });
      }
      if (out.length === 0) {
        setError("Nenhum registro encontrado no período desta importação.");
        return;
      }
      setRows(out);
    })();
    return () => {
      alive = false;
    };
  }, [entry, history]);

  const groups = useMemo<ClientGroup[]>(() => {
    const map = new Map<string, ClientGroup>();
    for (const r of rows) {
      let g = map.get(r.clientId);
      if (!g) {
        g = {
          clientId: r.clientId,
          name: r.clientName,
          phone: r.clientPhone,
          created: r.clientCreated,
          rows: [],
          total: 0,
          paid: 0,
        };
        map.set(r.clientId, g);
      }
      g.rows.push(r);
      g.total += Number(r.total) || 0;
      g.paid += Number(r.paid) || 0;
    }
    return Array.from(map.values());
  }, [rows]);

  /** Mesmo conteúdo no formato aceito pela importação por lista. */
  const importFormat = useMemo(() => {
    return rows
      .filter((r) => r.productName !== "—")
      .map((r) =>
        [
          r.clientName,
          r.clientPhone || "—",
          r.productName,
          r.platform,
          plainNumber(r.total),
          r.status,
        ].join(" - "),
      )
      .join("\n");
  }, [rows]);

  const copyTarget =
    tab === "texto" ? (entry?.rawContent ?? "") : tab === "formato" ? importFormat : importFormat;

  return (
    <Dialog open={entry !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Conteúdo da importação</DialogTitle>
          <DialogDescription>
            {entry
              ? `${entry.file} · ${new Date(entry.date).toLocaleString("pt-BR")} · ${
                  entry.userEmail ?? "Usuário não identificado"
                }`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando conteúdo…
          </div>
        ) : (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="registros">Registros do sistema</TabsTrigger>
              <TabsTrigger value="formato">Formato de importação</TabsTrigger>
              <TabsTrigger value="texto" disabled={!entry?.rawContent}>
                Texto original
              </TabsTrigger>
            </TabsList>

            <TabsContent value="registros" className="mt-3">
              {error ? (
                <p className="py-8 text-center text-sm text-muted-foreground">{error}</p>
              ) : (
                <div className="max-h-[55vh] space-y-3 overflow-auto pr-1">
                  <p className="text-xs text-muted-foreground">
                    {groups.length} cliente(s) ·{" "}
                    {rows.filter((r) => r.productName !== "—").length} produto(s) gravados nesta
                    importação.
                  </p>
                  {groups.map((g) => (
                    <div
                      key={g.clientId}
                      className="overflow-hidden rounded-lg border border-border"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/40 px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{g.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {g.phone || "sem telefone"}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={g.created ? "default" : "secondary"}>
                            {g.created ? "Cliente novo" : "Já existia"}
                          </Badge>
                          <Badge variant="outline">
                            {g.rows.filter((r) => r.productName !== "—").length} produto(s)
                          </Badge>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {money(g.total)} · pago {money(g.paid)}
                          </span>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-muted-foreground">
                            <tr className="border-b border-border/60">
                              <th className="px-3 py-1.5 text-left font-medium">Produto</th>
                              <th className="px-3 py-1.5 text-left font-medium">Plataforma</th>
                              <th className="px-3 py-1.5 text-right font-medium">Total</th>
                              <th className="px-3 py-1.5 text-right font-medium">Pago</th>
                              <th className="px-3 py-1.5 text-left font-medium">Status</th>
                              <th className="px-3 py-1.5 text-left font-medium">Situação</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.rows.map((r, i) => (
                              <tr key={i} className="border-b border-border/40 last:border-0">
                                <td className="px-3 py-1.5">{r.productName}</td>
                                <td className="px-3 py-1.5">{r.platform}</td>
                                <td className="px-3 py-1.5 text-right tabular-nums">
                                  {money(r.total)}
                                </td>
                                <td className="px-3 py-1.5 text-right tabular-nums">
                                  {money(r.paid)}
                                </td>
                                <td className="px-3 py-1.5">{r.status}</td>
                                <td className="px-3 py-1.5">{r.situation}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="formato" className="mt-3">
              <p className="mb-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Linhas no formato aceito pela importação por lista: Nome - Telefone - Produto -
                Plataforma - Valor - Status.
              </p>
              <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs">
                {importFormat || error || "Sem registros para exibir."}
              </pre>
            </TabsContent>

            <TabsContent value="texto" className="mt-3">
              <p className="mb-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Texto original exatamente como foi colado na importação.
              </p>
              <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs">
                {entry?.rawContent ?? "Esta importação não guardou o texto original."}
              </pre>
            </TabsContent>
          </Tabs>
        )}

        <div className="flex justify-end gap-2">
          {copyTarget && (
            <Button
              variant="outline"
              onClick={() => void navigator.clipboard.writeText(copyTarget)}
            >
              Copiar
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
