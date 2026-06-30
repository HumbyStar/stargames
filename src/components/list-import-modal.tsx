import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertOctagon,
  Brain,
  Box,
  CheckCircle2,
  CircleAlert,
  Clock,
  CopyCheck,
  Hash,
  Layers,
  Loader2,
  Pencil,
  Phone,
  PhoneOff,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  Wallet,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ImportCard, ImportCardsGrid } from "@/components/import-cards";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatBRL, useStore, type FinancialStatus, type Situation } from "@/lib/store";
import {
  buildClientGroups,
  computeTotals,
  parseListText,
  recalcRow,
  type ListImportPreview,
  type ListImportRow,
} from "@/lib/list-import-parser";
import { reviewListImportLine } from "@/lib/list-import-ai.functions";

type FilterKey =
  | "all"
  | "paid"
  | "reserva"
  | "open"
  | "validPhones"
  | "invalidPhones"
  | "duplicates"
  | "review"
  | "errors";

const SAMPLE = `Grupo 1:
Breno Yano - 11 91194-7693 - Fire Emblem - Super Original - 60 reais - RESERVA (30)
Zeca - 11 97728-4310 - Final Fantasy VI - Super Original - 80 reais - PAGO

Grupo Action Figures:
Guilherme - 31 9943-0297 - Batman - Pop Alternativo - 60 reais - PAGO
Ailton Sobrinho Jr - 16 99771-9038 - Spiderman - Pop Alternativo - 60 reais - RESERVA (30)`;

function statusToFinancial(s: ListImportRow["financialStatus"]): FinancialStatus {
  if (s === "Pago") return "Pago";
  if (s === "Reserva") return "Reserva";
  if (s === "Pendente") return "Pendente";
  return "Pendente";
}

function statusToSituation(s: ListImportRow["financialStatus"]): Situation {
  // Pago => pronto para envio | Reserva => Em Aberto | Pendente => Em Aberto
  return s === "Pago" ? "Em Aberto" : "Em Aberto";
}

