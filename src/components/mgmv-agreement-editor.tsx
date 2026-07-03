import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tag } from "@/components/ui-bits";
import { Trash2, Plus, RotateCcw, X, Check } from "lucide-react";
import { toast } from "sonner";
import {
  formatBRL,
  formatDateBR,
  isOverdue,
  useStore,
  type MGMVAgreement,
  type MGMVInstallment,
  type Product,
} from "@/lib/store";
import { rebalanceAgreement, addMonthsClampDay } from "@/lib/mgmv-schedule";

interface Props {
  clientId: string;
  agreement: MGMVAgreement;
  products: Product[];
  onClose: () => void;
}

function isoToDateInput(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateInputToIso(v: string): string {
  return new Date(`${v}T12:00:00`).toISOString();
}

/**
 * Editor completo do acordo MGMV. Renderiza inline no painel de detalhes da
 * seção MGMV. Preserva parcelas pagas e permite ajustar total, N, valor
 * mínimo, vencimentos, remover parcelas e remover produtos do acordo.
 */
export function MgmvAgreementEditor({ clientId, agreement, products, onClose }: Props) {
  const setMGMVAgreement = useStore((s) => s.setMGMVAgreement);
  const updateProduct = useStore((s) => s.updateProduct);

  const [draft, setDraft] = useState<MGMVAgreement>(agreement);
  const [targetN, setTargetN] = useState<number>(agreement.installments.length);
  const [minValueRaw, setMinValueRaw] = useState<string>("");
  const currentDueDay = useMemo(() => {
    const p = agreement.installments.find((i) => !i.paid);
    if (!p) return new Date().getDate();
    return new Date(p.dueDate).getDate();
  }, [agreement]);
  const [dueDay, setDueDay] = useState<number>(currentDueDay);
  const [confirmRemoveProduct, setConfirmRemoveProduct] = useState<string | null>(null);

  const paidCount = draft.installments.filter((i) => i.paid).length;
  const paidValue = draft.installments
    .filter((i) => i.paid)
    .reduce((s, i) => s + (i.paidAmount ?? i.value ?? 0), 0);
  const partialPaidAmount = draft.installments
    .filter((i) => !i.paid)
    .reduce((s, i) => s + Math.max(0, Math.min(i.value, i.paidAmount ?? 0)), 0);
  const sumInstallments = draft.installments.reduce((s, i) => s + i.value, 0);
  const remaining = Math.max(0, draft.totalDebt - paidValue - partialPaidAmount);
  const inconsistent = Math.abs(sumInstallments - draft.totalDebt) > 0.01;

  const productsRemainingTotal = products.reduce(
    (s, p) => s + Math.max(0, p.totalValue - p.paidValue),
    0,
  );
  const productsMismatch =
    products.length > 0 &&
    Math.abs(productsRemainingTotal - draft.totalDebt) > 0.01;

  const applyRebalance = () => {
    const min = Number(minValueRaw.replace(",", ".")) || undefined;
    const r = rebalanceAgreement(draft, {
      targetInstallmentsCount: targetN,
      minInstallmentValue: min,
      dueDay,
    });
    setDraft(r.agreement);
    setTargetN(r.agreement.installments.length);
    if (r.bumpedInstallments) {
      toast.info(
        `Nº de parcelas ajustado para ${r.agreement.installments.length} para respeitar o valor mínimo.`,
      );
    } else {
      toast.success("Parcelas recalculadas.");
    }
  };

  const setTotalDebt = (v: number) => {
    if (!Number.isFinite(v) || v < 0) return;
    setDraft((d) => ({ ...d, totalDebt: v }));
  };

  const setInstallmentValue = (num: number, v: number) => {
    if (!Number.isFinite(v) || v < 0) return;
    setDraft((d) => ({
      ...d,
      installments: d.installments.map((i) =>
        i.number === num ? { ...i, value: Math.round(v * 100) / 100 } : i,
      ),
    }));
  };

  const setInstallmentDate = (num: number, iso: string) => {
    setDraft((d) => ({
      ...d,
      installments: d.installments.map((i) =>
        i.number === num ? { ...i, dueDate: iso } : i,
      ),
    }));
  };

  const removeInstallment = (num: number) => {
    setDraft((d) => {
      const kept = d.installments.filter((i) => i.number !== num);
      const renum: MGMVInstallment[] = kept.map((i, idx) => ({
        ...i,
        number: idx + 1,
        total: kept.length,
      }));
      return { ...d, installments: renum };
    });
    setTargetN((n) => Math.max(1, n - 1));
  };

  const addInstallment = () => {
    setDraft((d) => {
      const pending = d.installments.filter((i) => !i.paid);
      const avg =
        pending.length > 0
          ? pending.reduce((s, i) => s + i.value, 0) / pending.length
          : d.installments[0]?.value ?? 0;
      const lastDue =
        d.installments[d.installments.length - 1]?.dueDate ??
        d.startDate ??
        new Date().toISOString();
      const nextDue = addMonthsClampDay(new Date(lastDue), 1).toISOString();
      const newTotal = d.installments.length + 1;
      const next: MGMVInstallment = {
        number: newTotal,
        total: newTotal,
        dueDate: nextDue,
        value: Math.round(avg * 100) / 100,
        paid: false,
      };
      return {
        ...d,
        installments: [...d.installments.map((i) => ({ ...i, total: newTotal })), next],
      };
    });
    setTargetN((n) => n + 1);
  };

  const removeProductFromAgreement = (productId: string) => {
    updateProduct(productId, { financialStatus: "Pendente" });
    setConfirmRemoveProduct(null);
    toast.success("Produto removido do acordo.");
  };

  const adjustTotalToProducts = () => {
    setDraft((d) => ({ ...d, totalDebt: productsRemainingTotal + paidValue + partialPaidAmount }));
    toast.success("Total do acordo ajustado aos produtos restantes.");
  };

  const save = () => {
    if (draft.totalDebt <= 0) {
      toast.error("Valor do acordo inválido.");
      return;
    }
    if (draft.installments.length === 0) {
      toast.error("O acordo precisa ter pelo menos uma parcela.");
      return;
    }
    const next: MGMVAgreement = {
      ...draft,
      reviewStatus: inconsistent
        ? "review_required"
        : draft.reviewStatus === "review_required"
          ? "manually_reviewed"
          : draft.reviewStatus,
    };
    setMGMVAgreement(clientId, next);
    if (inconsistent) {
      toast.warning("Acordo salvo com divergência — marcado como Revisão necessária.");
    } else {
      toast.success("Acordo MGMV atualizado.");
    }
    onClose();
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase text-primary">
          Editar acordo
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 hover:bg-accent"
          aria-label="Fechar editor"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <div>
          <Label className="text-[10px]">Total do acordo</Label>
          <Input
            type="number"
            step="0.01"
            className="h-8"
            value={draft.totalDebt}
            onChange={(e) => setTotalDebt(Number(e.target.value))}
          />
        </div>
        <div>
          <Label className="text-[10px]">Nº de parcelas</Label>
          <Input
            type="number"
            min={1}
            max={60}
            className="h-8"
            value={targetN}
            onChange={(e) => setTargetN(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
          />
        </div>
        <div>
          <Label className="text-[10px]">Valor mínimo (opcional)</Label>
          <Input
            className="h-8"
            placeholder="0,00"
            inputMode="decimal"
            value={minValueRaw}
            onChange={(e) => setMinValueRaw(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-[10px]">Dia de vencimento</Label>
          <Input
            type="number"
            min={1}
            max={31}
            className="h-8"
            value={dueDay}
            onChange={(e) => setDueDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
          />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">
          Saldo restante: <strong className="tabular-nums">{formatBRL(remaining)}</strong> ·
          {" "}Soma parcelas: <strong className="tabular-nums">{formatBRL(sumInstallments)}</strong>
          {inconsistent && (
            <span className="ml-2 inline-block">
              <Tag variant="warning">Divergência</Tag>
            </span>
          )}
        </div>
        <Button size="sm" variant="secondary" onClick={applyRebalance}>
          <RotateCcw className="mr-1 size-3" /> Recalcular parcelas
        </Button>
      </div>

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase text-muted-foreground">
            Parcelas ({draft.installments.length})
          </div>
          <Button size="sm" variant="ghost" onClick={addInstallment}>
            <Plus className="mr-1 size-3" /> Adicionar parcela
          </Button>
        </div>
        <div className="space-y-1">
          {draft.installments.map((i) => {
            const late = !i.paid && isOverdue(i.dueDate);
            return (
              <div
                key={i.number}
                className="flex items-center gap-2 rounded-md border border-border/60 bg-card px-2 py-1"
              >
                <span className="w-10 font-medium">
                  #{i.number}/{draft.installments.length}
                </span>
                {i.paid ? (
                  <>
                    <span className="w-24 tabular-nums">{formatBRL(i.value)}</span>
                    <span className="w-28 text-muted-foreground">
                      {formatDateBR(i.dueDate)}
                    </span>
                    <Tag variant="success">Paga</Tag>
                  </>
                ) : (
                  <>
                    <Input
                      type="number"
                      step="0.01"
                      className="h-7 w-24 tabular-nums"
                      value={i.value}
                      onChange={(e) =>
                        setInstallmentValue(i.number, Number(e.target.value))
                      }
                      aria-label={`Valor parcela ${i.number}`}
                    />
                    <Input
                      type="date"
                      className="h-7 w-36"
                      value={isoToDateInput(i.dueDate)}
                      onChange={(e) =>
                        setInstallmentDate(i.number, dateInputToIso(e.target.value))
                      }
                      aria-label={`Vencimento parcela ${i.number}`}
                    />
                    {late ? (
                      <Tag variant="danger">Vencida</Tag>
                    ) : (
                      <Tag variant="neutral">Pendente</Tag>
                    )}
                  </>
                )}
                <span className="ml-auto flex items-center gap-1">
                  {!i.paid && (
                    <button
                      type="button"
                      onClick={() => removeInstallment(i.number)}
                      className="rounded-md p-1 text-destructive hover:bg-destructive/10"
                      aria-label="Remover parcela"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {products.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase text-muted-foreground">
              Produtos incluídos ({products.length})
            </div>
            {productsMismatch && (
              <Button size="sm" variant="ghost" onClick={adjustTotalToProducts}>
                Ajustar total ({formatBRL(productsRemainingTotal + paidValue + partialPaidAmount)})
              </Button>
            )}
          </div>
          <div className="space-y-1">
            {products.map((p) => {
              const rest = Math.max(0, p.totalValue - p.paidValue);
              const isConfirming = confirmRemoveProduct === p.id;
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-md border border-border/60 bg-card px-2 py-1"
                >
                  <span className="flex-1 truncate font-medium">{p.name}</span>
                  <span className="text-muted-foreground">{p.platform}</span>
                  <span className="w-20 text-right tabular-nums">{formatBRL(rest)}</span>
                  {isConfirming ? (
                    <span className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground">Remover?</span>
                      <button
                        type="button"
                        onClick={() => removeProductFromAgreement(p.id)}
                        className="rounded-md p-1 text-destructive hover:bg-destructive/10"
                        aria-label="Confirmar remoção"
                      >
                        <Check className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveProduct(null)}
                        className="rounded-md p-1 hover:bg-accent"
                        aria-label="Cancelar"
                      >
                        <X className="size-3.5" />
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveProduct(p.id)}
                      className="rounded-md p-1 text-destructive hover:bg-destructive/10"
                      aria-label="Remover do MGMV"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button size="sm" onClick={save}>
          Salvar alterações
        </Button>
      </div>
    </div>
  );
}