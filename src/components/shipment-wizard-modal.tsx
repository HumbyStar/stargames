import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Package, Truck, User, CheckCircle2 } from "lucide-react";
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
import { Tag } from "@/components/ui-bits";
import { cn } from "@/lib/utils";
import { formatBRL, useStore, type Client, type Product } from "@/lib/store";
import { fichaFromTextWithDefaults } from "@/lib/ficha-parse";
import {
  combineParcels,
  cubicWeightKg,
  formatCents,
  quoteShipping,
  type ShippingQuote,
} from "@/lib/shipping-quotes";
import { createShipment, type ShipmentRecipient } from "@/lib/shipments.functions";

type Measures = { weightKg: string; lengthCm: string; widthCm: string; heightCm: string };

const DEFAULT_MEASURES: Measures = { weightKg: "0.5", lengthCm: "20", widthCm: "15", heightCm: "10" };

const STEPS = [
  { id: 1, label: "Produtos", icon: Package },
  { id: 2, label: "Dados de envio", icon: User },
  { id: 3, label: "Transportadora", icon: Truck },
  { id: 4, label: "Revisão", icon: CheckCircle2 },
] as const;

function emptyRecipient(): ShipmentRecipient {
  return {
    fullName: "",
    cpfCnpj: "",
    phone: "",
    email: "",
    cep: "",
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
  };
}

/**
 * Assistente de envio (4 etapas) — front-end apenas.
 *
 * As cotações são fictícias (`shipping-quotes.ts`), sem integração com a API
 * do SuperFrete. Ao confirmar, os produtos escolhidos passam para a situação
 * "Enviado" e o envio é gravado no histórico.
 */
