import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useServerFn } from "@tanstack/react-start";
import {
  listNfInvoices,
  deleteNfInvoice,
  type NfInvoiceRow,
} from "@/lib/nf-history.functions";
import { toast } from "sonner";
import { Copy, Loader2, Receipt, Trash2 } from "lucide-react";
import { formatBRL } from "@/lib/store";

interface Props {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName: string;
}

export function NfHistoryModal({ open, onClose, clientId, clientName }: Props) {
  const list = useServerFn(listNfInvoices);
  const remove = useServerFn(deleteNfInvoice);
  const [rows, setRows] = useState<NfInvoiceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await list({ data: { clientId } });
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar histórico.");
    } finally {
      setLoading(false);
    }
  }, [list, clientId]);

  useEffect(() => {
    if (open) refetch();
  }, [open, refetch]);

  async function handleCopy(row: NfInvoiceRow) {
    try {
      await navigator.clipboard.writeText(row.content);
      toast.success("Nota copiada para envio ao contador.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  async function handleDelete(row: NfInvoiceRow) {
    if (!window.confirm("Excluir esta nota fiscal do histórico?")) return;
    setDeletingId(row.id);
    try {
      await remove({ data: { id: row.id } });
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success("Nota excluída.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao excluir.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" />
            Notas Fiscais — {clientName}
          </DialogTitle>
          <DialogDescription>
            Histórico de notas geradas. Use Copiar para enviar ao contador.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        )}

        {!loading && error && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhuma nota fiscal gerada ainda.
          </div>
        )}

        {!loading && rows.length > 0 && (
          <ul className="space-y-3">
            {rows.map((row) => {
              const date = new Date(row.createdAt);
              const preview = row.content.split("\n").slice(0, 4).join("\n");
              return (
                <li
                  key={row.id}
                  className="rounded-md border border-border bg-card p-3 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm">
                      <div className="font-medium">
                        {date.toLocaleString("pt-BR")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.productIds.length} produto(s) ·{" "}
                        {formatBRL(row.totalCents / 100)}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCopy(row)}
                      >
                        <Copy className="mr-2 h-4 w-4" /> Copiar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(row)}
                        disabled={deletingId === row.id}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <pre className="whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs font-mono text-muted-foreground">
                    {preview}
                    {row.content.split("\n").length > 4 ? "\n…" : ""}
                  </pre>
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}