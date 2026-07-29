import { FileCheck2 } from "lucide-react";

interface Props {
  count: number;
  lastAt?: string;
}

export function NfEmittedBadge({ count, lastAt }: Props) {
  if (count <= 0) return null;
  const date = lastAt ? new Date(lastAt) : null;
  const dateLabel = date && !isNaN(date.getTime())
    ? date.toLocaleDateString("pt-BR")
    : null;
  const title = dateLabel
    ? `${count} nota(s) fiscal(is) emitida(s) · última em ${dateLabel}`
    : `${count} nota(s) fiscal(is) emitida(s)`;
  return (
    <span
      title={title}
      className="ml-2 inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
    >
      <FileCheck2 className="h-3 w-3" />
      NF{count > 1 ? ` ×${count}` : ""}
    </span>
  );
}