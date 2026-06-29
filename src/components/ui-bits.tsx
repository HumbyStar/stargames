import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

type Status = "default" | "primary" | "success" | "danger" | "warning";

export function MetricCard({
  label,
  value,
  status = "default",
  hint,
  onClick,
  tooltip,
}: {
  label: string;
  value: string | number;
  status?: Status;
  hint?: string;
  onClick?: () => void;
  tooltip?: string;
}) {
  const valueClass = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-[color:var(--success)]",
    danger: "text-destructive",
    warning: "text-[color:var(--warning-foreground)]",
  }[status];

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={tooltip ?? `Ver ${label.toLowerCase()}`}
        className={cn(
          "group relative w-full text-left rounded-xl border border-border bg-card p-4 shadow-xs cursor-pointer transition-all",
          "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md hover:shadow-primary/10",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <ChevronRight className="size-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
        <p className={cn("mt-2 text-2xl font-semibold tabular-nums", valueClass)}>{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-2 text-2xl font-semibold tabular-nums", valueClass)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function Tag({
  children,
  variant = "neutral",
}: {
  children: ReactNode;
  variant?: "neutral" | "success" | "danger" | "warning" | "primary";
}) {
  const styles = {
    neutral: "bg-muted text-muted-foreground",
    success: "bg-[color:var(--success)]/15 text-[color:var(--success)]",
    danger: "bg-destructive/10 text-destructive",
    warning: "bg-[color:var(--warning)]/25 text-[color:var(--warning-foreground)]",
    primary: "bg-primary/10 text-primary",
  }[variant];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        styles,
      )}
    >
      {children}
    </span>
  );
}

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-border bg-card shadow-xs", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          {title ? <h3 className="text-sm font-semibold">{title}</h3> : <div />}
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function StackedBar({
  segments,
}: {
  segments: { label: string; percent: number; color: string }[];
}) {
  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {segments.map((s) => (
          <div key={s.label} style={{ width: `${s.percent}%`, background: s.color }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: s.color }} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-medium tabular-nums">{s.percent}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Alert({
  type,
  title,
  text,
  onClick,
  tooltip,
}: {
  type: "danger" | "warning" | "success" | "info";
  title: string;
  text: string;
  onClick?: () => void;
  tooltip?: string;
}) {
  const styles = {
    danger: "border-destructive/30 bg-destructive/5",
    warning: "border-[color:var(--warning)]/40 bg-[color:var(--warning)]/10",
    success: "border-[color:var(--success)]/30 bg-[color:var(--success)]/5",
    info: "border-primary/30 bg-primary/5",
  }[type];
  const dot = {
    danger: "bg-destructive",
    warning: "bg-[color:var(--warning)]",
    success: "bg-[color:var(--success)]",
    info: "bg-primary",
  }[type];
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={tooltip ?? `Ver ${title.toLowerCase()}`}
        className={cn(
          "group flex w-full gap-3 rounded-lg border p-3 text-left transition-all cursor-pointer",
          "hover:-translate-y-0.5 hover:shadow-md hover:shadow-primary/10 hover:border-primary/40",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          styles,
        )}
      >
        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", dot)} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{text}</p>
        </div>
        <ChevronRight className="size-4 shrink-0 self-center text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
      </button>
    );
  }
  return (
    <div className={cn("flex gap-3 rounded-lg border p-3", styles)}>
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", dot)} />
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}