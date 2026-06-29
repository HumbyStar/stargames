import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type CardTone =
  | "neutral"
  | "common"
  | "mgmv"
  | "success"
  | "warning"
  | "danger"
  | "info";

const toneClasses: Record<CardTone, string> = {
  neutral:
    "border-border bg-card text-card-foreground [--card-accent:hsl(var(--muted-foreground))]",
  common:
    "border-sky-500/30 bg-sky-500/5 text-card-foreground [--card-accent:hsl(217_91%_60%)]",
  mgmv:
    "border-amber-500/40 bg-amber-500/5 text-card-foreground [--card-accent:hsl(38_92%_50%)]",
  success:
    "border-emerald-500/30 bg-emerald-500/5 text-card-foreground [--card-accent:hsl(160_84%_39%)]",
  warning:
    "border-amber-500/30 bg-amber-500/5 text-card-foreground [--card-accent:hsl(38_92%_50%)]",
  danger:
    "border-destructive/40 bg-destructive/5 text-card-foreground [--card-accent:hsl(var(--destructive))]",
  info:
    "border-primary/30 bg-primary/5 text-card-foreground [--card-accent:hsl(var(--primary))]",
};

function useCountUp(target: number | undefined, duration = 450) {
  const [value, setValue] = useState<number | undefined>(target);
  const startRef = useRef<{ from: number; to: number; t0: number } | null>(null);

  useEffect(() => {
    if (target === undefined) {
      setValue(undefined);
      return;
    }
    const from = typeof value === "number" ? value : target;
    if (from === target) {
      setValue(target);
      return;
    }
    startRef.current = { from, to: target, t0: performance.now() };
    let raf = 0;
    const tick = (now: number) => {
      const s = startRef.current;
      if (!s) return;
      const p = Math.min(1, (now - s.t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = Math.round(s.from + (s.to - s.from) * eased);
      setValue(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return value;
}

export function ImportCard({
  icon: Icon,
  title,
  value,
  hint,
  tone = "neutral",
  format,
  pulseKey,
  className,
}: {
  icon: LucideIcon;
  title: string;
  value: number | string | undefined;
  hint?: string;
  tone?: CardTone;
  format?: (n: number) => string;
  /** Mude para forçar um pulse quando o valor variar fora de count-up. */
  pulseKey?: string | number;
  className?: string;
}) {
  const numeric = typeof value === "number" ? value : undefined;
  const counted = useCountUp(numeric);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    setPulse(true);
    const id = setTimeout(() => setPulse(false), 500);
    return () => clearTimeout(id);
  }, [value, pulseKey]);

  const displayed =
    typeof value === "string"
      ? value
      : counted === undefined
        ? undefined
        : format
          ? format(counted)
          : counted.toLocaleString("pt-BR");

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border p-3 shadow-xs transition-all",
        toneClasses[tone],
        pulse && "ring-2 ring-[color:var(--card-accent)]/40",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {title}
          </div>
          <div
            className={cn(
              "mt-1 font-mono text-2xl font-semibold tabular-nums transition-colors",
              pulse && "text-[color:var(--card-accent)]",
            )}
          >
            {displayed === undefined ? (
              <span className="inline-block h-7 w-12 animate-pulse rounded bg-muted" />
            ) : (
              displayed
            )}
          </div>
          {hint && (
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</div>
          )}
        </div>
        <div
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-background/60 text-[color:var(--card-accent)]"
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

export function ImportCardsGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
        className,
      )}
    >
      {children}
    </div>
  );
}