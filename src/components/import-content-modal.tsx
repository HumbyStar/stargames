import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { ImportHistoryEntry } from "@/lib/store";

/** Janela de auditoria usada para reconstruir o conteúdo de importações antigas. */
function windowFor(entry: ImportHistoryEntry) {
  const end = new Date(entry.date).getTime() + 60_000;
  const start = end - (entry.durationMs ?? 0) - 5 * 60_000;
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

function money(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "—";
}

/**
 * Mostra o texto de uma importação. Quando o conteúdo original não foi
 * guardado (importações antigas), reconstrói a listagem a partir do registro
 * de auditoria dos clientes e produtos criados naquela importação.
 */
export function ImportContentModal({
  entry,
  onClose,
}: {
  entry: ImportHistoryEntry | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    if (entry.rawContent) {
      setContent(entry.rawContent);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    setContent("");
    const { start, end } = windowFor(entry);
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
          "Não foi possível reconstruir o conteúdo desta importação (acesso ao histórico de auditoria restrito a administradores).",
        );
        return;
      }
      const rows = (data ?? []).filter(
        (r) => !entry.userId || !r.user_id || r.user_id === entry.userId,
      );
      const names = new Map<string, string>();
      for (const r of rows) {
        if (r.table_name !== "clients") continue;
        const d = (r.new_data ?? {}) as Record<string, unknown>;
        if (d.id) names.set(String(d.id), String(d.name ?? "—"));
      }
      const lines: string[] = [];
      for (const r of rows) {
        if (r.table_name !== "products") continue;
        const d = (r.new_data ?? {}) as Record<string, unknown>;
        const cliente = names.get(String(d.client_id)) ?? "(cliente existente)";
        lines.push(
          [
            cliente,
            String(d.name ?? "—"),
            String(d.platform ?? "—"),
            money(d.total_value),
            money(d.paid_value),
            String(d.financial_status ?? "—"),
            String(d.situation ?? "—"),
          ].join(" | "),
        );
      }
      if (lines.length === 0) {
        setError("Nenhum registro encontrado no período desta importação.");
        return;
      }
      setContent(
        ["Cliente | Produto | Plataforma | Total | Pago | Status | Situação", ...lines].join("\n"),
      );
    })();
    return () => {
      alive = false;
    };
  }, [entry]);

  return (
    <Dialog open={entry !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Conteúdo da importação</DialogTitle>
          <DialogDescription>
            {entry
              ? `${entry.file} · ${new Date(entry.date).toLocaleString("pt-BR")}${
                  entry.userEmail ? ` · ${entry.userEmail}` : ""
                }`
              : ""}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando conteúdo…
          </div>
        ) : error ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{error}</p>
        ) : (
          <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs">
            {content}
          </pre>
        )}
        <div className="flex justify-end gap-2">
          {content && (
            <Button
              variant="outline"
              onClick={() => void navigator.clipboard.writeText(content)}
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