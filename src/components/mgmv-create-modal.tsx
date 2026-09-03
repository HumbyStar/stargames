import { useEffect, useMemo, useRef, useState } from "react";
import { usePersistedState } from "@/lib/use-persisted-state";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Lock, CheckCircle2, Loader2, RotateCcw, AlertTriangle, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { usePermissions } from "@/lib/use-permissions";
import { runMgmvPreflight, preflightBlocked } from "@/lib/mgmv-preflight";
import {
  formatBRL,
  formatDateBR,
  useStore,
  type Client,
  type Product,
  type MGMVAgreement,
  type MGMVInstallment,
} from "@/lib/store";


function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function todayIsoAtDay(day: number): string {
  const t = new Date();
  const y = t.getFullYear();
  const m = t.getMonth();
  // Clamp day to month length
  const last = new Date(y, m + 1, 0).getDate();
  const d = new Date(y, m, Math.min(Math.max(1, day), last), 12, 0, 0);
  // Se o dia já passou, vai para o próximo mês.
  if (d.getTime() < t.getTime()) d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

interface Props {
  open: boolean;
  onClose: () => void;
  client: Client;
  products: Product[];
  /** Produto pré-selecionado (ex.: clique em "Criar MGMV" a partir de uma reserva). */
  preselectedProductId?: string;
}

export function MgmvCreateModal({
  open,
  onClose,
  client,
  products,
  preselectedProductId,
}: Props) {
  const createMGMVAgreementConfirmed = useStore((s) => s.createMGMVAgreementConfirmed);
  const { hasPermission } = usePermissions();


  // Draft vs. Confirmed state — once confirmed the form is locked to prevent
  // accidental edits to an agreement that has already been persisted.
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const locked = confirmed || submitting;

  // Rascunho persistido por cliente — permite retomar exatamente de onde o
  // usuário parou ao reabrir o modal (mesmo em outra sessão).
  type Draft = {
    selected: string[];
    totalRaw: string;
    entryRaw: string;
    installmentsCount: number;
    dueDay: number;
    updatedAt: string;
  };
  const draftKey = `mgmv.create.draft.${client.id}`;
  const [draft, setDraft] = usePersistedState<Draft | null>(draftKey, null);

  // Produtos elegíveis: os que ainda têm saldo (Em Aberto e não pertencem a MGMV).
  const eligible = useMemo(
    () =>
      products.filter(
        (p) => p.financialStatus !== "MGMV" && p.totalValue - p.paidValue > 0,
      ),
    [products],
  );

  const [selected, setSelected] = useState<Set<string>>(() => {
    const init = new Set<string>();
    if (draft?.selected?.length) draft.selected.forEach((id) => init.add(id));
    else if (preselectedProductId) init.add(preselectedProductId);
    else if (eligible.length === 1) init.add(eligible[0].id);
    return init;
  });

  const suggestedTotal = useMemo(
    () =>
      eligible
        .filter((p) => selected.has(p.id))
        .reduce((s, p) => s + (p.totalValue - p.paidValue), 0),
    [eligible, selected],
  );

  const [totalRaw, setTotalRaw] = useState<string>(draft?.totalRaw ?? "");
  const [entryRaw, setEntryRaw] = useState<string>(draft?.entryRaw ?? "");
  const [installmentsCount, setInstallmentsCount] = useState<number>(
    draft?.installmentsCount ?? 3,
  );
  const [dueDay, setDueDay] = useState<number>(draft?.dueDay ?? new Date().getDate());
  const draftRestored = useRef(!!draft);

  // Auto-save debounced enquanto rascunho estiver ativo.
  useEffect(() => {
    if (!open || confirmed) return;
    const t = setTimeout(() => {
      setDraft({
        selected: Array.from(selected),
        totalRaw,
        entryRaw,
        installmentsCount,
        dueDay,
        updatedAt: new Date().toISOString(),
      });
    }, 400);
    return () => clearTimeout(t);
  }, [open, confirmed, selected, totalRaw, entryRaw, installmentsCount, dueDay, setDraft]);

  const total = Number(totalRaw.replace(",", ".")) || suggestedTotal;
  const entry = Number(entryRaw.replace(",", ".")) || 0;
  const financed = Math.max(0, total - entry);
  const installmentValue =
    installmentsCount > 0 ? Math.round((financed / installmentsCount) * 100) / 100 : 0;

  const firstDueIso = useMemo(() => todayIsoAtDay(dueDay), [dueDay]);

  const schedule = useMemo<MGMVInstallment[]>(() => {
    const out: MGMVInstallment[] = [];
    for (let n = 1; n <= installmentsCount; n++) {
      out.push({
        number: n,
        total: installmentsCount,
        dueDate: addMonthsIso(firstDueIso, n - 1),
        value: installmentValue,
        paid: false,
      });
    }
    return out;
  }, [installmentsCount, installmentValue, firstDueIso]);

  const canSubmit =
    selected.size > 0 && total > 0 && installmentsCount >= 1 && installmentValue > 0;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!canSubmit || locked || submitting) return;
    setSubmitting(true);
    try {
      const agreement: MGMVAgreement = {
        startDate: new Date().toISOString(),
        totalDebt: total,
        installments: schedule,
        reviewStatus: "manually_reviewed",
      };
      // Ordem importa: primeiro os produtos entram como MGMV, depois o acordo
      // é gravado. A sincronização do acordo vincula os produtos pelo status,
      // então inverter a ordem deixava itens fora da tabela do acordo.
      for (const id of selected) {
        updateProduct(id, { financialStatus: "MGMV" });
      }
      // Só confirmamos sucesso após o banco gravar o acordo e devolver os
      // produtos vinculados — nada de "sucesso" que depois se desfaz.
      await setMGMVAgreementConfirmed(client.id, agreement);
      // Limpa o rascunho salvo — o acordo agora existe de fato.
      setDraft(null);
      toast.success(
        `Acordo MGMV criado — ${installmentsCount}x de ${formatBRL(installmentValue)}.`,
      );
      setConfirmed(true);
    } catch (err) {
      for (const id of selected) {
        const prev = products.find((p) => p.id === id);
        if (prev) updateProduct(id, { financialStatus: prev.financialStatus });
      }
      toast.error(
        `Não foi possível criar o acordo: ${err instanceof Error ? err.message : "erro desconhecido"}`,
      );
    } finally {
      setSubmitting(false);
    }
  };


  const discardDraft = () => {
    setDraft(null);
    setSelected(new Set(preselectedProductId ? [preselectedProductId] : []));
    setTotalRaw("");
    setEntryRaw("");
    setInstallmentsCount(3);
    setDueDay(new Date().getDate());
    draftRestored.current = false;
    toast.info("Rascunho descartado.");
  };

  const handleClose = () => {
    // Reset apenas do estado de confirmação — o rascunho persiste no banco
    // e será restaurado quando o modal for reaberto para o mesmo cliente.
    setConfirmed(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? handleClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Criar acordo MGMV — {client.name}
            {confirmed ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[color:var(--success)]/40 bg-[color:var(--success)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--success)]">
                <CheckCircle2 className="size-3" /> Confirmado
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Rascunho
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {confirmed
              ? "Acordo criado. Edições bloqueadas para evitar inconsistências — feche para voltar."
              : "Selecione os produtos e defina parcelas, entrada e vencimentos. Ajustes recalculam o cronograma automaticamente."}
          </DialogDescription>
          {!confirmed && draftRestored.current && draft && (
            <div className="mt-2 flex items-center justify-between rounded-md border border-warning/30 bg-warning/10 px-3 py-1.5 text-[11px] text-warning">
              <span>
                Rascunho restaurado ({new Date(draft.updatedAt).toLocaleString("pt-BR")}).
              </span>
              <button
                type="button"
                onClick={discardDraft}
                className="inline-flex items-center gap-1 rounded-full border border-warning/40 px-2 py-0.5 hover:bg-warning/20"
              >
                <RotateCcw className="size-3" /> Descartar
              </button>
            </div>
          )}
        </DialogHeader>

        <fieldset disabled={locked} className="space-y-4 disabled:opacity-70">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Produtos elegíveis ({eligible.length})
            </div>
            {eligible.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                Nenhum produto com saldo em aberto para incluir no acordo.
              </p>
            ) : (
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {eligible.map((p) => {
                  const rest = p.totalValue - p.paidValue;
                  return (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={selected.has(p.id)}
                        onCheckedChange={() => toggle(p.id)}
                        disabled={locked}
                      />
                      <span className="flex-1 truncate font-medium">{p.name}</span>
                      <span className="text-muted-foreground">{p.platform}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatBRL(p.totalValue)} — pago {formatBRL(p.paidValue)}
                      </span>
                      <span className="w-20 text-right tabular-nums font-semibold">
                        {formatBRL(rest)}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <Label className="text-xs">Valor total do acordo</Label>
              <Input
                value={totalRaw}
                onChange={(e) => setTotalRaw(e.target.value)}
                placeholder={formatBRL(suggestedTotal)}
                inputMode="decimal"
                className="h-9"
                readOnly={locked}
              />
            </div>
            <div>
              <Label className="text-xs">Entrada (opcional)</Label>
              <Input
                value={entryRaw}
                onChange={(e) => setEntryRaw(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
                className="h-9"
                readOnly={locked}
              />
            </div>
            <div>
              <Label className="text-xs">Nº de parcelas</Label>
              <Input
                type="number"
                min={1}
                max={24}
                value={installmentsCount}
                onChange={(e) => setInstallmentsCount(Math.max(1, Number(e.target.value) || 1))}
                className="h-9"
                readOnly={locked}
              />
            </div>
            <div>
              <Label className="text-xs">Dia de vencimento</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={dueDay}
                onChange={(e) => setDueDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
                className="h-9"
                readOnly={locked}
              />
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold uppercase tracking-wide text-muted-foreground">
                Cronograma (prévia)
              </span>
              <span className="tabular-nums text-muted-foreground">
                Financiado: {formatBRL(financed)} · {installmentsCount}x{" "}
                {formatBRL(installmentValue)}
              </span>
            </div>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {schedule.map((i) => {
                const now = Date.now();
                const due = new Date(i.dueDate).getTime();
                const days = Math.round((due - now) / (1000 * 60 * 60 * 24));
                const overdue = days < 0;
                const soon = !overdue && days <= 7;
                return (
                  <div
                    key={i.number}
                    className={`flex items-center justify-between rounded-md px-2 py-1 ${
                      overdue
                        ? "bg-destructive/10 border border-destructive/30"
                        : soon
                        ? "bg-warning/10 border border-warning/30"
                        : "bg-card"
                    }`}
                  >
                    <span className="font-medium">
                      #{i.number}/{i.total}
                    </span>
                    <span className="text-muted-foreground">{formatDateBR(i.dueDate)}</span>
                    <span
                      className={`text-[10px] uppercase tracking-wide ${
                        overdue
                          ? "text-destructive"
                          : soon
                          ? "text-warning"
                          : "text-muted-foreground"
                      }`}
                    >
                      {overdue
                        ? `${Math.abs(days)}d em atraso`
                        : days === 0
                        ? "vence hoje"
                        : `em ${days}d`}
                    </span>
                    <span className="tabular-nums font-medium">{formatBRL(i.value)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </fieldset>

        <DialogFooter>
          {confirmed ? (
            <>
              <span className="mr-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="size-3" /> Edição bloqueada
              </span>
              <Button onClick={handleClose}>Fechar</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={submitting}>
                Cancelar
              </Button>
              <Button disabled={!canSubmit || submitting} onClick={handleCreate}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-1 size-3.5 animate-spin" /> Criando…
                  </>
                ) : (
                  "Criar acordo MGMV"
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}