export function ShipmentWizardModal({
  client,
  products,
  open,
  onClose,
}: {
  client: Client;
  products: Product[];
  open: boolean;
  onClose: () => void;
}) {
  const setProductSituation = useStore((s) => s.setProductSituation);
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(products.map((p) => p.id)));
  const [measures, setMeasures] = useState<Record<string, Measures>>({});
  const [recipient, setRecipient] = useState<ShipmentRecipient>(emptyRecipient);
  const [quoteId, setQuoteId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Preenche a ficha do cliente ao abrir (edição manual continua liberada).
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSaving(false);
    setQuoteId("");
    setNotes("");
    setSelected(new Set(products.map((p) => p.id)));
    setMeasures(Object.fromEntries(products.map((p) => [p.id, { ...DEFAULT_MEASURES }])));
    const f = fichaFromTextWithDefaults(client.customerData, { phone: client.phone });
    setRecipient({
      ...emptyRecipient(),
      fullName: f.fullName ?? client.name,
      cpfCnpj: f.cpfCnpj ?? "",
      phone: f.phone ?? client.phone ?? "",
      email: f.email ?? "",
      cep: f.cep ?? "",
      street: f.street ?? "",
      number: f.number ?? "",
      complement: f.complement ?? "",
      neighborhood: f.neighborhood ?? "",
      city: f.city ?? "",
      state: f.state ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client.id]);

  const chosen = useMemo(
    () => products.filter((p) => selected.has(p.id)),
    [products, selected],
  );

  const parcel = useMemo(
    () =>
      combineParcels(
        chosen.map((p) => {
          const m = measures[p.id] ?? DEFAULT_MEASURES;
          return {
            weightKg: Number(m.weightKg.replace(",", ".")),
            lengthCm: Number(m.lengthCm.replace(",", ".")),
            widthCm: Number(m.widthCm.replace(",", ".")),
            heightCm: Number(m.heightCm.replace(",", ".")),
          };
        }),
      ),
    [chosen, measures],
  );

  const quotes: ShippingQuote[] = useMemo(() => quoteShipping(parcel), [parcel]);
  const quote = quotes.find((q) => q.id === quoteId) ?? null;
  const totalValue = chosen.reduce((acc, p) => acc + p.totalValue, 0);

  const addressReady =
    recipient.fullName.trim() !== "" &&
    recipient.cep.trim() !== "" &&
    recipient.street.trim() !== "" &&
    recipient.city.trim() !== "" &&
    recipient.state.trim() !== "";

  const canNext =
    (step === 1 && chosen.length > 0) ||
    (step === 2 && addressReady) ||
    (step === 3 && !!quote) ||
    step === 4;

  const setMeasure = (id: string, key: keyof Measures, value: string) =>
    setMeasures((m) => ({ ...m, [id]: { ...(m[id] ?? DEFAULT_MEASURES), [key]: value } }));

  const confirm = async () => {
    if (!quote || chosen.length === 0 || saving) return;
    setSaving(true);
    try {
      await createShipment({
        data: {
          clientId: client.id,
          clientName: client.name,
          carrier: quote.carrier,
          service: quote.service,
          etaDays: quote.etaDays,
          priceCents: quote.priceCents,
          totalWeightKg: Number(parcel.weightKg.toFixed(3)),
          items: chosen.map((p) => {
            const m = measures[p.id] ?? DEFAULT_MEASURES;
            return {
              productId: p.id,
              name: p.name,
              platform: p.platform ?? "",
              value: p.totalValue,
              weightKg: Number(m.weightKg.replace(",", ".")) || 0,
              lengthCm: Number(m.lengthCm.replace(",", ".")) || 0,
              widthCm: Number(m.widthCm.replace(",", ".")) || 0,
              heightCm: Number(m.heightCm.replace(",", ".")) || 0,
            };
          }),
          recipient,
          notes: notes.trim() || null,
        },
      });
      chosen.forEach((p) => setProductSituation(p.id, "Enviado"));
      toast.success(
        `Envio registrado: ${chosen.length} item(ns) por ${quote.carrier} ${quote.service}.`,
      );
      onClose();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível registrar o envio.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v && !saving ? onClose() : undefined)}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enviar — {client.name}</DialogTitle>
          <DialogDescription>
            Cotações simuladas para conferência interna (sem integração com a API do SuperFrete).
          </DialogDescription>
        </DialogHeader>

        <ol className="flex flex-wrap items-center gap-2 text-xs">
          {STEPS.map((s) => {
            const Icon = s.icon;
            const active = s.id === step;
            const done = s.id < step;
            return (
              <li
                key={s.id}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1",
                  active && "border-primary bg-primary/10 text-primary",
                  done && !active && "border-border text-muted-foreground",
                  !active && !done && "border-border text-muted-foreground/70",
                )}
              >
                <Icon className="size-3.5" /> {s.id}. {s.label}
              </li>
            );
          })}
        </ol>

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Selecione os produtos e informe peso e medidas de cada um.
            </p>
            <div className="space-y-2">
              {products.map((p) => {
                const m = measures[p.id] ?? DEFAULT_MEASURES;
                const checked = selected.has(p.id);
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "rounded-lg border p-3",
                      checked ? "border-primary/40 bg-primary/5" : "border-border",
                    )}
                  >
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={checked}
                        onChange={() =>
                          setSelected((s) => {
                            const next = new Set(s);
                            if (next.has(p.id)) next.delete(p.id);
                            else next.add(p.id);
                            return next;
                          })
                        }
                      />
                      <span className="flex-1">
                        <span className="block text-sm font-medium">{p.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {p.platform || "Sem plataforma"} · {formatBRL(p.totalValue)}
                        </span>
                      </span>
                    </label>
                    {checked && (
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {(
                          [
                            ["weightKg", "Peso (kg)"],
                            ["lengthCm", "Compr. (cm)"],
                            ["widthCm", "Larg. (cm)"],
                            ["heightCm", "Alt. (cm)"],
                          ] as Array<[keyof Measures, string]>
                        ).map(([key, label]) => (
                          <div key={key}>
                            <Label className="text-xs">{label}</Label>
                            <Input
                              inputMode="decimal"
                              value={m[key]}
                              onChange={(e) => setMeasure(p.id, key, e.target.value)}
                              className="h-8"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Pacote combinado: {parcel.weightKg.toFixed(2)} kg reais · cubado{" "}
              {cubicWeightKg(parcel).toFixed(2)} kg · {parcel.lengthCm}×{parcel.widthCm}×
              {parcel.heightCm} cm
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["fullName", "Nome completo"],
                ["cpfCnpj", "CPF/CNPJ"],
                ["phone", "Telefone"],
                ["email", "E-mail"],
                ["cep", "CEP"],
                ["street", "Rua"],
                ["number", "Número"],
                ["complement", "Complemento"],
                ["neighborhood", "Bairro"],
                ["city", "Cidade"],
                ["state", "UF"],
              ] as Array<[keyof ShipmentRecipient, string]>
            ).map(([key, label]) => (
              <div key={key}>
                <Label className="text-xs">{label}</Label>
                <Input
                  value={recipient[key]}
                  onChange={(e) => setRecipient((r) => ({ ...r, [key]: e.target.value }))}
                  className="h-9"
                />
              </div>
            ))}
            <div className="sm:col-span-2">
              <Label className="text-xs">Observações do envio</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-9" />
            </div>
            {!addressReady && (
              <p className="sm:col-span-2 text-xs text-destructive">
                Preencha nome, CEP, rua, cidade e UF para continuar.
              </p>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Preços simulados para {Math.max(0.3, parcel.weightKg).toFixed(2)} kg.
            </p>
            {quotes.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => setQuoteId(q.id)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors",
                  quoteId === q.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40",
                )}
              >
                <span>
                  <span className="block text-sm font-medium">
                    {q.carrier} · {q.service}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    até {q.etaDays} dia(s) úteis {q.note ? `· ${q.note}` : ""}
                  </span>
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {formatCents(q.priceCents)}
                </span>
              </button>
            ))}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs uppercase text-muted-foreground">Destinatário</p>
              <p className="font-medium">{recipient.fullName}</p>
              <p className="text-muted-foreground">
                {recipient.street}, {recipient.number} {recipient.complement} —{" "}
                {recipient.neighborhood}, {recipient.city}/{recipient.state} · CEP {recipient.cep}
              </p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs uppercase text-muted-foreground">Transporte</p>
              <p className="font-medium">
                {quote ? `${quote.carrier} · ${quote.service}` : "—"}
              </p>
              <p className="text-muted-foreground">
                {quote ? `${formatCents(quote.priceCents)} · até ${quote.etaDays} dia(s)` : ""}
              </p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs uppercase text-muted-foreground">
                Produtos ({chosen.length}) · {formatBRL(totalValue)}
              </p>
              <ul className="mt-1 space-y-1">
                {chosen.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <span>{p.name}</span>
                    <Tag>{formatBRL(p.totalValue)}</Tag>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-muted-foreground">
              Ao confirmar, estes produtos passam para a situação "Enviado".
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => (step === 1 ? onClose() : setStep((s) => s - 1))}
            disabled={saving}
          >
            {step === 1 ? "Cancelar" : "Voltar"}
          </Button>
          {step < 4 ? (
            <Button type="button" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
              Continuar
            </Button>
          ) : (
            <Button type="button" onClick={confirm} disabled={saving || !quote}>
              {saving ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
              Confirmar envio
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}