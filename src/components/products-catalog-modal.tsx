import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Download,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useServerTable } from "@/lib/api/use-server-table";
import { listProductCatalog, getProductReports } from "@/lib/products-catalog.functions";
import { classifyNcmBatch, listPendingNcmItems } from "@/lib/product-ncm.functions";
import { usePlatformOptions } from "@/lib/platforms";
import { formatBRL } from "@/lib/store";
import { formatNcm } from "@/lib/nf-format";
import { cn } from "@/lib/utils";

type CatalogRow = {
  name: string;
  platform: string;
  totalQty: number;
  paidQty: number;
  openQty: number;
  totalValue: number;
  paidValue: number;
  ncm: string;
  category: string;
  source: string;
  status: string;
  confidence: number | null;
};

const SORTS = [
  { value: "name_asc", label: "Nome (A–Z)" },
  { value: "name_desc", label: "Nome (Z–A)" },
  { value: "qty_desc", label: "Mais vendidos" },
  { value: "paid_desc", label: "Mais pagos" },
  { value: "value_desc", label: "Maior valor" },
];

const BATCH_SIZE = 20;

export function ProductsCatalogModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const platforms = usePlatformOptions();
  const queryClient = useQueryClient();

  const [platform, setPlatform] = useState("all");
  const [sort, setSort] = useState("name_asc");
  const [onlyMissing, setOnlyMissing] = useState(false);

  const filters = useMemo(
    () => ({
      platform: platform === "all" ? "" : platform,
      sort,
      onlyMissingNcm: onlyMissing,
    }),
    [platform, sort, onlyMissing],
  );

  const table = useServerTable<CatalogRow, typeof filters>(
    listProductCatalog as never,
    ["product-catalog"],
    { initialPageSize: 25, filters, enabled: open },
  );

  const callReports = useServerFn(getProductReports);
  const reports = useQuery({
    queryKey: ["product-reports"],
    enabled: open,
    staleTime: 60_000,
    queryFn: () => callReports({ data: { limit: 20 } }),
  });

  // ---- Geração de NCM em lote -------------------------------------------
  const callPending = useServerFn(listPendingNcmItems);
  const callClassify = useServerFn(classifyNcmBatch);
  const [gen, setGen] = useState<{
    running: boolean;
    paused: boolean;
    done: number;
    total: number;
    review: number;
    log: string;
  }>({ running: false, paused: false, done: 0, total: 0, review: 0, log: "" });

  const pausedRef = useMemo(() => ({ current: false }), []);

  async function runGeneration() {
    pausedRef.current = false;
    setGen((g) => ({ ...g, running: true, paused: false, log: "Levantando itens..." }));
    try {
      let processed = 0;
      let review = 0;
      // Loop: sempre pega o próximo lote de itens ainda sem NCM.
      for (;;) {
        if (pausedRef.current) break;
        const pending = await callPending({ data: { limit: BATCH_SIZE } });
        if (!pending.items.length) {
          setGen((g) => ({ ...g, running: false, log: "Tudo classificado." }));
          break;
        }
        setGen((g) => ({
          ...g,
          total: processed + pending.remaining,
          log: `Classificando ${pending.items.length} item(ns)...`,
        }));
        const res = await callClassify({ data: { items: pending.items.slice(0, BATCH_SIZE) } });
        processed += res.results.length;
        review += res.results.filter((r) => r.status === "review").length;
        setGen((g) => ({
          ...g,
          done: processed,
          review,
          log: `${processed} classificado(s) — ${review} para revisar.`,
        }));
        await table.refetch();
        if (res.saved === 0) {
          setGen((g) => ({ ...g, running: false, log: "Nada novo para salvar." }));
          break;
        }
      }
      queryClient.invalidateQueries({ queryKey: ["product-catalog"] });
      toast.success("Geração de NCM concluída.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao gerar NCM.");
    } finally {
      setGen((g) => ({ ...g, running: false }));
    }
  }

  function exportCsv() {
    const rows = table.rows;
    const head = "Produto;Plataforma;Qtd;Pagos;Em aberto;Valor total;Valor pago;NCM;Categoria;Origem;Status";
    const body = rows
      .map((r) =>
        [
          r.name,
          r.platform,
          r.totalQty,
          r.paidQty,
          r.openQty,
          r.totalValue.toFixed(2),
          r.paidValue.toFixed(2),
          r.ncm ? formatNcm(r.ncm) : "",
          r.category,
          r.source,
          r.status,
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(";"),
      )
      .join("\n");
    const blob = new Blob([`\uFEFF${head}\n${body}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "produtos-ncm.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalPages = Math.max(1, Math.ceil(table.total / table.pageSize));
  const progress = gen.total > 0 ? Math.min(100, (gen.done / gen.total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Produtos</DialogTitle>
          <DialogDescription>
            Catálogo completo, relatórios de vendas e classificação fiscal (NCM).
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="catalog" className="flex max-h-[78vh] flex-col">
          <div className="px-6 pt-4">
            <TabsList>
              <TabsTrigger value="catalog">Catálogo</TabsTrigger>
              <TabsTrigger value="reports">Relatórios</TabsTrigger>
              <TabsTrigger value="ncm">Gerar NCM</TabsTrigger>
            </TabsList>
          </div>

          {/* ---------------- Catálogo ---------------- */}
          <TabsContent value="catalog" className="min-h-0 flex-1 overflow-auto px-6 pb-6">
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-background py-3">
              <div className="relative min-w-56 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Buscar produto..."
                  value={table.search}
                  onChange={(e) => table.setSearch(e.target.value)}
                />
              </div>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Plataforma" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as plataformas</SelectItem>
                  {platforms.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORTS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant={onlyMissing ? "default" : "outline"}
                size="sm"
                onClick={() => setOnlyMissing((v) => !v)}
              >
                Sem NCM
              </Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={exportCsv}>
                <Download className="size-4" /> CSV
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => table.refetch()}
                title="Recarregar"
              >
                <RefreshCw className={cn("size-4", table.isFetching && "animate-spin")} />
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Plataforma</TableHead>
                  <TableHead className="text-right">Qtd</TableHead>
                  <TableHead className="text-right">Pagos</TableHead>
                  <TableHead className="text-right">Em aberto</TableHead>
                  <TableHead className="text-right">Valor total</TableHead>
                  <TableHead>NCM</TableHead>
                  <TableHead>Categoria fiscal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.rows.map((r) => (
                  <TableRow key={`${r.name}__${r.platform}`}>
                    <TableCell className="max-w-72 truncate font-medium">{r.name}</TableCell>
                    <TableCell className="text-muted-foreground">{r.platform || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.totalQty}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.paidQty}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.openQty}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatBRL(r.totalValue)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {r.ncm ? formatNcm(r.ncm) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-muted-foreground">
                      {r.status === "review" && r.ncm === "" ? "Revisar" : r.category || "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {!table.rows.length && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                      {table.isFetching ? "Carregando..." : "Nenhum produto encontrado."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between pt-3 text-sm text-muted-foreground">
              <span>
                {table.total} combinação(ões) — página {table.page} de {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={table.page <= 1}
                  onClick={() => table.setPage(table.page - 1)}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={table.page >= totalPages}
                  onClick={() => table.setPage(table.page + 1)}
                >
                  Próxima
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* ---------------- Relatórios ---------------- */}
          <TabsContent value="reports" className="min-h-0 flex-1 overflow-auto px-6 pb-6">
            {reports.isLoading && (
              <p className="py-10 text-center text-muted-foreground">Carregando relatórios...</p>
            )}
            {reports.data && (
              <div className="space-y-6 pt-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Produtos" value={String(reports.data.totals.total)} />
                  <Stat label="Pagos" value={String(reports.data.totals.paid)} />
                  <Stat label="Em aberto" value={String(reports.data.totals.open)} />
                  <Stat label="Valor pago" value={formatBRL(reports.data.totals.paid_value)} />
                </div>

                <RankGrid
                  title="Top plataformas"
                  paid={reports.data.platformsPaid.map((p) => ({
                    label: p.platform,
                    qty: p.qty,
                    value: p.value,
                  }))}
                  open={reports.data.platformsOpen.map((p) => ({
                    label: p.platform,
                    qty: p.qty,
                    value: p.value,
                  }))}
                />
                <RankGrid
                  title="Top produtos"
                  paid={reports.data.productsPaid.map((p) => ({
                    label: `${p.name}${p.platform ? ` · ${p.platform}` : ""}`,
                    qty: p.qty,
                    value: p.value,
                  }))}
                  open={reports.data.productsOpen.map((p) => ({
                    label: `${p.name}${p.platform ? ` · ${p.platform}` : ""}`,
                    qty: p.qty,
                    value: p.value,
                  }))}
                />
              </div>
            )}
          </TabsContent>

          {/* ---------------- NCM ---------------- */}
          <TabsContent value="ncm" className="min-h-0 flex-1 overflow-auto px-6 pb-6">
            <div className="space-y-4 pt-4">
              <div className="rounded-lg border border-border bg-background/40 p-4 text-sm text-muted-foreground">
                A geração classifica cada combinação de <strong>produto + plataforma</strong> ainda
                sem NCM, em lotes de {BATCH_SIZE}. Cada lote passa por duas conferências
                independentes da IA: o que não bate entre as duas, ou não corresponde a um NCM
                plausível para o segmento, fica marcado como <strong>Revisar</strong> em vez de
                receber um código inventado. Classificações editadas manualmente nunca são
                sobrescritas.
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button className="gap-2" disabled={gen.running} onClick={runGeneration}>
                  {gen.running ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  {gen.running ? "Gerando..." : "Gerar NCM"}
                </Button>
                {gen.running ? (
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => {
                      pausedRef.current = true;
                      setGen((g) => ({ ...g, paused: true, log: "Pausando após o lote atual..." }));
                    }}
                  >
                    <Pause className="size-4" /> Pausar
                  </Button>
                ) : gen.done > 0 ? (
                  <Button variant="outline" className="gap-2" onClick={runGeneration}>
                    <Play className="size-4" /> Continuar
                  </Button>
                ) : null}
              </div>

              {(gen.running || gen.done > 0) && (
                <div className="space-y-2">
                  <Progress value={progress} />
                  <p className="text-xs text-muted-foreground">
                    {gen.done} de {gen.total || gen.done} — {gen.review} para revisar. {gen.log}
                  </p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function RankGrid({
  title,
  paid,
  open,
}: {
  title: string;
  paid: Array<{ label: string; qty: number; value: number }>;
  open: Array<{ label: string; qty: number; value: number }>;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <RankList title="Pagos" rows={paid} />
        <RankList title="Em aberto" rows={open} />
      </div>
    </div>
  );
}

function RankList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; qty: number; value: number }>;
}) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <p className="pb-2 text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li key={`${r.label}-${i}`} className="flex items-center gap-2 text-sm">
            <span className="w-5 shrink-0 tabular-nums text-muted-foreground">{i + 1}.</span>
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            <span className="tabular-nums">{r.qty}</span>
            <span className="w-24 text-right tabular-nums text-muted-foreground">
              {formatBRL(r.value)}
            </span>
          </li>
        ))}
        {!rows.length && <li className="text-sm text-muted-foreground">Sem dados.</li>}
      </ul>
    </div>
  );
}
