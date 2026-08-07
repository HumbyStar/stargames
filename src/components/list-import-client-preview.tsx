import { useMemo, useState } from "react";
import { Brain, ChevronDown, Loader2, Pencil, Phone, Trash2, UserPlus, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL, useStore, type FinancialStatus } from "@/lib/store";
import { productStatusTextTone, productStatusTone } from "@/lib/status-tone";
import { canonicalPhone, type ListImportRow } from "@/lib/list-import-parser";

function toFinancial(s: ListImportRow["financialStatus"]): FinancialStatus {
  if (s === "Pago") return "Pago";
  if (s === "Reserva") return "Reserva";
  return "Pendente";
}

/** Entrada de tom compatível com os produtos reais da onepage. */
function toneInput(r: ListImportRow) {
  return {
    financialStatus: toFinancial(r.financialStatus),
    situation: "Em Aberto" as const,
    // Reservas novas nascem com data limite futura — nunca vencidas no preview.
    dueDate: new Date(Date.now() + 86_400_000).toISOString(),
  };
}

interface ClientBlock {
  key: string;
  clientName: string;
  phone: string;
  rows: ListImportRow[];
  totalValue: number;
  paidValue: number;
  remainingValue: number;
  existingId: string | null;
  existingName: string | null;
}

/**
 * Pré-visualização agrupada por cliente: mostra exatamente o que vai subir —
 * cada cliente com os produtos atrelados a ele — no mesmo formato das tabelas
 * de clientes da onepage.
 */
export function ListImportClientPreview({
  rows,
  aiBusyId,
  onEdit,
  onReview,
  onIgnore,
}: {
  rows: ListImportRow[];
  aiBusyId: string | null;
  onEdit: (row: ListImportRow) => void;
  onReview: (row: ListImportRow) => void;
  onIgnore: (id: string) => void;
}) {
  const findClientByPhone = useStore((s) => s.findClientByPhone);
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());

  const blocks = useMemo<ClientBlock[]>(() => {
    const map = new Map<string, ClientBlock>();
    for (const r of rows) {
      const phone = r.phone ? canonicalPhone(r.phone) : "";
      const key = phone || `nome::${r.clientName.trim().toLowerCase()}`;
      let block = map.get(key);
      if (!block) {
        const existing = r.phone ? findClientByPhone(r.phone) : undefined;
        block = {
          key,
          clientName: r.clientName || "(sem nome)",
          phone: phone || r.phone,
          rows: [],
          totalValue: 0,
          paidValue: 0,
          remainingValue: 0,
          existingId: existing?.id ?? null,
          existingName: existing?.name ?? null,
        };
        map.set(key, block);
      }
      block.rows.push(r);
      block.totalValue += r.totalValue ?? 0;
      block.paidValue += r.paidValue ?? 0;
      block.remainingValue = block.totalValue - block.paidValue;
    }
    return Array.from(map.values());
  }, [rows, findClientByPhone]);

  const newClients = blocks.filter((b) => !b.existingId).length;

  function toggle(key: string) {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (blocks.length === 0) {
    return (
      <div className="rounded-md border p-6 text-center text-xs text-muted-foreground">
        Nenhum cliente para o filtro atual.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        <span>
          <span className="font-medium text-foreground">{blocks.length}</span> cliente(s) •{" "}
          <span className="font-medium text-foreground">{rows.length}</span> produto(s)
        </span>
        <Badge variant="secondary" className="gap-1">
          <UserPlus className="h-3 w-3" /> {newClients} novo(s)
        </Badge>
        <Badge variant="outline">{blocks.length - newClients} já existente(s)</Badge>
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setOpenKeys(new Set(blocks.map((b) => b.key)))}
          >
            Expandir tudo
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setOpenKeys(new Set())}
          >
            Recolher
          </Button>
        </div>
      </div>

      <div className="max-h-[46vh] space-y-2 overflow-auto pr-1">
        {blocks.map((b) => {
          const isOpen = openKeys.has(b.key);
          return (
            <div key={b.key} className="rounded-lg border bg-card">
              <button
                type="button"
                onClick={() => toggle(b.key)}
                className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
              >
                <ChevronDown
                  className={cn("h-4 w-4 shrink-0 transition-transform", isOpen && "rotate-180")}
                />
                <span className="text-sm font-semibold">{b.clientName}</span>
                <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                  <Phone className="h-3 w-3" />
                  {b.phone || "—"}
                </span>
                {b.existingId ? (
                  <Badge variant="outline" title={`Cliente existente: ${b.existingName ?? ""}`}>
                    Já existe
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="gap-1">
                    <UserPlus className="h-3 w-3" /> Novo cliente
                  </Badge>
                )}
                {b.rows.some((r) => r.duplicateCandidate) && (
                  <Badge variant="outline">dup?</Badge>
                )}
                <span className="ml-auto flex items-center gap-3 text-xs tabular-nums">
                  <span className="text-muted-foreground">
                    {b.rows.length} produto{b.rows.length === 1 ? "" : "s"}
                  </span>
                  <span>Total {formatBRL(b.totalValue)}</span>
                  <span className="text-muted-foreground">Pago {formatBRL(b.paidValue)}</span>
                  <span
                    className={cn(
                      b.remainingValue > 0 ? "text-destructive font-medium" : "text-muted-foreground",
                    )}
                  >
                    Restante {formatBRL(b.remainingValue)}
                  </span>
                </span>
              </button>

              {isOpen && (
                <div className="overflow-x-auto border-t">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-left">
                      <tr>
                        <th className="p-2">Produto</th>
                        <th className="p-2">Plataforma</th>
                        <th className="p-2 text-right">Total</th>
                        <th className="p-2 text-right">Pago</th>
                        <th className="p-2 text-right">Restante</th>
                        <th className="p-2">Status</th>
                        <th className="p-2">Grupo</th>
                        <th className="p-2 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.rows.map((r) => {
                        const tone = toneInput(r);
                        return (
                          <tr key={r.id} className={cn("border-t", productStatusTone(tone))}>
                            <td className="p-2 font-medium">{r.productName || "—"}</td>
                            <td className="p-2">{r.platformOrCategory || "—"}</td>
                            <td className="p-2 text-right tabular-nums">
                              {r.totalValue !== null ? formatBRL(r.totalValue) : "—"}
                            </td>
                            <td className="p-2 text-right tabular-nums">
                              {r.paidValue !== null ? formatBRL(r.paidValue) : "—"}
                            </td>
                            <td className="p-2 text-right tabular-nums">
                              {r.remainingValue !== null ? formatBRL(r.remainingValue) : "—"}
                            </td>
                            <td className={cn("p-2", productStatusTextTone(tone))}>
                              {r.financialStatus}
                            </td>
                            <td className="p-2 text-muted-foreground">{r.sourceGroup}</td>
                            <td className="p-2">
                              <div className="flex justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  title="Editar"
                                  onClick={() => onEdit(r)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  title="Revisar com IA"
                                  disabled={aiBusyId === r.id}
                                  onClick={() => onReview(r)}
                                >
                                  {aiBusyId === r.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Brain className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  title="Ignorar linha"
                                  onClick={() => onIgnore(r.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}