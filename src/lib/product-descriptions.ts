export const SHIPPING_DESCRIPTION_MAX_LENGTH = 100;

export function productDescription(name: string, defaultDescription?: string | null): string {
  return defaultDescription?.trim() || name.trim();
}

export function shortenDescription(value: string, maxLength = SHIPPING_DESCRIPTION_MAX_LENGTH): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  const candidate = clean.slice(0, Math.max(1, maxLength - 1));
  const wordBoundary = candidate.lastIndexOf(" ");
  const shortened = wordBoundary >= Math.floor(maxLength * 0.6)
    ? candidate.slice(0, wordBoundary)
    : candidate;
  return `${shortened.trimEnd()}…`;
}

export function buildShippingDescription(
  descriptions: string[],
  prefix = "Produtos",
  maxLength = SHIPPING_DESCRIPTION_MAX_LENGTH,
): string {
  const unique = Array.from(
    new Set(descriptions.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean)),
  );
  const body = unique.join(", ") || "Produtos diversos";
  return shortenDescription(`${prefix}: ${body}`, maxLength);
}

export interface ShippingDeclarationProduct {
  name: string;
  quantity: number;
  unitaryValue: number;
}

/** Monta a declaração de conteúdo com uma linha e um valor por produto. */
export function buildShippingDeclarationProducts(
  products: Array<{ id: string; name: string; totalValue: number }>,
  descriptions: Record<string, string>,
): ShippingDeclarationProduct[] {
  return products.map((product) => ({
    name: shortenDescription(descriptions[product.id]?.trim() || product.name),
    quantity: 1,
    unitaryValue: Math.max(0, Math.round(product.totalValue * 100) / 100),
  }));
}