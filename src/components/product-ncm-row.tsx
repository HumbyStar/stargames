import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listProductCatalog } from "@/lib/products-catalog.functions";
import { formatNcm } from "@/lib/nf-format";
import { cn } from "@/lib/utils";
import type { NcmTarget } from "@/components/ncm-edit-dialog";

/** Setinha que abre/fecha a linha de detalhe fiscal (NCM) do produto. */
export function NcmExpandToggle({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={expanded ? "Ocultar NCM" : "Mostrar NCM"}
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-md text-muted-foreground",
        "hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
    </button>
  );
}

/** Linha extra com NCM / categoria fiscal do produto e atalho de edição. */
export function NcmDetailRow({
  name,
  platform,
  colSpan,
  onEdit,
}: {
  name: string;
  platform: string;
  colSpan: number;
  onEdit: (target: NcmTarget) => void;
}) {
  const queryClient = useQueryClient();
  const callList = useServerFn(listProductCatalog);
  const q = useQuery({
    queryKey: ["product-ncm-detail", name, platform],
    staleTime: 60_000,
    queryFn: async () => {
      const res = await callList({
        data: { page: 1, pageSize: 25, search: name, sort: "qty_desc" },
      });
      const norm = (v: string) => v.trim().toLowerCase();
      return (
        res.rows.find((r) => norm(r.name) === norm(name) && norm(r.platform) === norm(platform)) ??
        res.rows.find((r) => norm(r.name) === norm(name)) ??
        null
      );
    },
  });

  const row = q.data;
  const ncm = row?.ncm ?? "";
  const category = row?.category ?? "";

  return (
    <tr className="border-b border-border/60 bg-muted/20 last:border-0">
      <td colSpan={colSpan} className="px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
          {q.isLoading ? (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Carregando dados fiscais...
            </span>
          ) : (
            <>
              <span>
                <span className="text-muted-foreground">NCM: </span>
                <span className="font-medium tabular-nums">
                  {ncm ? formatNcm(ncm) : "não definido"}
                </span>
              </span>
              <span>
                <span className="text-muted-foreground">Categoria fiscal: </span>
                <span className="font-medium">{category || "não definida"}</span>
              </span>
              {row?.source && (
                <span className="text-muted-foreground">Origem: {row.source}</span>
              )}
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 gap-1.5 px-2"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ["product-ncm-detail"] });
              onEdit({ name, platform, ncm, category });
            }}
          >
            <Pencil className="size-3.5" /> Alterar NCM
          </Button>
        </div>
      </td>
    </tr>
  );
}
