import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Package,
  Plus,
  ShieldCheck,
  Trash2,
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
import { useSuperfreteBalance } from "@/lib/use-superfrete-balance";

type Measures = { weightKg: string; lengthCm: string; widthCm: string; heightCm: string };
type Box = Measures & { id: string };

const DEFAULT_MEASURES: Measures = { weightKg: "0.5", lengthCm: "20", widthCm: "15", heightCm: "10" };

const dec = (v: string) => Number((v ?? "").replace(",", "."));
const newBox = (): Box => ({ id: crypto.randomUUID(), ...DEFAULT_MEASURES });


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
  const { balance, loading: balanceLoading, refresh: refreshBalance } = useSuperfreteBalance(open);
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(products.map((p) => p.id)));
  const [boxes, setBoxes] = useState<Box[]>(() => [newBox()]);
  const [insured, setInsured] = useState(false);

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
    priceCents: number | null;
    insuredValue: number | null;
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
    setBoxes([newBox()]);
    setInsured(false);

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
        boxes.map((b) => ({
          weightKg: dec(b.weightKg),
          lengthCm: dec(b.lengthCm),
          widthCm: dec(b.widthCm),
          heightCm: dec(b.heightCm),
        })),
      ),
    [boxes],
  );

  /**
   * Limites da SuperFrete/Correios por volume. Validar aqui evita o erro
   * genérico "Ocorreu um ou mais erros" devolvido pela API.
   */
  const boxIssues = useMemo(() => {
    const out: string[] = [];
    boxes.forEach((b, i) => {
      const n = `Caixa ${i + 1}`;
      const w = dec(b.weightKg);
      const L = dec(b.lengthCm);
      const W = dec(b.widthCm);
      const H = dec(b.heightCm);
      if (!(w > 0) || !(L > 0) || !(W > 0) || !(H > 0)) {
        out.push(`${n}: informe peso e medidas maiores que zero.`);
        return;
      }
      if (w > 30) {
        out.push(
          `${n}: peso ${w} kg acima do limite de 30 kg. Se digitou em gramas, use kg (ex.: ${(
            w / 1000
          )
            .toFixed(2)
            .replace(".", ",")} kg).`,
        );
      }
      if (L < 16 || W < 11 || H < 2) {
        out.push(`${n}: medidas mínimas 16 × 11 × 2 cm (compr. × larg. × alt.).`);
      }
      if (L > 100 || W > 100 || H > 100) {
        out.push(`${n}: nenhuma medida pode passar de 100 cm.`);
      }
      if (L + W + H > 200) {
        out.push(`${n}: a soma das medidas não pode passar de 200 cm.`);
      }
    });
    return out;
  }, [boxes]);

  const boxesValid = boxes.length > 0 && boxIssues.length === 0;


  const quote = options.find((q) => q.id === quoteId) ?? null;
  const labelPaid = /liberad|paga|postad|entregue/i.test(labelInfo?.status ?? "");
  // Valor real da etiqueta (SuperFrete) quando disponível; senão, a cotação.
  const chargeCents = labelInfo?.priceCents ?? quote?.priceCents ?? null;
  const missingCents =
    chargeCents != null && balance?.balanceCents != null
      ? Math.max(0, chargeCents - balance.balanceCents)
      : 0;
  const insufficient = missingCents > 0;
  const totalValue = chosen.reduce((acc, p) => acc + p.totalValue, 0);
  const insuranceValue = insured ? totalValue : 0;

  const addressReady =
    recipient.fullName.trim() !== "" &&
    recipient.cep.trim() !== "" &&
    recipient.street.trim() !== "" &&
    recipient.city.trim() !== "" &&
    recipient.state.trim() !== "";

  const canNext =
    (step === 1 && chosen.length > 0 && boxesValid) ||
    (step === 2 && addressReady) ||
    (step === 3 && !!quote) ||
    step === 4;

  const setBoxField = (id: string, key: keyof Measures, value: string) =>
    setBoxes((list) => list.map((b) => (b.id === id ? { ...b, [key]: value } : b)));

  const addBox = () => setBoxes((list) => [...list, newBox()]);
  const removeBox = (id: string) =>
    setBoxes((list) => (list.length > 1 ? list.filter((b) => b.id !== id) : list));

  /** Volumes enviados à SuperFrete: uma entrada por caixa. */
  const apiProducts = () => {
    const share = boxes.length > 0 ? totalValue / boxes.length : totalValue;
    return boxes.map((b, i) => ({
      name: `Caixa ${i + 1}`,
      quantity: 1,
      unitaryValue: Number(share.toFixed(2)),
      weightKg: dec(b.weightKg) || 0.3,
      lengthCm: dec(b.lengthCm) || 16,
      widthCm: dec(b.widthCm) || 11,
      heightCm: dec(b.heightCm) || 2,
    }));
  };


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
    if (boxIssues.length > 0) {
      setQuoteError(`Corrija as caixas na etapa 1: ${boxIssues.join(" ")}`);
      return;
    }
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
          insuranceValue,
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
      // 1) Cria a etiqueta na SuperFrete PRIMEIRO. Se falhar, nenhum envio é
      // gravado — evita registros órfãos com selo "Etiqueta não paga".
      const order = await runCart({
        data: {
          shipmentId: null,
          from: origin,
          to: toAddress(),
          service: quote.id,
          products: apiProducts(),
          insuranceValue,
        },
      });

      // 2) Só então grava o envio já com os dados reais da etiqueta.
      const shipment = await createShipment({
        data: {
          clientId: client.id,
          clientName: client.name,
          carrier: quote.company || "SuperFrete",
          service: quote.name,
          etaDays: quote.deliveryDays,
          priceCents: order.priceCents ?? quote.priceCents,
          totalWeightKg: Number(parcel.weightKg.toFixed(3)),
          items: chosen.map((p) => ({
            productId: p.id,
            name: p.name,
            platform: p.platform ?? "",
            value: p.totalValue,
            weightKg: 0,
            lengthCm: 0,
            widthCm: 0,
            heightCm: 0,
          })),
          recipient,
          notes:
            [
              notes.trim(),
              `Caixas: ${boxes
                .map(
                  (b, i) =>
                    `#${i + 1} ${dec(b.weightKg)}kg ${dec(b.lengthCm)}×${dec(b.widthCm)}×${dec(
                      b.heightCm,
                    )}cm`,
                )
                .join("; ")}`,
              `Seguro: ${insured ? `sim (${formatBRL(totalValue)})` : "não"}`,
            ]
              .filter(Boolean)
              .join(" · ") || null,
          selectedServiceId: quote.id,
          selectedServiceName: quote.name,
          superfreteOrderId: order.orderId || null,
          superfreteStatus: order.status ?? null,
          status: order.internalStatus,
          payloadCart: order.payloadCartJson ? JSON.parse(order.payloadCartJson) : null,
          responseCart: order.responseCartJson ? JSON.parse(order.responseCartJson) : null,
        },
      });

      setLabelInfo({
        shipmentId: shipment.id,
        orderId: order.orderId,
        status: order.internalStatus,
        priceCents: order.priceCents ?? quote.priceCents,
        insuredValue: order.insuredValue ?? null,
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
      void refreshBalance();
      toast.success(
        res.pending
          ? "Pagamento enviado — etiqueta aguardando liberação da SuperFrete."
          : "Etiqueta paga com o saldo da carteira SuperFrete.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível pagar a etiqueta.");
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
            Cotações reais da SuperFrete (ambiente{" "}
            {balance?.environment === "sandbox" ? "Sandbox" : "Produção"}). A etiqueta é gerada sem
            alterar a situação dos produtos.
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
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-sm text-muted-foreground">
                Selecione os produtos que vão neste envio.
              </p>
              <div className="space-y-2">
                {products.map((p) => {
                  const checked = selected.has(p.id);
                  return (
                    <label
                      key={p.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition-colors",
                        checked ? "border-primary/40 bg-primary/5" : "border-border",
                      )}
                    >
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
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {p.platform || "Sem plataforma"} · {formatBRL(p.totalValue)}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Caixas do envio ({boxes.length})</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={addBox}
                >
                  <Plus className="size-3.5" /> Adicionar caixa
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                As medidas são da caixa, não do produto. Havendo mais de uma, o envio sai em uma
                etiqueta com o volume somado.
              </p>
              {boxes.map((b, i) => (
                <div key={b.id} className="rounded-lg border border-border px-3 py-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium uppercase text-muted-foreground">
                      Caixa {i + 1}
                    </span>
                    {boxes.length > 1 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 px-2 text-xs text-destructive"
                        onClick={() => removeBox(b.id)}
                      >
                        <Trash2 className="size-3.5" /> Remover
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
                          value={b[key]}
                          onChange={(e) => setBoxField(b.id, key, e.target.value)}
                          className="h-8"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Volume enviado à SuperFrete: {parcel.weightKg.toFixed(2)} kg reais · cubado{" "}
                {cubicWeightKg(parcel).toFixed(2)} kg · {parcel.lengthCm}×{parcel.widthCm}×
                {parcel.heightCm} cm
              </p>
              <p className="text-xs text-muted-foreground">
                Limites por caixa: até 30 kg, mínimo 16 × 11 × 2 cm, máximo 100 cm por lado e soma
                das medidas até 200 cm. O peso é em quilos (0,65 = 650 g).
              </p>
              {boxIssues.length > 0 && (
                <ul className="space-y-0.5 text-xs text-destructive">
                  {boxIssues.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
            </div>
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
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0"
                checked={insured}
                onChange={(e) => {
                  setInsured(e.target.checked);
                  setOptions([]);
                  setQuoteId("");
                }}

              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <ShieldCheck className="size-4" /> Enviar com seguro (SuperFrete)
                </span>
                <span className="block text-xs text-muted-foreground">
                  Protege o valor dos produtos deste envio ({formatBRL(totalValue)}). O preço do
                  frete já vem com o seguro incluso quando marcado.
                </span>
              </span>
            </label>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Peso considerado: {Math.max(0.3, parcel.weightKg).toFixed(2)} kg ·{" "}
                {boxes.length} caixa(s) · seguro {insured ? "ativado" : "desativado"}.
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
                  {insured && !q.error ? (
                    <span className="block text-xs text-muted-foreground">
                      {q.insuredValue == null || q.insuredValue <= 0
                        ? "Seguro não aplicado por esta transportadora"
                        : Math.abs(q.insuredValue - totalValue) < 0.01
                          ? `Seguro: cobertura ${formatBRL(q.insuredValue)}`
                          : `Seguro: taxa ${formatBRL(q.insuredValue)} (cobertura ${formatBRL(totalValue)})`}
                    </span>
                  ) : null}
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
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
              <div>
                <p className="text-xs uppercase text-muted-foreground">Saldo SuperFrete</p>
                <p className="font-semibold tabular-nums">
                  {balanceLoading && !balance
                    ? "Carregando…"
                    : balance?.balanceCents != null
                      ? formatCents(balance.balanceCents)
                      : "Indisponível"}
                </p>
                {balance?.error ? (
                  <p className="text-xs text-muted-foreground">{balance.error}</p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => void refreshBalance()}>
                  Atualizar saldo
                </Button>
                <a
                  className="text-xs text-primary underline"
                  href="https://web.superfrete.com/#/recarga"
                  target="_blank"
                  rel="noreferrer"
                >
                  Recarregar
                </a>
              </div>
            </div>
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
              <p className="text-muted-foreground">
                {boxes.length} caixa(s) · {parcel.weightKg.toFixed(2)} kg · {parcel.lengthCm}×
                {parcel.widthCm}×{parcel.heightCm} cm
              </p>
              <p className="text-muted-foreground">
                Seguro:{" "}
                {insured ? `sim — valor protegido ${formatBRL(totalValue)}` : "não"}
                {insured && labelInfo
                  ? labelInfo.insuredValue != null && labelInfo.insuredValue > 0
                    ? ` · confirmado pela SuperFrete (${formatBRL(labelInfo.insuredValue)})`
                    : " · aguardando confirmação da SuperFrete"
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
                <p className="text-xs text-muted-foreground">
                  Valor real do frete:{" "}
                  <span className="font-semibold tabular-nums text-foreground">
                    {chargeCents != null ? formatCents(chargeCents) : "—"}
                  </span>
                  {balance?.balanceCents != null
                    ? ` · Saldo disponível: ${formatCents(balance.balanceCents)}`
                    : ""}
                </p>
                {insufficient ? (
                  <p className="text-xs text-amber-600">
                    Saldo insuficiente — faltam {formatCents(missingCents)} para pagar esta
                    etiqueta. Recarregue a carteira SuperFrete e tente novamente.
                  </p>
                ) : chargeCents != null && balance?.balanceCents != null ? (
                  <p className="text-xs text-muted-foreground">
                    Saldo após o pagamento:{" "}
                    {formatCents(Math.max(0, balance.balanceCents - chargeCents))}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={release}
                    disabled={releasing || insufficient || labelPaid}
                  >
                    {releasing ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                    {labelPaid
                      ? "Etiqueta paga"
                      : `Pagar etiqueta com saldo${chargeCents != null ? ` (${formatCents(chargeCents)})` : ""}`}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={markSent}
                    disabled={markingSent}
                  >
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