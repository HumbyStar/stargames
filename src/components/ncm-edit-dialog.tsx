import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
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
import { listProductCatalog } from "@/lib/products-catalog.functions";
import { saveNcmManual } from "@/lib/product-ncm.functions";
import { aderirNCM, ncmEntrada } from "@/lib/ncm-rules";
import { formatNcm } from "@/lib/nf-format";
import { cn } from "@/lib/utils";

export type NcmTarget = { name: string; platform: string; ncm: string; category: string };

export function NcmEditDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target?: NcmTarget | null;
}) {
  const queryClient = useQueryClient();
  const callList = useServerFn(listProductCatalog);
  const callSave = useServerFn(saveNcmManual);

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState<NcmTarget | null>(null);
  const [ncm, setNcm] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(target ?? null);
    setNcm(target?.ncm ? formatNcm(target.ncm) : "");
    setCategory(target?.category ?? "");
    setSearch("");
    setDebounced("");
  }, [open, target]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const results = useQuery({
    queryKey: ["ncm-edit-search", debounced],
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
    queryFn: () =>
      callList({ data: { page: 1, pageSize: 15, search: debounced, sort: "qty_desc" } }),
  });

  const suggestion = useMemo(
    () => (selected ? aderirNCM(ncmEntrada(selected.name, selected.platform)) : null),
    [selected],
  );

  async function save() {
    if (!selected) return;
    const digits = ncm.replace(/\D/g, "");
    if (digits.length !== 8) {
      toast.error("Informe um NCM com 8 dígitos.");
      return;
    }
    setSaving(true);
    try {
      await callSave({
        data: {
          name: selected.name,
          platform: selected.platform,
          ncm: digits,
          category: category.trim() || "Definido manualmente",
        },
      });
      queryClient.invalidateQueries({ queryKey: ["product-catalog"] });
      queryClient.invalidateQueries({ queryKey: ["ncm-pending"] });
      toast.success("NCM atualizado.");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao salvar o NCM.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar NCM do produto</DialogTitle>
          <DialogDescription>
            Busque o produto no catálogo e defina o NCM. Edições manuais nunca são sobrescritas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Produto</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Buscar no catálogo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {debounced.length >= 2 && (
              <div className="max-h-52 overflow-y-auto rounded-md border border-border">
                {results.isFetching && (
                  <p className="p-3 text-sm text-muted-foreground">Buscando...</p>
                )}
                {!results.isFetching && !results.data?.rows.length && (
                  <p className="p-3 text-sm text-muted-foreground">Nenhum produto encontrado.</p>
                )}
                {results.data?.rows.map((r) => (
                  <button
                    key={`${r.name}__${r.platform}`}
                    type="button"
                    onClick={() => {
                      setSelected({
                        name: r.name,
                        platform: r.platform,
                        ncm: r.ncm,
                        category: r.category,
                      });
                      setNcm(r.ncm ? formatNcm(r.ncm) : "");
                      setCategory(r.category ?? "");
                      setSearch("");
                      setDebounced("");
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-b-0",
                      "hover:bg-muted/60",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {r.platform || "—"} · {r.ncm ? formatNcm(r.ncm) : "sem NCM"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selected && (
            <div className="space-y-3 rounded-lg border border-border bg-background/40 p-3">
              <div>
                <p className="text-sm font-medium">{selected.name}</p>
                <p className="text-xs text-muted-foreground">{selected.platform || "Sem plataforma"}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ncm-value">NCM</Label>
                  <Input
                    id="ncm-value"
                    value={ncm}
                    onChange={(e) => setNcm(e.target.value)}
                    placeholder="0000.00.00"
                    inputMode="numeric"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ncm-cat">Descrição fiscal</Label>
                  <Input
                    id="ncm-cat"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    placeholder="Ex.: Boneco colecionável"
                  />
                </div>
              </div>
              {suggestion && (
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    Regra sugere {formatNcm(suggestion.ncm)} — {suggestion.descricao}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setNcm(formatNcm(suggestion.ncm));
                      setCategory(suggestion.descricao);
                    }}
                  >
                    Usar sugestão
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={!selected || saving} onClick={save} className="gap-2">
            {saving && <Loader2 className="size-4 animate-spin" />} Salvar NCM
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
