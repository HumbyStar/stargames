import { Fragment, type ReactNode } from "react";

const CTRL_RE = /[.*+?^${}()|[\]\\]/g;

/**
 * Regex-escapa a query para uso em `RegExp(...)`.
 */
export function escapeRegex(q: string): string {
  return q.replace(CTRL_RE, "\\$&");
}

/**
 * Testa se `text` contém `query` (case-insensitive, e também bate dígitos
 * puros contra dígitos puros — útil para telefones e valores).
 */
export function matchText(text: string | number | null | undefined, query: string): boolean {
  if (!query) return false;
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const s = String(text ?? "").toLowerCase();
  if (s.includes(q)) return true;
  const qDigits = q.replace(/\D/g, "");
  if (!qDigits) return false;
  const sDigits = s.replace(/\D/g, "");
  return sDigits.length > 0 && sDigits.includes(qDigits);
}

/**
 * Retorna `text` com todas as ocorrências de `query` envoltas em `<mark>`.
 * Mantém o texto original quando não há query, e cai fora silenciosamente
 * se a regex ficar inválida.
 */
export function highlight(
  text: string | number | null | undefined,
  query: string,
): ReactNode {
  const raw = text == null ? "" : String(text);
  const q = query?.trim() ?? "";
  if (!q) return raw;
  try {
    const re = new RegExp(`(${escapeRegex(q)})`, "gi");
    const parts = raw.split(re);
    return (
      <>
        {parts.map((part, i) =>
          i % 2 === 1 ? (
            <mark
              key={i}
              className="rounded-sm bg-primary/25 px-0.5 text-foreground"
            >
              {part}
            </mark>
          ) : (
            <Fragment key={i}>{part}</Fragment>
          ),
        )}
      </>
    );
  } catch {
    return raw;
  }
}

/**
 * Pequeno indicador ao lado do cabeçalho da coluna quando ela tem
 * correspondências para a busca ativa. Some quando `count` é 0 ou
 * quando não há query.
 */
export function ColumnMatchDot({
  count,
  active,
}: {
  count: number;
  active: boolean;
}) {
  if (!active || count <= 0) return null;
  return (
    <span
      title={`${count} correspondência(s) nesta coluna`}
      className="ml-1 inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold text-primary"
    >
      <span className="size-1.5 rounded-full bg-primary" />
      {count}
    </span>
  );
}