export function ListImportModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [rawText, setRawText] = useState("");
  const [preview, setPreview] = useState<ListImportPreview | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [filterGroup, setFilterGroup] = useState<string | null>(null);
  const [editing, setEditing] = useState<ListImportRow | null>(null);
  const [aiBusyId, setAiBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reviewFn = useServerFn(reviewListImportLine);
  const addClient = useStore((s) => s.addClient);
  const addProduct = useStore((s) => s.addProduct);
  const findClientByPhone = useStore((s) => s.findClientByPhone);
  const addImportHistory = useStore((s) => s.addImportHistory);

  function close() {
    setRawText("");
    setPreview(null);
    setFilter("all");
    setFilterGroup(null);
    setEditing(null);
    setAiBusyId(null);
    onOpenChange(false);
  }

  function analyze() {
    if (!rawText.trim()) {
      toast.error("Cole uma lista para iniciar a análise.");
      return;
    }
    const out = parseListText(rawText);
    if (out.rows.length === 0) {
      toast.error("Nenhuma linha válida encontrada. Revise o formato da lista.");
    } else {
      toast.success(`${out.rows.length} linha(s) analisada(s) em ${out.groups.length} grupo(s).`);
    }
    setPreview(out);
    setFilter("all");
    setFilterGroup(null);
  }

  const filteredRows = useMemo(() => {
    if (!preview) return [] as ListImportRow[];
    const base = preview.rows.filter((r) => !r.ignored);
    const byGroup = filterGroup ? base.filter((r) => r.sourceGroup === filterGroup) : base;
    switch (filter) {
      case "paid":
        return byGroup.filter((r) => r.financialStatus === "Pago");
      case "reserva":
        return byGroup.filter((r) => r.financialStatus === "Reserva");
      case "open":
        return byGroup.filter((r) => (r.remainingValue ?? 0) > 0);
      case "validPhones":
        return byGroup.filter((r) => r.phoneValid);
      case "invalidPhones":
        return byGroup.filter((r) => !r.phoneValid);
      case "duplicates":
        return byGroup.filter((r) => r.duplicateCandidate);
      case "review":
        return byGroup.filter((r) => r.reviewStatus === "review_required");
      case "errors":
        return byGroup.filter((r) => r.reviewStatus === "error");
      default:
        return byGroup;
    }
  }, [preview, filter, filterGroup]);

  function updateRow(id: string, patch: Partial<ListImportRow>) {
    setPreview((prev) => {
      if (!prev) return prev;
      const rows = prev.rows.map((r) => (r.id === id ? recalcRow({ ...r, ...patch }) : r));
      const clients = buildClientGroups(rows);
      return { rows, groups: prev.groups, clients, totals: computeTotals(rows, clients) };
    });
  }

  function ignoreRow(id: string) {
    setPreview((prev) => {
      if (!prev) return prev;
      const rows = prev.rows.map((r) => (r.id === id ? { ...r, ignored: true } : r));
      const clients = buildClientGroups(rows.filter((r) => !r.ignored));
      return { rows, groups: prev.groups, clients, totals: computeTotals(rows, clients) };
    });
  }

  async function reviewWithAI(row: ListImportRow) {
    setAiBusyId(row.id);
    try {
      const result = await reviewFn({
        data: {
          rawLine: row.rawLine,
          sourceGroup: row.sourceGroup,
          warnings: row.warnings,
        },
      });
      updateRow(row.id, {
        clientName: result.clientName ?? row.clientName,
        phone: result.phone ?? row.phone,
        productName: result.productName ?? row.productName,
        platformOrCategory: result.platformOrCategory ?? row.platformOrCategory,
        totalValue: result.totalValue ?? row.totalValue,
        paidValue: result.paidValue ?? row.paidValue,
        financialStatus: result.financialStatus ?? row.financialStatus,
      });
      toast.success(`IA sugeriu correção (confiança ${(result.confidence * 100).toFixed(0)}%).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao revisar com IA.");
    } finally {
      setAiBusyId(null);
    }
  }

  async function persist(rowsToSave: ListImportRow[]) {
    if (!rowsToSave.length) {
      toast.error("Nenhum registro para salvar.");
      return;
    }
    setSaving(true);
    try {
      let clientsCreated = 0;
      let productsCreated = 0;
      const cache = new Map<string, string>();
      for (const r of rowsToSave) {
        if (!r.clientName || !r.phone) continue;
        let clientId = cache.get(r.phone);
        if (!clientId) {
          const existing = findClientByPhone(r.phone);
          if (existing) {
            clientId = existing.id;
          } else {
            const created = addClient({
              name: r.clientName,
              phone: r.phone,
              notes: r.sourceGroup ? `Origem: ${r.sourceGroup} (lista colada)` : undefined,
              clientType: "common",
            });
            clientId = created.id;
            clientsCreated++;
          }
          cache.set(r.phone, clientId);
        }
        const now = new Date().toISOString();
        addProduct({
          clientId,
          name: r.productName || "(sem nome)",
          platform: r.platformOrCategory || "(sem plataforma)",
          totalValue: r.totalValue ?? 0,
          paidValue: r.paidValue ?? 0,
          financialStatus: statusToFinancial(r.financialStatus),
          situation: statusToSituation(r.financialStatus),
          registerDate: now,
          dueDate: now,
          notes: `Importado por lista colada • Grupo: ${r.sourceGroup}`,
        });
        productsCreated++;
      }
      addImportHistory({
        source: "Texto",
        file: `Lista colada (${preview?.groups.length ?? 0} grupos)`,
        clientsCreated,
        productsAdded: productsCreated,
        errors: preview?.totals.errorRows ?? 0,
        status: (preview?.totals.errorRows ?? 0) > 0 ? "Com avisos" : "Concluído",
      });
      toast.success(`${clientsCreated} cliente(s) e ${productsCreated} produto(s) salvos.`);
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  function saveValidOnly() {
    if (!preview) return;
    void persist(preview.rows.filter((r) => !r.ignored && r.reviewStatus === "ok"));
  }
  function saveReviewed() {
    if (!preview) return;
    void persist(preview.rows.filter((r) => !r.ignored && r.reviewStatus !== "error"));
  }
  function saveAllWithConfirm() {
    if (!preview) return;
    const totalIssues =
      preview.totals.errorRows + preview.totals.reviewRows + preview.totals.invalidPhones;
    if (totalIssues > 0) {
      const ok = window.confirm(
        `Existem ${totalIssues} registro(s) com aviso. Deseja salvar mesmo assim?`,
      );
      if (!ok) return;
    }
    void persist(preview.rows.filter((r) => !r.ignored));
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
 <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar lista de grupos</DialogTitle>
          <DialogDescription>
            Cole a lista de vendas/reservas para revisar antes de salvar. Nada é gravado antes da
            confirmação.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label htmlFor="list-text">Lista de grupos</Label>
          <Textarea
            id="list-text"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={SAMPLE}
            className="min-h-44 font-mono text-xs"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              Formato: <code>Nome - Telefone - Produto - Plataforma - Valor - Status</code>
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setRawText(SAMPLE)}>
                Usar exemplo
              </Button>
              <Button size="sm" onClick={analyze}>
                Analisar lista
              </Button>
            </div>
          </div>
        </div>

        {preview && (
          <div className="space-y-4">
            <ImportCardsGrid>
              <ImportCard
                icon={Layers}
                title="Grupos detectados"
                value={preview.groups.length}
                tone="info"
              />
              <ImportCard
                icon={Hash}
                title="Linhas analisadas"
                value={preview.totals.lines}
                tone="neutral"
                onClick={() => {
                  setFilter("all");
                  setFilterGroup(null);
                }}
              />
              <ImportCard
                icon={Users}
                title="Clientes únicos"
                value={preview.totals.uniqueClients}
                tone="common"
              />
              <ImportCard
                icon={Box}
                title="Produtos capturados"
                value={preview.totals.products}
                tone="common"
                onClick={() => setFilter("all")}
              />
              <ImportCard
                icon={CheckCircle2}
                title="Pagos"
                value={preview.totals.paidRows}
                tone="success"
                onClick={() => setFilter("paid")}
              />
              <ImportCard
                icon={Clock}
                title="Reservas"
                value={preview.totals.reservaRows}
                tone="warning"
                onClick={() => setFilter("reserva")}
              />
              <ImportCard
                icon={Wallet}
                title="Valor total"
                value={preview.totals.totalValue}
                tone="info"
                format={formatBRL}
              />
              <ImportCard
                icon={ShieldCheck}
                title="Valor pago"
                value={preview.totals.paidValue}
                tone="success"
                format={formatBRL}
              />
              <ImportCard
                icon={Wallet}
                title="Valor em aberto"
                value={preview.totals.openValue}
                tone="warning"
                format={formatBRL}
                onClick={() => setFilter("open")}
              />
              <ImportCard
                icon={Phone}
                title="Telefones válidos"
                value={preview.totals.validPhones}
                tone="success"
                onClick={() => setFilter("validPhones")}
              />
              <ImportCard
                icon={PhoneOff}
                title="Telefones com erro"
                value={preview.totals.invalidPhones}
                tone="danger"
                onClick={() => setFilter("invalidPhones")}
              />
              <ImportCard
                icon={CopyCheck}
                title="Duplicatas possíveis"
                value={preview.totals.duplicateCandidates}
                tone="warning"
                onClick={() => setFilter("duplicates")}
              />
              <ImportCard
                icon={CircleAlert}
                title="Revisão necessária"
                value={preview.totals.reviewRows}
                tone="warning"
                onClick={() => setFilter("review")}
              />
              <ImportCard
                icon={AlertOctagon}
                title="Erros de leitura"
                value={preview.totals.errorRows}
                tone="danger"
                onClick={() => setFilter("errors")}
              />
            </ImportCardsGrid>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Filtros ativos:</span>
              <Badge variant="secondary">{labelForFilter(filter)}</Badge>
              <Select
                value={filterGroup ?? "__all__"}
                onValueChange={(v) => setFilterGroup(v === "__all__" ? null : v)}
              >
                <SelectTrigger className="h-7 w-56 text-xs">
                  <SelectValue placeholder="Todos os grupos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos os grupos</SelectItem>
                  {preview.groups.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {filter !== "all" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setFilter("all")}
                >
                  Limpar filtro
                </Button>
              )}
            </div>

            <div className="max-h-[40vh] overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/40">
                  <tr className="text-left">
                    <th className="p-2">Grupo</th>
                    <th className="p-2">Cliente</th>
                    <th className="p-2">Telefone</th>
                    <th className="p-2">Produto</th>
                    <th className="p-2">Plataforma</th>
                    <th className="p-2 text-right">Total</th>
                    <th className="p-2 text-right">Pago</th>
                    <th className="p-2 text-right">Restante</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Conf.</th>
                    <th className="p-2">Avisos</th>
                    <th className="p-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={12} className="p-4 text-center text-muted-foreground">
                        Nenhuma linha para o filtro atual.
                      </td>
                    </tr>
                  )}
                  {filteredRows.map((r) => (
                    <tr key={r.id} className={cn("border-t", r.reviewStatus === "error" && "bg-destructive/5")}>
                      <td className="p-2 align-top">{r.sourceGroup}</td>
                      <td className="p-2 align-top font-medium">{r.clientName || "—"}</td>
                      <td className={cn("p-2 align-top font-mono", !r.phoneValid && "text-destructive")}>
                        {r.phone || "—"}
                      </td>
                      <td className="p-2 align-top">{r.productName || "—"}</td>
                      <td className="p-2 align-top">{r.platformOrCategory || "—"}</td>
                      <td className="p-2 align-top text-right tabular-nums">
                        {r.totalValue !== null ? formatBRL(r.totalValue) : "—"}
                      </td>
                      <td className="p-2 align-top text-right tabular-nums">
                        {r.paidValue !== null ? formatBRL(r.paidValue) : "—"}
                      </td>
                      <td className="p-2 align-top text-right tabular-nums">
                        {r.remainingValue !== null ? formatBRL(r.remainingValue) : "—"}
                      </td>
                      <td className="p-2 align-top">
                        <Badge variant={statusBadgeVariant(r.financialStatus)}>{r.financialStatus}</Badge>
                        {r.duplicateCandidate && (
                          <Badge variant="outline" className="ml-1">dup?</Badge>
                        )}
                      </td>
                      <td className="p-2 align-top tabular-nums">
                        {(r.confidence * 100).toFixed(0)}%
                      </td>
                      <td className="p-2 align-top max-w-[12rem]">
                        {r.warnings.length ? (
                          <ul className="list-disc pl-4 text-[11px] text-muted-foreground">
                            {r.warnings.slice(0, 3).map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-2 align-top">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Editar"
                            onClick={() => setEditing(r)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Revisar com IA"
                            disabled={aiBusyId === r.id}
                            onClick={() => void reviewWithAI(r)}
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
                            onClick={() => ignoreRow(r.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.totals.errorRows + preview.totals.reviewRows > 0 && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700">
                <Sparkles className="mr-1 inline h-3 w-3" />
                Algumas linhas precisam de revisão antes de salvar.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancelar
          </Button>
          {preview && (
            <>
              <Button variant="outline" onClick={saveValidOnly} disabled={saving}>
                Salvar somente válidos
              </Button>
              <Button variant="outline" onClick={saveReviewed} disabled={saving}>
                Salvar tudo revisado
              </Button>
              <Button onClick={saveAllWithConfirm} disabled={saving}>
                {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                Salvar todos com confirmação
              </Button>
            </>
          )}
        </DialogFooter>

        {editing && (
          <EditRowDialog
            row={editing}
            onClose={() => setEditing(null)}
            onSave={(patch) => {
              updateRow(editing.id, patch);
              setEditing(null);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function labelForFilter(f: FilterKey): string {
  const map: Record<FilterKey, string> = {
    all: "Todos",
    paid: "Pagos",
    reserva: "Reservas",
    open: "Valor em aberto",
    validPhones: "Telefones válidos",
    invalidPhones: "Telefones com erro",
    duplicates: "Duplicatas possíveis",
    review: "Revisão necessária",
    errors: "Erros de leitura",
  };
  return map[f];
}

function statusBadgeVariant(s: ListImportRow["financialStatus"]): React.ComponentProps<typeof Badge>["variant"] {
  if (s === "Pago") return "default";
  if (s === "Reserva") return "secondary";
  if (s === "Revisão necessária") return "destructive";
  return "outline";
}

function EditRowDialog({
  row,
  onClose,
  onSave,
}: {
  row: ListImportRow;
  onClose: () => void;
  onSave: (patch: Partial<ListImportRow>) => void;
}) {
  const [draft, setDraft] = useState({
    clientName: row.clientName,
    phone: row.phone,
    productName: row.productName,
    platformOrCategory: row.platformOrCategory,
    totalValue: row.totalValue ?? 0,
    paidValue: row.paidValue ?? 0,
    financialStatus: row.financialStatus,
    sourceGroup: row.sourceGroup,
  });
  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : null)}>
 <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar linha</DialogTitle>
          <DialogDescription>Linha {row.lineNumber} • {row.sourceGroup}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cliente" full>
            <Input value={draft.clientName} onChange={(e) => setDraft({ ...draft, clientName: e.target.value })} />
          </Field>
          <Field label="Telefone">
            <Input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value.replace(/\D+/g, "") })} />
          </Field>
          <Field label="Grupo">
            <Input value={draft.sourceGroup} onChange={(e) => setDraft({ ...draft, sourceGroup: e.target.value })} />
          </Field>
          <Field label="Produto" full>
            <Input value={draft.productName} onChange={(e) => setDraft({ ...draft, productName: e.target.value })} />
          </Field>
          <Field label="Plataforma/Categoria" full>
            <Input
              value={draft.platformOrCategory}
              onChange={(e) => setDraft({ ...draft, platformOrCategory: e.target.value })}
            />
          </Field>
          <Field label="Valor total">
            <Input
              type="number"
              value={draft.totalValue}
              onChange={(e) => setDraft({ ...draft, totalValue: Number(e.target.value) })}
            />
          </Field>
          <Field label="Valor pago">
            <Input
              type="number"
              value={draft.paidValue}
              onChange={(e) => setDraft({ ...draft, paidValue: Number(e.target.value) })}
            />
          </Field>
          <Field label="Status" full>
            <Select
              value={draft.financialStatus}
              onValueChange={(v) => setDraft({ ...draft, financialStatus: v as ListImportRow["financialStatus"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["Pago", "Reserva", "Pendente", "Revisão necessária"] as const).map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            <X className="mr-1 h-4 w-4" /> Cancelar
          </Button>
          <Button
            onClick={() =>
              onSave({
                clientName: draft.clientName.trim(),
                phone: draft.phone,
                productName: draft.productName.trim(),
                platformOrCategory: draft.platformOrCategory.trim(),
                totalValue: draft.totalValue,
                paidValue: draft.paidValue,
                financialStatus: draft.financialStatus,
                sourceGroup: draft.sourceGroup,
              })
            }
          >
            <CheckCircle2 className="mr-1 h-4 w-4" /> Salvar correção
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={cn("space-y-1", full && "col-span-2")}>
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}