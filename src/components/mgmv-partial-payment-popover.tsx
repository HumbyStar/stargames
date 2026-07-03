import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { formatBRL } from "@/lib/store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function MgmvPartialPaymentPopover({
  clientId: _clientId,
  installmentNumber,
  installmentValue,
  currentPartial,
  agreementRemaining,
  pendingCount,
  onSubmit,
}: {
  clientId: string;
  installmentNumber: number;
  installmentValue: number;
  currentPartial: number;
  /** Saldo restante total do acordo (antes deste pagamento). */
  agreementRemaining: number;
  /** Quantidade de parcelas ainda pendentes (incluindo a atual). */
  pendingCount: number;
  onSubmit: (amount: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const trimmed = raw.trim();
  // Aceita apenas formato numérico BR/US: dígitos com uma vírgula ou ponto opcional.
  const numericPattern = /^-?\d+([.,]\d+)?$/;
  const isEmpty = trimmed.length === 0;
  const looksNumeric = !isEmpty && numericPattern.test(trimmed);
  const parsed = looksNumeric ? Number(trimmed.replace(",", ".")) : NaN;
  const notNumber = !isEmpty && (!looksNumeric || !Number.isFinite(parsed));
  const isNegative = looksNumeric && Number.isFinite(parsed) && parsed < 0;
  const isZero = looksNumeric && Number.isFinite(parsed) && parsed === 0;
  const valid = looksNumeric && Number.isFinite(parsed) && parsed > 0;
  const hasError = notNumber || isNegative || isZero;
  const errorMsg = notNumber
    ? "Valor inválido — use apenas números (ex.: 50 ou 50,00)."
    : isNegative
      ? "Valor não pode ser negativo."
      : isZero
        ? "Informe um valor maior que zero."
        : null;

  // Prévia do efeito do pagamento — para dar feedback antes do usuário confirmar.
  const preview = (() => {
    if (!valid) return null;
    if (parsed >= installmentValue) {
      const surplus = parsed - installmentValue;
      return {
        kind: "full" as const,
        message:
          surplus > 0
            ? `Parcela marcada como paga · excedente ${formatBRL(surplus)} abatido da próxima parcela.`
            : "Parcela marcada como paga integralmente.",
      };
    }
    // Pagamento parcial: o valor é absorvido no saldo do acordo e as
    // parcelas ainda pendentes são recalculadas (mesma quantidade, mesmas
    // datas). Prevê o novo valor rateado por parcela pendente.
    const nextRemaining = Math.max(0, agreementRemaining - parsed);
    const nextPerInstallment =
      pendingCount > 0 ? nextRemaining / pendingCount : 0;
    return {
      kind: "partial" as const,
      message: `Pagamento parcial de ${formatBRL(parsed)} absorvido · restante do acordo ${formatBRL(nextRemaining)} redistribuído em ${pendingCount}× ${formatBRL(nextPerInstallment)}.`,
    };
  })();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-[11px]">
          Pagamento parcial
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-2 p-3 text-xs">
        <div className="font-semibold">
          Parcela #{installmentNumber} — {formatBRL(installmentValue)}
        </div>
        {currentPartial > 0 && (
          <div className="text-muted-foreground">
            Já pago parcialmente: {formatBRL(currentPartial)}
          </div>
        )}
        <label className="block">
          <span className="mb-1 block text-muted-foreground">Valor recebido (R$)</span>
          <Input
            autoFocus
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="0,00"
            inputMode="decimal"
            className={cn(
              "h-8 text-sm",
              hasError && "border-destructive focus-visible:ring-destructive",
            )}
            aria-invalid={hasError}
            aria-describedby="partial-payment-hint"
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid) {
                e.preventDefault();
                (e.currentTarget.form?.querySelector("[data-confirm]") as HTMLButtonElement | null)?.click();
              }
            }}
          />
        </label>
        {errorMsg ? (
          <p
            id="partial-payment-hint"
            role="alert"
            className="rounded-md bg-destructive/10 px-2 py-1 leading-snug text-destructive"
          >
            {errorMsg}
          </p>
        ) : preview ? (
          <p
            id="partial-payment-hint"
            aria-live="polite"
            className={cn(
              "rounded-md px-2 py-1 leading-snug",
              preview.kind === "full"
                ? "bg-[color:var(--success)]/10 text-[color:var(--success)]"
                : "bg-warning/10 text-warning",
            )}
          >
            {preview.message}
          </p>
        ) : (
          <p className="leading-snug text-muted-foreground">
            Se maior ou igual a {formatBRL(installmentValue)}, a parcela é marcada
            como paga e o excedente vira desconto na próxima. Caso contrário,
            registra pagamento parcial.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            size="sm"
            data-confirm
            disabled={!valid}
            onClick={() => {
              onSubmit(parsed);
              const summary =
                preview?.kind === "full"
                  ? "Parcela quitada."
                  : preview?.message ?? "Pagamento registrado.";
              setRaw("");
              setOpen(false);
              toast.success(summary);
            }}
          >
            Confirmar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
