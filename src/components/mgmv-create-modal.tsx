import { useMemo, useState } from "react";
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
import { toast } from "sonner";
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
  const setMGMVAgreement = useStore((s) => s.setMGMVAgreement);
  const updateProduct = useStore((s) => s.updateProduct);

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
    if (preselectedProductId) init.add(preselectedProductId);
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

  const [totalRaw, setTotalRaw] = useState<string>("");
  const [entryRaw, setEntryRaw] = useState<string>("");
  const [installmentsCount, setInstallmentsCount] = useState<number>(3);
  const [dueDay, setDueDay] = useState<number>(new Date().getDate());

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

  const handleCreate = () => {
    if (!canSubmit) return;
    const agreement: MGMVAgreement = {
      startDate: new Date().toISOString(),
      totalDebt: total,
      installments: schedule,
      reviewStatus: "manually_reviewed",
    };
    setMGMVAgreement(client.id, agreement);
    // Marca os produtos escolhidos como MGMV para consolidação financeira.
    for (const id of selected) {
      updateProduct(id, { financialStatus: "MGMV" });
    }
    toast.success(
      `Acordo MGMV criado — ${installmentsCount}x de ${formatBRL(installmentValue)}.`,
    );
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Criar acordo MGMV — {client.name}</DialogTitle>
          <DialogDescription>
            Selecione os produtos e defina parcelas, entrada e vencimentos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
              />
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold uppercase tracking-wide text-muted-foreground">
                Cronograma
              </span>
              <span className="tabular-nums text-muted-foreground">
                Financiado: {formatBRL(financed)} · {installmentsCount}x{" "}
                {formatBRL(installmentValue)}
              </span>
            </div>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {schedule.map((i) => (
                <div
                  key={i.number}
                  className="flex items-center justify-between rounded-md bg-card px-2 py-1"
                >
                  <span>
                    #{i.number}/{i.total}
                  </span>
                  <span className="text-muted-foreground">{formatDateBR(i.dueDate)}</span>
                  <span className="tabular-nums font-medium">{formatBRL(i.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!canSubmit} onClick={handleCreate}>
            Criar acordo MGMV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}