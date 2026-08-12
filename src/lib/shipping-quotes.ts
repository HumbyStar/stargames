/**
 * Cotações de frete FICTÍCIAS (front-end apenas).
 *
 * Nenhuma chamada à API do SuperFrete é feita aqui: os preços e prazos são
 * calculados localmente a partir do peso real e do peso cubado, apenas para
 * simular a tela de escolha de transportadora.
 */

export interface ParcelDimensions {
  /** Peso real em kg. */
  weightKg: number;
  /** Comprimento em cm. */
  lengthCm: number;
  /** Largura em cm. */
  widthCm: number;
  /** Altura em cm. */
  heightCm: number;
}

export interface ShippingQuote {
  id: string;
  carrier: string;
  service: string;
  /** Preço em centavos. */
  priceCents: number;
  /** Prazo estimado em dias úteis. */
  etaDays: number;
  note?: string;
}

/** Peso cubado padrão do mercado: C × L × A / 6000. */
export function cubicWeightKg(d: Pick<ParcelDimensions, "lengthCm" | "widthCm" | "heightCm">): number {
  const v = (num(d.lengthCm) * num(d.widthCm) * num(d.heightCm)) / 6000;
  return Math.round(v * 1000) / 1000;
}

/** Peso considerado para o frete: o maior entre real e cubado. */
export function billableWeightKg(d: ParcelDimensions): number {
  return Math.max(num(d.weightKg), cubicWeightKg(d));
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Soma de vários volumes em um único pacote equivalente. */
export function combineParcels(items: ParcelDimensions[]): ParcelDimensions {
  if (items.length === 0) {
    return { weightKg: 0, lengthCm: 0, widthCm: 0, heightCm: 0 };
  }
  const weightKg = items.reduce((acc, i) => acc + num(i.weightKg), 0);
  const lengthCm = Math.max(...items.map((i) => num(i.lengthCm)));
  const widthCm = Math.max(...items.map((i) => num(i.widthCm)));
  // Empilhamento: as alturas somam.
  const heightCm = items.reduce((acc, i) => acc + num(i.heightCm), 0);
  return { weightKg, lengthCm, widthCm, heightCm };
}

interface CarrierTable {
  id: string;
  carrier: string;
  service: string;
  baseCents: number;
  perKgCents: number;
  etaDays: number;
  note?: string;
}

const CARRIERS: CarrierTable[] = [
  { id: "correios-pac", carrier: "Correios", service: "PAC", baseCents: 1890, perKgCents: 640, etaDays: 8, note: "Mais econômico" },
  { id: "correios-sedex", carrier: "Correios", service: "SEDEX", baseCents: 3290, perKgCents: 1180, etaDays: 3, note: "Mais rápido dos Correios" },
  { id: "loggi", carrier: "Loggi", service: "Loggi Express", baseCents: 2450, perKgCents: 890, etaDays: 4 },
  { id: "jadlog-package", carrier: "Jadlog", service: ".Package", baseCents: 2190, perKgCents: 760, etaDays: 6 },
  { id: "azul-cargo", carrier: "Azul Cargo", service: "Amanhã", baseCents: 3990, perKgCents: 1340, etaDays: 2, note: "Entrega aérea" },
  { id: "jet", carrier: "JeT", service: "JeT Standard", baseCents: 1990, perKgCents: 700, etaDays: 7 },
];

/**
 * Gera as cotações fictícias para um pacote. O resultado é determinístico:
 * mesmo peso/medida → mesmos preços.
 */
export function quoteShipping(parcel: ParcelDimensions): ShippingQuote[] {
  const kg = Math.max(0.3, billableWeightKg(parcel));
  return CARRIERS.map((c) => ({
    id: c.id,
    carrier: c.carrier,
    service: c.service,
    etaDays: c.etaDays,
    note: c.note,
    priceCents: Math.round(c.baseCents + c.perKgCents * kg),
  })).sort((a, b) => a.priceCents - b.priceCents);
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}