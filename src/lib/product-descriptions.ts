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