import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Package,
  Truck,
  User,
  CheckCircle2,
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
import { Tag } from "@/components/ui-bits";
import { cn } from "@/lib/utils";
import { formatBRL, useStore, type Client, type Product } from "@/lib/store";
import { fichaFromTextWithDefaults } from "@/lib/ficha-parse";
import {
  combineParcels,
  cubicWeightKg,
  formatCents,
} from "@/lib/shipping-quotes";
import { createShipment, type ShipmentRecipient } from "@/lib/shipments.functions";
import {
  calculateSuperfreteQuote,
  createSuperfreteCartOrder,
  checkoutSuperfreteOrder,
  type SuperfreteQuoteOption,
} from "@/lib/superfrete.functions";
import { defaultShipOrigin, isShipOriginComplete } from "@/lib/ship-origin";
import { useServerFn } from "@tanstack/react-start";

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
  initialSelectedIds,
}: {
  client: Client;
  products: Product[];
  open: boolean;
  onClose: () => void;
  initialSelectedIds?: string[];
}) {
  const setProductSituation = useStore((s) => s.setProductSituation);
  const origin = useStore((s) => s.preferences.shipOrigin) ?? defaultShipOrigin;
  const runQuote = useServerFn(calculateSuperfreteQuote);
  const runCart = useServerFn(createSuperfreteCartOrder);
  const runCheckout = useServerFn(checkoutSuperfreteOrder);
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(products.map((p) => p.id)));
  const [measures, setMeasures] = useState<Record<string, Measures>>({});
  const [openCards, setOpenCards] = useState<Set<string>>(() => new Set());
  const [recipient, setRecipient] = useState<ShipmentRecipient>(emptyRecipient);
  const [quoteId, setQuoteId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [options, setOptions] = useState<SuperfreteQuoteOption[]>([]);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [labelInfo, setLabelInfo] = useState<{
    shipmentId: string;
    orderId: string;
    status: string;
  } | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [markingSent, setMarkingSent] = useState(false);

  // Preenche a ficha do cliente ao abrir (edição manual continua liberada).
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSaving(false);
    setQuoteId("");
    setNotes("");
    setOptions([]);
    setQuoteError(null);
    setLabelInfo(null);
    const preset = (initialSelectedIds ?? []).filter((id) =>
      products.some((p) => p.id === id),
    );
    const ids = preset.length > 0 ? preset : products.map((p) => p.id);
    setSelected(new Set(ids));
    setOpenCards(new Set(ids.slice(0, 1)));
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

  const quote = options.find((q) => q.id === quoteId) ?? null;
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

  const toggleCard = (id: string) =>
    setOpenCards((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apiProducts = () =>
    chosen.map((p) => {
      const m = measures[p.id] ?? DEFAULT_MEASURES;
      return {
        name: p.name,
        quantity: 1,
        unitaryValue: p.totalValue,
        weightKg: Number(m.weightKg.replace(",", ".")) || 0.3,
        lengthCm: Number(m.lengthCm.replace(",", ".")) || 16,
        widthCm: Number(m.widthCm.replace(",", ".")) || 11,
        heightCm: Number(m.heightCm.replace(",", ".")) || 2,
      };
    });

  const toAddress = () => ({
    name: recipient.fullName,
    document: recipient.cpfCnpj,
    phone: recipient.phone,
    email: recipient.email,
    postalCode: recipient.cep,
    street: recipient.street,
    number: recipient.number,
    complement: recipient.complement,
    district: recipient.neighborhood,
    city: recipient.city,
    state: recipient.state,
  });

  const calculate = async () => {
    if (quoting || chosen.length === 0) return;
    if (!isShipOriginComplete(origin)) {
      setQuoteError(
        "Configure a origem do envio em Configurações → Envio / SuperFrete antes de calcular o frete.",
      );
      return;
    }
    setQuoting(true);
    setQuoteError(null);
    setQuoteId("");
    try {
      const res = await runQuote({
        data: {
          from: origin,
          to: toAddress(),
          products: apiProducts(),
          insuranceValue: totalValue,
        },
      });
      setOptions(res.options);
      if (res.options.every((o) => o.error)) {
        setQuoteError("Nenhum serviço disponível para este trecho no momento.");
      }
    } catch (e) {
      setQuoteError(e instanceof Error ? e.message : "Não foi possível calcular o frete.");
    } finally {
      setQuoting(false);
    }
  };

  const confirm = async () => {
    if (!quote || chosen.length === 0 || saving) return;
    setSaving(true);
    try {
      const shipment = await createShipment({
        data: {
          clientId: client.id,
          clientName: client.name,
          carrier: quote.company || "SuperFrete",
          service: quote.name,
          etaDays: quote.deliveryDays,
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
          selectedServiceId: quote.id,
          selectedServiceName: quote.name,
        },
      });

      const order = await runCart({
        data: {
          shipmentId: shipment.id,
          from: origin,
          to: toAddress(),
          service: quote.id,
          products: apiProducts(),
          volumes: {
            weightKg: Math.max(0.01, parcel.weightKg),
            lengthCm: Math.max(1, parcel.lengthCm),
            widthCm: Math.max(1, parcel.widthCm),
            heightCm: Math.max(1, parcel.heightCm),
          },
          insuranceValue: totalValue,
        },
      });

      setLabelInfo({
        shipmentId: shipment.id,
        orderId: order.orderId,
        status: order.internalStatus,
      });
      toast.success(`Etiqueta criada na SuperFrete (${order.internalStatus}).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível registrar o envio.");
    } finally {
      setSaving(false);
    }
  };

  const release = async () => {
    if (!labelInfo || releasing) return;
    setReleasing(true);
    try {
      const res = await runCheckout({ data: { shipmentId: labelInfo.shipmentId } });
      setLabelInfo((l) => (l ? { ...l, status: res.internalStatus } : l));
      toast.success(`Etiqueta liberada (${res.internalStatus}).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível liberar a etiqueta.");
    } finally {
      setReleasing(false);
    }
  };

  const markSent = () => {
    if (markingSent) return;
    setMarkingSent(true);
    chosen.forEach((p) => setProductSituation(p.id, "Enviado"));
    toast.success(`${chosen.length} produto(s) marcados como Enviado.`);
    setMarkingSent(false);
    onClose();
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
                const expandedCard = openCards.has(p.id);
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "rounded-lg border px-3 py-2 transition-colors",
                      checked ? "border-primary/40 bg-primary/5" : "border-border",
                    )}
                  >
                    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                      <input
                        type="checkbox"
                        className="shrink-0"
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
                      <div className="min-w-0">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {p.platform || "Sem plataforma"} · {formatBRL(p.totalValue)} ·{" "}
                          {m.weightKg}kg · {m.lengthCm}×{m.widthCm}×{m.heightCm}cm
                        </span>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 shrink-0 gap-1 px-2 text-xs"
                        onClick={() => toggleCard(p.id)}
                        aria-expanded={expandedCard}
                      >
                        {expandedCard ? (
                          <ChevronDown className="size-3.5" />
                        ) : (
                          <ChevronRight className="size-3.5" />
                        )}
                        Ver detalhes
                      </Button>
                    </div>
                    {expandedCard && (
                      <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border/60 pt-2 sm:grid-cols-4">
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
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Peso considerado: {Math.max(0.3, parcel.weightKg).toFixed(2)} kg.
              </p>
              <Button type="button" size="sm" onClick={calculate} disabled={quoting}>
                {quoting ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                Calcular frete
              </Button>
            </div>
            {quoteError && <p className="text-xs text-destructive">{quoteError}</p>}
            {!quoting && options.length === 0 && !quoteError && (
              <p className="text-xs text-muted-foreground">
                Clique em "Calcular frete" para buscar as opções reais da SuperFrete.
              </p>
            )}
            {options.map((q) => (
              <button
                key={q.id}
                type="button"
                disabled={!!q.error}
                onClick={() => setQuoteId(q.id)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors",
                  q.error
                    ? "cursor-not-allowed border-border opacity-60"
                    : quoteId === q.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40",
                )}
              >
                <span>
                  <span className="block text-sm font-medium">
                    {q.company} · {q.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {q.error
                      ? q.error
                      : `até ${q.deliveryDays ?? "—"} dia(s) úteis`}
                  </span>
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  {q.error ? "—" : formatCents(q.priceCents)}
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
                {quote ? `${quote.company} · ${quote.name}` : "—"}
              </p>
              <p className="text-muted-foreground">
                {quote
                  ? `${formatCents(quote.priceCents)} · até ${quote.deliveryDays ?? "—"} dia(s)`
                  : ""}
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
            {labelInfo ? (
              <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
                <p className="text-sm font-medium">
                  Etiqueta {labelInfo.orderId} — {labelInfo.status}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={release} disabled={releasing}>
                    {releasing ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                    Liberar etiqueta (Sandbox)
                  </Button>
                  <Button type="button" size="sm" onClick={markSent} disabled={markingSent}>
                    Marcar produtos como enviados
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Os produtos só passam para "Enviado" quando você confirmar manualmente.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Ao confirmar, o envio é registrado e a etiqueta é criada na SuperFrete (Sandbox). Os
                produtos continuam em aberto até a confirmação manual do envio.
              </p>
            )}
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
          ) : labelInfo ? (
            <Button type="button" variant="outline" onClick={onClose}>
              Fechar
            </Button>
          ) : (
            <Button type="button" onClick={confirm} disabled={saving || !quote}>
              {saving ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
              Confirmar e gerar etiqueta
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}