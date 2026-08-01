import { useMemo, useState } from "react";
import { ChevronDown, Layers, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  activityCategoryLabels,
  relativeTime,
  type ActivityBatch,
  type ActivityEvent,
} from "@/lib/activity-feed";

interface Props {
  batch: ActivityBatch;
  onSelectEvent: (event: ActivityEvent) => void;
}

/** Card compacto para importações e ações em massa, com tabela detalhada. */
export function ActivityBatchCard({ batch, onSelectEvent }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return batch.events;
    return batch.events.filter((e) =>
      `${e.title} ${e.description ?? ""} ${e.clientLabel ?? ""} ${
        e.entity?.recordLabel ?? ""
      }`
        .toLowerCase()
        .includes(q),
    );
  }, [batch.events, query]);

  const clientes = new Set(
    batch.events.map((e) => e.clientLabel).filter(Boolean),
  ).size;

  return (
    <div className="px-3 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 text-left"
      >
        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Layers className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug">{batch.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{batch.actorLabel}</span>
            <span>·</span>
            <span>{activityCategoryLabels[batch.category]}</span>
            <span>·</span>
            <span>{relativeTime(batch.at)}</span>
            <span>·</span>
            <span>{batch.events.length} registro(s)</span>
            {clientes > 0 && (
              <>
                <span>·</span>
                <span>{clientes} cliente(s)</span>
              </>
            )}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "mt-2 size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="mt-2 space-y-2 rounded-lg border border-border bg-card p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar dentro do lote"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <div className="max-h-72 overflow-auto rounded-md border border-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-background/95 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 font-medium">Registro</th>
                  <th className="px-2 py-1.5 font-medium">Cliente</th>
                  <th className="px-2 py-1.5 font-medium">Detalhe</th>
                  <th className="px-2 py-1.5 text-right font-medium">Horário</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((e) => (
                  <tr
                    key={e.id}
                    onClick={() => onSelectEvent(e)}
                    className="cursor-pointer transition-colors hover:bg-foreground/5"
                  >
                    <td className="px-2 py-1.5">
                      {e.entity?.recordLabel ?? e.entity?.tableLabel ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {e.clientLabel ?? "—"}
                    </td>
                    <td className="max-w-[240px] truncate px-2 py-1.5 text-muted-foreground">
                      {e.description ?? `${e.changes?.length ?? 0} campo(s)`}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right text-muted-foreground">
                      {new Date(e.at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-2 py-4 text-center text-muted-foreground">
                      Nenhum registro corresponde à busca.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}