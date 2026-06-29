import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useServerFn } from "@tanstack/react-start";
import {
  reviewMgmvNotes,
  type MgmvAiReviewSuggestion,
} from "@/lib/mgmv-ai-review.functions";
import {
  formatBRL,
  type Client,
  type MGMVAgreement,
  type Product,
} from "@/lib/store";

interface Props {
  open: boolean;
  onClose: () => void;
  client: Client;
  agreement: MGMVAgreement;
  products: Product[];
  onApply: (
    suggestion: MgmvAiReviewSuggestion,
    meta: { mathOk: boolean; confirmedWithConflict: boolean },
  ) => void;
}

interface MathCheck {
  ok: boolean;
  messages: string[];
}

function validateMath(s: MgmvAiReviewSuggestion): MathCheck {
  const msgs: string[] = [];
  const eps = 0.01;
  const {
    totalAgreementValue: T,
    installmentsCount: N,
    installmentValue: V,
    paidInstallments: P,
    paidValue: PV,
    remainingValue: R,
    pendingInstallments: PE,
  } = s;

  if (N != null && V != null && T != null) {
    if (Math.abs(N * V - T) > eps)
      msgs.push(`Parcelas × valor (${formatBRL(N * V)}) ≠ total (${formatBRL(T)}).`);
  }
  if (P != null && V != null && PV != null) {
    if (Math.abs(P * V - PV) > eps)
      msgs.push(
        `Parcelas pagas × valor (${formatBRL(P * V)}) ≠ valor pago (${formatBRL(PV)}).`,
      );
  }
  if (T != null && PV != null && R != null) {
    if (Math.abs(T - PV - R) > eps)
      msgs.push(`Total − pago (${formatBRL(T - PV)}) ≠ saldo (${formatBRL(R)}).`);
  }
  if (N != null && P != null && PE != null) {
    if (N - P !== PE)
      msgs.push(`Parcelas − pagas (${N - P}) ≠ pendentes (${PE}).`);
  }
  return { ok: msgs.length === 0, messages: msgs };
}

function ParserSummary({ agreement }: { agreement: MGMVAgreement }) {
  const total = agreement.installments.length;
  const paid = agreement.installments.filter((i) => i.paid).length;
  const paidValue = agreement.installments
    .filter((i) => i.paid)
    .reduce((s, i) => s + (i.value || 0), 0);
  const remaining = Math.max(0, (agreement.totalDebt || 0) - paidValue);
  const v = agreement.installments[0]?.value ?? 0;
  return (
    <dl className="grid grid-cols-2 gap-2 text-xs">
      <dt className="text-muted-foreground">Valor total</dt>
      <dd className="font-medium">{formatBRL(agreement.totalDebt)}</dd>
      <dt className="text-muted-foreground">Parcelas</dt>
      <dd className="font-medium">
        {total}× {formatBRL(v)}
      </dd>
      <dt className="text-muted-foreground">Pagas</dt>
      <dd className="font-medium">
        {paid}/{total}
      </dd>
      <dt className="text-muted-foreground">Saldo</dt>
      <dd className="font-medium">{formatBRL(remaining)}</dd>
    </dl>
  );
}

function SuggestionSummary({ s }: { s: MgmvAiReviewSuggestion }) {
  const fmt = (v: number | null) => (v == null ? "—" : formatBRL(v));
  return (
    <dl className="grid grid-cols-2 gap-2 text-xs">
      <dt className="text-muted-foreground">Valor total</dt>
      <dd className="font-medium">{fmt(s.totalAgreementValue)}</dd>
      <dt className="text-muted-foreground">Parcelas</dt>
      <dd className="font-medium">
        {s.installmentsCount ?? "—"}× {fmt(s.installmentValue)}
      </dd>
      <dt className="text-muted-foreground">Pagas</dt>
      <dd className="font-medium">
        {s.paidInstallments ?? "—"}/{s.installmentsCount ?? "—"}
      </dd>
      <dt className="text-muted-foreground">Valor pago</dt>
      <dd className="font-medium">{fmt(s.paidValue)}</dd>
      <dt className="text-muted-foreground">Saldo</dt>
      <dd className="font-medium">{fmt(s.remainingValue)}</dd>
      <dt className="text-muted-foreground">Pendentes</dt>
      <dd className="font-medium">{s.pendingInstallments ?? "—"}</dd>
      <dt className="text-muted-foreground">Status sugerido</dt>
      <dd className="font-medium">{s.statusSuggestion ?? "—"}</dd>
      <dt className="text-muted-foreground">Confiança</dt>
      <dd className="font-medium">{Math.round(s.confidence * 100)}%</dd>
    </dl>
  );
}

