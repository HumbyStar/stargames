import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Search,
  Settings2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui-bits";
import { ProductCategoriesPanel } from "@/components/product-categories-panel";
import { buildXlsxBlob } from "@/lib/xlsx-writer";
import {
  getSegmentationSetup,
  logSegmentExport,
  segmentClientProducts,
  segmentClients,
} from "@/lib/segmentation.functions";
import {
  BASIS_LABEL,
  DEFAULT_EXCLUDED,
  FULL_HEADERS,
  MARKETING_HEADERS,
  SORT_LABEL,
  buildFullCsv,
  buildMarketingCsv,
  buildMarketingTxt,
  fullRow,
  marketingRow,
  segmentFileName,
  type SegmentBasis,
  type SegmentProduct,
  type SegmentRow,
  type SegmentSort,
} from "@/lib/segmentation-format";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const ALL = "__all__";
const PAGE = 20;

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function num(v: string): number | null {
  const t = v.trim().replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

interface Applied {
  categoryId: string | null;
  platform: string | null;
  min: number;
  max: number | null;
  basis: SegmentBasis;
  excludeSituations: string[];
  sort: SegmentSort;
  label: string;
}

export function SegmentacaoSection() {
  const setupFn = useServerFn(getSegmentationSetup);
  const searchFn = useServerFn(segmentClients);
  const productsFn = useServerFn(segmentClientProducts);
  const logFn = useServerFn(logSegmentExport);

  const setup = useQuery({
    queryKey: ["segmentation-setup"],
    queryFn: () => setupFn(),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  const categories = setup.data?.categories ?? [];
  const platforms = setup.data?.platforms ?? [];
  const situations = setup.data?.situations ?? [];

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const catLabel = (id: string | null) => {
    if (!id) return "Todos os produtos";
    const c = byId.get(id);
    if (!c) return "Todos os produtos";
    const p = c.parentId ? byId.get(c.parentId) : null;
    return p ? `${p.name} › ${c.name}` : c.name;
  };

  // Filtros do formulário
  const [categoryId, setCategoryId] = useState<string>(ALL);
  const [platform, setPlatform] = useState<string>(ALL);
  const [minV, setMinV] = useState("0");
  const [maxV, setMaxV] = useState("");
  const [basis, setBasis] = useState<SegmentBasis>("total");
  const [excluded, setExcluded] = useState<string[]>(DEFAULT_EXCLUDED);
  const [sort, setSort] = useState<SegmentSort>("value_desc");
  const [showExclusions, setShowExclusions] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);

  // Resultado
  const [applied, setApplied] = useState<Applied | null>(null);
  const [rows, setRows] = useState<SegmentRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [groupTotal, setGroupTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectAll, setSelectAll] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [unpicked, setUnpicked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, SegmentProduct[]>>({});

  const excludedForQuery = (b: SegmentBasis) => (b === "total_all" ? [] : excluded);

  const selectedCount = selectAll ? Math.max(totalCount - unpicked.size, 0) : picked.size;
  const isPicked = (id: string) => (selectAll ? !unpicked.has(id) : picked.has(id));

  function togglePick(id: string) {
    if (selectAll) {
      setUnpicked((prev) => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
    } else {
      setPicked((prev) => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
    }
  }

  async function runSearch(reset = true) {
    const min = num(minV) ?? 0;
    const max = num(maxV);
    if (max !== null && max < min) {
      toast.error("O valor máximo precisa ser maior que o mínimo.");
      return;
    }
    const next: Applied = {
      categoryId: categoryId === ALL ? null : categoryId,
      platform: platform === ALL ? null : platform,
      min,
      max,
      basis,
      excludeSituations: excludedForQuery(basis),
      sort,
      label: catLabel(categoryId === ALL ? null : categoryId),
    };
    const nextPage = reset ? 0 : page + 1;
    setLoading(true);
    try {
      const res = await searchFn({
        data: {
          categoryId: next.categoryId,
          platform: next.platform,
          min: next.min,
          max: next.max,
          basis: next.basis,
          excludeSituations: next.excludeSituations,
          sort: next.sort,
          page: nextPage,
          pageSize: PAGE,
        },
      });
      setApplied(next);
      setPage(nextPage);
      setRows((prev) => (reset ? res.rows : [...prev, ...res.rows]));
      setTotalCount(res.totalCount);
      setGroupTotal(res.groupTotal);
      if (reset) {
        setSelectAll(false);
        setPicked(new Set());
        setUnpicked(new Set());
        setExpanded(null);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na busca.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleExpand(r: SegmentRow) {
    if (expanded === r.clientId) {
      setExpanded(null);
      return;
    }
    setExpanded(r.clientId);
    if (details[r.clientId] || !applied) return;
    try {
      const list = await productsFn({
        data: {
          clientId: r.clientId,
          categoryId: applied.categoryId,
          platform: applied.platform,
          basis: applied.basis,
          excludeSituations: applied.excludeSituations,
        },
      });
      setDetails((d) => ({ ...d, [r.clientId]: list }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar produtos.");
    }
  }

  async function collectSelected(): Promise<SegmentRow[]> {
    if (!applied) return [];
    if (!selectAll) return rows.filter((r) => picked.has(r.clientId));
    const res = await searchFn({
      data: {
        categoryId: applied.categoryId,
        platform: applied.platform,
        min: applied.min,
        max: applied.max,
        basis: applied.basis,
        excludeSituations: applied.excludeSituations,
        sort: applied.sort,
        page: 0,
        pageSize: 5000,
      },
    });
    return res.rows.filter((r) => !unpicked.has(r.clientId));
  }

  async function runExport(kind: "full-csv" | "full-xlsx" | "mkt-csv" | "mkt-txt") {
    if (!applied || selectedCount === 0) {
      toast.error("Selecione ao menos um cliente.");
      return;
    }
    setExporting(true);
    try {
      const list = await collectSelected();
      if (!list.length) {
        toast.error("Nenhum cliente selecionado.");
        return;
      }
      const summary = `${applied.label}-min${applied.min}${applied.max ? `-max${applied.max}` : ""}`;
      if (kind === "full-csv") {
        download(
          new Blob(["\uFEFF" + buildFullCsv(list, applied.label)], {
            type: "text/csv;charset=utf-8",
          }),
          segmentFileName("segmentacao-completa", "csv", summary),
        );
      } else if (kind === "full-xlsx") {
        const blob = await buildXlsxBlob([
          {
            name: "Completa",
            rows: [[...FULL_HEADERS], ...list.map((r) => fullRow(r, applied.label))],
          },
          {
            name: "Marketing",
            rows: [[...MARKETING_HEADERS], ...list.map(marketingRow)],
          },
        ]);
        download(blob, segmentFileName("segmentacao", "xlsx", summary));
      } else if (kind === "mkt-csv") {
        download(
          new Blob(["\uFEFF" + buildMarketingCsv(list)], { type: "text/csv;charset=utf-8" }),
          segmentFileName("segmentacao-marketing", "csv", summary),
        );
      } else {
        download(
          new Blob([buildMarketingTxt(list)], { type: "text/plain;charset=utf-8" }),
          segmentFileName("segmentacao-telefones", "txt", summary),
        );
      }
      void logFn({ data: { format: kind, rows: list.length, filters: summary } });
      toast.success(`${list.length} cliente(s) exportado(s).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na exportação.");
    } finally {
      setExporting(false);
    }
  }

  const ticket = totalCount > 0 ? groupTotal / totalCount : 0;
  const hasMore = rows.length < totalCount;

  return (
    <div className="space-y-5">
      <Card title="Segmentação de clientes">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label className="text-xs">Categoria / Plataforma</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos os produtos</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {catLabel(c.id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Plataforma específica</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={ALL}>Todas</SelectItem>
                  {platforms.slice(0, 300).map((p) => (
                    <SelectItem key={p.platformKey} value={p.platform}>
                      {p.platform}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Valor mínimo gasto (R$)</Label>
              <Input value={minV} onChange={(e) => setMinV(e.target.value)} placeholder="1000" />
            </div>
            <div>
              <Label className="text-xs">Valor máximo (opcional)</Label>
              <Input value={maxV} onChange={(e) => setMaxV(e.target.value)} placeholder="—" />
            </div>
            <div>
              <Label className="text-xs">Base de cálculo</Label>
              <Select value={basis} onValueChange={(v) => setBasis(v as SegmentBasis)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(BASIS_LABEL) as SegmentBasis[]).map((b) => (
                    <SelectItem key={b} value={b}>
                      {BASIS_LABEL[b]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Ordenar por</Label>
              <Select value={sort} onValueChange={(v) => setSort(v as SegmentSort)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SORT_LABEL) as SegmentSort[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {SORT_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button className="flex-1" disabled={loading} onClick={() => void runSearch(true)}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}{" "}
                Buscar clientes
              </Button>
            </div>
            <div className="flex items-end gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setCatsOpen(true)}>
                <Settings2 className="size-4" /> Gerenciar categorias
              </Button>
            </div>
          </div>

          <div>
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setShowExclusions((v) => !v)}
            >
              {showExclusions ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              Situações excluídas do cálculo ({basis === "total_all" ? 0 : excluded.length})
            </button>
            {showExclusions ? (
              <div className="mt-2 flex flex-wrap gap-3 rounded-lg border bg-muted/20 p-3">
                {situations.length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    Nenhuma situação encontrada na base.
                  </span>
                ) : (
                  situations.map((s) => (
                    <label key={s} className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={excluded.includes(s)}
                        disabled={basis === "total_all"}
                        onCheckedChange={(v) =>
                          setExcluded((prev) =>
                            v ? [...new Set([...prev, s])] : prev.filter((x) => x !== s),
                          )
                        }
                      />
                      {s}
                    </label>
                  ))
                )}
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      {applied ? (
        <Card title="Resultado">
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">Clientes encontrados</div>
                <div className="text-lg font-semibold">{totalCount}</div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">Valor movimentado</div>
                <div className="text-lg font-semibold">{BRL.format(groupTotal)}</div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-xs text-muted-foreground">Ticket médio do grupo</div>
                <div className="text-lg font-semibold">{BRL.format(ticket)}</div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={selectAll}
                  onCheckedChange={(v) => {
                    setSelectAll(Boolean(v));
                    setPicked(new Set());
                    setUnpicked(new Set());
                  }}
                />
                Selecionar todos os {totalCount} resultados
              </label>
              <Badge variant="secondary">{selectedCount} selecionado(s)</Badge>
              <Badge variant="outline">{applied.label}</Badge>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" className="ml-auto" disabled={exporting}>
                    {exporting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Download className="size-4" />
                    )}{" "}
                    Exportar clientes
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => void runExport("full-csv")}>
                    Exportação completa (CSV)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void runExport("full-xlsx")}>
                    Exportação completa (XLSX)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void runExport("mkt-csv")}>
                    Marketing (CSV)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void runExport("mkt-txt")}>
                    Marketing (TXT — telefones)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-8 px-2 py-2" />
                    <th className="px-2 py-2 text-left">Cliente</th>
                    <th className="px-2 py-2 text-left">Telefone</th>
                    <th className="px-2 py-2 text-right">Produtos</th>
                    <th className="px-2 py-2 text-right">Valor gasto</th>
                    <th className="w-8 px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                        <Users className="mx-auto mb-2 size-5" />
                        Nenhum cliente encontrado com esses critérios.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <Fragment key={r.clientId}>
                        <tr className="border-t">
                          <td className="px-2 py-1.5">
                            <Checkbox
                              checked={isPicked(r.clientId)}
                              onCheckedChange={() => togglePick(r.clientId)}
                              aria-label={`Selecionar ${r.name}`}
                            />
                          </td>
                          <td className="px-2 py-1.5">{r.name}</td>
                          <td className="px-2 py-1.5">{r.phone}</td>
                          <td className="px-2 py-1.5 text-right">{r.productsCount}</td>
                          <td className="px-2 py-1.5 text-right font-medium">
                            {BRL.format(r.spent)}
                          </td>
                          <td className="px-2 py-1.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              onClick={() => void toggleExpand(r)}
                              aria-label={`Detalhes de ${r.name}`}
                            >
                              {expanded === r.clientId ? (
                                <ChevronDown className="size-4" />
                              ) : (
                                <ChevronRight className="size-4" />
                              )}
                            </Button>
                          </td>
                        </tr>
                        {expanded === r.clientId ? (
                          <tr className="bg-muted/20">
                            <td colSpan={6} className="px-4 py-2">
                              {!details[r.clientId] ? (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Loader2 className="size-3.5 animate-spin" /> Carregando produtos…
                                </div>
                              ) : (
                                <table className="w-full text-xs">
                                  <thead className="text-muted-foreground">
                                    <tr>
                                      <th className="py-1 text-left">Produto</th>
                                      <th className="py-1 text-left">Plataforma</th>
                                      <th className="py-1 text-left">Categoria</th>
                                      <th className="py-1 text-left">Data</th>
                                      <th className="py-1 text-left">Situação</th>
                                      <th className="py-1 text-right">Valor</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {details[r.clientId].map((p) => (
                                      <tr key={p.id} className="border-t border-border/50">
                                        <td className="py-1">{p.name}</td>
                                        <td className="py-1">{p.platform}</td>
                                        <td className="py-1">{p.category}</td>
                                        <td className="py-1">
                                          {new Date(p.registerDate).toLocaleDateString("pt-BR")}
                                        </td>
                                        <td className="py-1">{p.situation}</td>
                                        <td className="py-1 text-right">{BRL.format(p.value)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {hasMore ? (
              <div className="text-center">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onClick={() => void runSearch(false)}
                >
                  {loading ? <Loader2 className="size-4 animate-spin" /> : null} Carregar mais
                </Button>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Dialog open={catsOpen} onOpenChange={setCatsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Categorias de produtos</DialogTitle>
            <DialogDescription>
              Monte a árvore de categorias e vincule cada plataforma da base a uma delas.
            </DialogDescription>
          </DialogHeader>
          <ProductCategoriesPanel
            categories={categories}
            platforms={platforms}
            onChanged={() => void setup.refetch()}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
