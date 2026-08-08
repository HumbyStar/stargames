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
import { Textarea } from "@/components/ui/textarea";
import { useServerFn } from "@tanstack/react-start";
import {
  listNfInvoices,
  deleteNfInvoice,
  updateNfInvoice,
  listNfInvoiceAudit,
  type NfInvoiceRow,
  type NfAuditEntry,
} from "@/lib/nf-history.functions";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Loader2,
  Pencil,
  Receipt,
  Save,
  Trash2,
  X,
  History,
} from "lucide-react";
import { formatBRL } from "@/lib/store";
import { downloadNfPdf } from "@/lib/nf-pdf";

interface Props {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName: string;
}

function diffLines(oldText: string | null, newText: string | null) {
  const oldLines = (oldText ?? "").split("\n");
  const newLines = (newText ?? "").split("\n");
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  return {
    removed: oldLines.filter((l) => l.trim() && !newSet.has(l)),
    added: newLines.filter((l) => l.trim() && !oldSet.has(l)),
  };
}

function NfAuditTrail({ invoiceId }: { invoiceId: string }) {
  const listAudit = useServerFn(listNfInvoiceAudit);
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<NfAuditEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && entries === null) {
      setLoading(true);
      setErr(null);
      try {
        setEntries(await listAudit({ data: { id: invoiceId } }));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Falha ao carregar auditoria.");
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="rounded border border-border/60 bg-muted/20 p-2">
      <button
        type="button"
        onClick={() => void toggle()}
        className="flex w-full items-center gap-2 text-xs font-medium text-muted-foreground"
      >
        <History className="h-3.5 w-3.5" />
        Histórico de edições
        {open ? (
          <ChevronUp className="ml-auto h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="ml-auto h-3.5 w-3.5" />
        )}
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs">
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
            </div>
          )}
          {err && <div className="text-destructive">{err}</div>}
          {!loading && !err && entries && entries.length === 0 && (
            <div className="text-muted-foreground">Nenhum registro de auditoria.</div>
          )}
          {!loading &&
            entries?.map((entry) => {
              const { added, removed } = diffLines(entry.oldContent, entry.newContent);
              const isEdit = entry.action === "UPDATE";
              return (
                <div key={entry.id} className="rounded border border-border/60 bg-card p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {entry.action === "INSERT"
                        ? "Nota gerada"
                        : isEdit
                          ? "Nota editada"
                          : "Nota excluída"}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(entry.changedAt).toLocaleString("pt-BR")}
                      {entry.userEmail ? ` · ${entry.userEmail}` : ""}
                    </span>
                  </div>
                  {isEdit && (added.length > 0 || removed.length > 0) && (
                    <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
                      {removed.map((l, i) => (
                        <div key={`r${i}`} className="text-destructive">
                          − {l}
                        </div>
                      ))}
                      {added.map((l, i) => (
                        <div key={`a${i}`} className="text-emerald-600 dark:text-emerald-400">
                          + {l}
                        </div>
                      ))}
                    </pre>
                  )}
                  {isEdit && added.length === 0 && removed.length === 0 && (
                    <div className="mt-1 text-muted-foreground">
                      Alteração sem mudança no texto da nota.
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

export function NfHistoryModal({ open, onClose, clientId, clientName }: Props) {
  return <NfHistoryModalInner open={open} onClose={onClose} clientId={clientId} clientName={clientName} />;
}

function NfHistoryModalInner({ open, onClose, clientId, clientName }: Props) {
  const list = useServerFn(listNfInvoices);
  const remove = useServerFn(deleteNfInvoice);
  const update = useServerFn(updateNfInvoice);
  const [rows, setRows] = useState<NfInvoiceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

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

  useEffect(() => {
    if (!open) {
      setExpandedId(null);
      setEditingId(null);
      setDraft("");
    }
  }, [open]);

  function startEdit(row: NfInvoiceRow) {
    setEditingId(row.id);
    setExpandedId(row.id);
    setDraft(row.content);
  }

  async function saveEdit(row: NfInvoiceRow) {
    const content = draft.trim();
    if (!content) {
      toast.error("A nota não pode ficar vazia.");
      return;
    }
    setSavingId(row.id);
    try {
      const updated = await update({ data: { id: row.id, content } });
      setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
      setEditingId(null);
      toast.success("Nota atualizada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar nota.");
    } finally {
      setSavingId(null);
    }
  }

  async function handlePdf(row: NfInvoiceRow) {
    try {
      await downloadNfPdf({
        clientName,
        content: editingId === row.id ? draft : row.content,
        createdAt: row.createdAt,
        totalCents: row.totalCents,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar PDF.");
    }
  }

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
            Histórico de notas geradas no formato item a item. Use Copiar para
            enviar ao contador.
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
              const lines = row.content.split("\n");
              const preview = lines.slice(0, 4).join("\n");
              const expanded = expandedId === row.id;
              const editing = editingId === row.id;
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
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setExpandedId(expanded && !editing ? null : row.id)
                        }
                        disabled={editing}
                      >
                        {expanded ? (
                          <><ChevronUp className="mr-2 h-4 w-4" /> Recolher</>
                        ) : (
                          <><ChevronDown className="mr-2 h-4 w-4" /> Expandir</>
                        )}
                      </Button>
                      {editing ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() => saveEdit(row)}
                            disabled={savingId === row.id}
                          >
                            {savingId === row.id ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="mr-2 h-4 w-4" />
                            )}
                            Salvar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                            disabled={savingId === row.id}
                          >
                            <X className="mr-2 h-4 w-4" /> Cancelar
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => startEdit(row)}
                        >
                          <Pencil className="mr-2 h-4 w-4" /> Editar
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handlePdf(row)}
                      >
                        <Download className="mr-2 h-4 w-4" /> PDF
                      </Button>
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
                        disabled={deletingId === row.id || editing}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {editing ? (
                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      className="min-h-72 font-mono text-xs"
                    />
                  ) : (
                    <pre className="whitespace-pre-wrap rounded bg-muted/40 p-2 text-xs font-mono text-muted-foreground">
                      {expanded ? row.content : preview}
                      {!expanded && lines.length > 4 ? "\n…" : ""}
                    </pre>
                  )}
                  <NfAuditTrail invoiceId={row.id} />
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