export function MgmvAiReviewModal({
  open,
  onClose,
  client,
  agreement,
  products,
  onApply,
}: Props) {
  const call = useServerFn(reviewMgmvNotes);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<MgmvAiReviewSuggestion | null>(null);
  const [confirmConflict, setConfirmConflict] = useState(false);

  const paidValueNow = agreement.installments
    .filter((i) => i.paid)
    .reduce((s, i) => s + (i.value || 0), 0);

  const payload = useMemo(
    () => ({
      clientName: client.name,
      clientPhone: client.phone,
      originalNotes: client.notes ?? "",
      products: products.map((p) => ({
        name: p.name,
        platform: p.platform,
        totalValue: p.totalValue,
        paidValue: p.paidValue,
        remainingValue: Math.max(0, p.totalValue - p.paidValue),
        status: p.financialStatus,
      })),
      ruleParserResult: {
        totalAgreementValue: agreement.totalDebt,
        installmentsCount: agreement.installments.length,
        installmentValue: agreement.installments[0]?.value ?? 0,
        paidInstallments: agreement.installments.filter((i) => i.paid).length,
        remainingValue: Math.max(0, (agreement.totalDebt || 0) - paidValueNow),
      },
    }),
    [client, products, agreement, paidValueNow],
  );

  useEffect(() => {
    if (!open) {
      setSuggestion(null);
      setError(null);
      setLoading(false);
      setConfirmConflict(false);
    }
  }, [open]);

  async function runReview() {
    setLoading(true);
    setError(null);
    setSuggestion(null);
    setConfirmConflict(false);
    try {
      const result = await call({ data: payload });
      setSuggestion(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao consultar a IA.");
    } finally {
      setLoading(false);
    }
  }

  const mathCheck = suggestion ? validateMath(suggestion) : null;
  const canApply =
    !!suggestion &&
    suggestion.isMGMV &&
    !!suggestion.installmentsCount &&
    !!suggestion.installmentValue &&
    suggestion.paidInstallments != null &&
    (mathCheck?.ok || confirmConflict);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Revisão assistida por IA</DialogTitle>
          <DialogDescription>
            A IA sugere uma interpretação. O sistema valida e você confirma antes
            de aplicar.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-3">
          <section className="rounded-md border border-border bg-card p-3">
            <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Observação original
            </h4>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[11px] text-foreground/80">
              {client.notes?.trim() || "(vazio)"}
            </pre>
          </section>

          <section className="rounded-md border border-border bg-card p-3">
            <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Parser atual
            </h4>
            <ParserSummary agreement={agreement} />
          </section>

          <section className="rounded-md border border-border bg-card p-3">
            <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
              Sugestão da IA
            </h4>
            {!suggestion && !loading && !error && (
              <p className="text-xs text-muted-foreground">
                Clique em “Consultar IA” para gerar uma sugestão.
              </p>
            )}
            {loading && (
              <p className="text-xs text-muted-foreground">Consultando IA…</p>
            )}
            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
            {suggestion && <SuggestionSummary s={suggestion} />}
          </section>
        </div>

        {suggestion && (
          <div className="space-y-2 rounded-md border border-border bg-card p-3 text-xs">
            {suggestion.warnings.length > 0 && (
              <div>
                <p className="font-semibold text-warning">Avisos da IA</p>
                <ul className="ml-4 list-disc text-muted-foreground">
                  {suggestion.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            {suggestion.extractedEvidence.length > 0 && (
              <div>
                <p className="font-semibold">Evidências</p>
                <ul className="ml-4 list-disc text-muted-foreground">
                  {suggestion.extractedEvidence.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            {mathCheck && !mathCheck.ok && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2">
                <p className="font-semibold text-destructive">
                  A sugestão da IA possui divergência matemática. Revise antes de
                  aplicar.
                </p>
                <ul className="ml-4 list-disc text-destructive/80">
                  {mathCheck.messages.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
                <label className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={confirmConflict}
                    onChange={(e) => setConfirmConflict(e.target.checked)}
                  />
                  <span>
                    Confirmo manualmente a aplicação mesmo com divergência.
                  </span>
                </label>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
          {!suggestion && (
            <Button onClick={runReview} disabled={loading}>
              {loading ? "Consultando…" : "Consultar IA"}
            </Button>
          )}
          {suggestion && (
            <>
              <Button variant="outline" onClick={runReview} disabled={loading}>
                Refazer
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSuggestion(null);
                  setConfirmConflict(false);
                }}
              >
                Ignorar sugestão
              </Button>
              <Button
                onClick={() => {
                  if (!suggestion) return;
                  onApply(suggestion, {
                    mathOk: !!mathCheck?.ok,
                    confirmedWithConflict: !mathCheck?.ok && confirmConflict,
                  });
                  onClose();
                }}
                disabled={!canApply}
              >
                Aplicar sugestão
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}