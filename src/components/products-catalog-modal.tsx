import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Download,
  Loader2,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Wand2,
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
import { LoadMoreButton } from "@/components/load-more-button";
import { listProductCatalog, getProductReports } from "@/lib/products-catalog.functions";
import {
  applyNcmRules,
  classifyNcmBatch,
  listPendingNcmItems,
  resetNcmClassifications,
} from "@/lib/product-ncm.functions";
import { NcmFlow } from "@/components/ncm-flow";
import { NcmEditDialog, type NcmTarget } from "@/components/ncm-edit-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  const callRules = useServerFn(applyNcmRules);
  const callReset = useServerFn(resetNcmClassifications);
  const [ncmPlatform, setNcmPlatform] = useState("all");
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<NcmTarget | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const ncmPlatformValue = ncmPlatform === "all" ? "" : ncmPlatform;
  const [gen, setGen] = useState<{
    running: boolean;
    paused: boolean;
    done: number;
    total: number;
    review: number;
    log: string;
    steps: string[];
  }>({ running: false, paused: false, done: 0, total: 0, review: 0, log: "", steps: [] });

  /** Adiciona uma etapa ao histórico visível do processamento. */
  function pushStep(message: string) {
    setGen((g) => ({ ...g, log: message, steps: [...g.steps, message].slice(-8) }));
  }

  const tick = () => new Promise((r) => setTimeout(r, 220));

  const pausedRef = useMemo(() => ({ current: false }), []);

  function openEditor(target: NcmTarget | null) {
    setEditTarget(target);
    setEditOpen(true);
  }

  async function runReset() {
    setResetting(true);
    try {
      const res = await callReset({ data: { platform: ncmPlatformValue, includeManual: false } });
      queryClient.invalidateQueries({ queryKey: ["product-catalog"] });
      queryClient.invalidateQueries({ queryKey: ["ncm-pending"] });
      await table.refetch();
      setGen({ running: false, paused: false, done: 0, total: 0, review: 0, log: "", steps: [] });
      toast.success(`${res.deleted} classificação(ões) removida(s).`);
      setResetOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao resetar NCM.");
    } finally {
      setResetting(false);
    }
  }

  async function runRules() {
    pausedRef.current = false;
    setGen((g) => ({
      ...g,
      running: true,
      paused: false,
      log: "Carregando itens...",
      steps: ["Carregando itens..."],
    }));
    try {
      const start = await callPending({ data: { limit: 1, platform: ncmPlatformValue } });
      const totalToDo = start.remaining;
      setGen((g) => ({ ...g, total: totalToDo }));
      pushStep(
        totalToDo
          ? `${totalToDo} item(ns) sem NCM encontrados${ncmPlatformValue ? ` em ${ncmPlatformValue}` : ""}.`
          : "Nenhum item pendente.",
      );
      await tick();
      let processed = 0;
      let lote = 0;
      for (;;) {
        if (pausedRef.current) break;
        lote += 1;
        pushStep(`Lote ${lote}: avaliando plataforma e título...`);
        await tick();
        const res = await callRules({ data: { limit: 200, platform: ncmPlatformValue } });
        if (!res.processed) {
          setGen((g) => ({
            ...g,
            running: false,
            total: g.total || g.done,
            done: g.total || g.done,
            log: ncmPlatformValue
              ? `Plataforma ${ncmPlatformValue} totalmente classificada.`
              : "Tudo classificado pela regra.",
            steps: [...g.steps, "Concluído — 100%."].slice(-8),
          }));
          break;
        }
        pushStep(`Lote ${lote}: atribuindo NCM a ${res.processed} item(ns)...`);
        processed += res.processed;
        setGen((g) => ({
          ...g,
          done: processed,
          total: Math.max(g.total, processed + Math.max(0, res.remaining - res.processed)),
          log: `${processed} item(ns) classificado(s) pela regra.`,
          steps: [...g.steps, `${processed} de ${Math.max(g.total, processed)} classificados.`].slice(-8),
        }));
        await table.refetch();
        if (res.saved === 0) {
          setGen((g) => ({
            ...g,
            running: false,
            log: "Nada novo para salvar.",
            steps: [...g.steps, "Nada novo para salvar."].slice(-8),
          }));
          break;
        }
        pushStep("Indo para o próximo lote...");
        await tick();
      }
      queryClient.invalidateQueries({ queryKey: ["product-catalog"] });
      queryClient.invalidateQueries({ queryKey: ["ncm-pending"] });
      toast.success("Regra de NCM aplicada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao aplicar a regra.");
    } finally {
      setGen((g) => ({ ...g, running: false }));
    }
  }

  const pendingCount = useQuery({
    queryKey: ["ncm-pending", ncmPlatformValue],
    enabled: open,
    staleTime: 15_000,
    queryFn: () => callPending({ data: { limit: 1, platform: ncmPlatformValue } }),
  });

  async function runGeneration() {
    pausedRef.current = false;
    setGen((g) => ({ ...g, running: true, paused: false, log: "Levantando itens..." }));
    try {
      let processed = 0;
      let review = 0;
      // Loop: sempre pega o próximo lote de itens ainda sem NCM.
      for (;;) {
        if (pausedRef.current) break;
        const pending = await callPending({
          data: { limit: BATCH_SIZE, platform: ncmPlatformValue },
        });
        if (!pending.items.length) {
          setGen((g) => ({
            ...g,
            running: false,
            log: ncmPlatformValue
              ? `Plataforma ${ncmPlatformValue} totalmente classificada.`
              : "Tudo classificado.",
          }));
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
      queryClient.invalidateQueries({ queryKey: ["ncm-pending"] });
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

  const remaining = Math.max(0, table.total - table.rows.length);
  const nextChunk = Math.min(25, remaining);
  const progress = gen.total > 0 ? Math.min(100, (gen.done / gen.total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Produtos</DialogTitle>
          <DialogDescription>
            Catálogo completo, relatórios de vendas e classificação fiscal (NCM).
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="catalog" className="flex flex-col">
          <div className="px-6 pt-4">
            <TabsList>
              <TabsTrigger value="catalog">Catálogo</TabsTrigger>
              <TabsTrigger value="reports">Relatórios</TabsTrigger>
              <TabsTrigger value="ncm">Gerar NCM</TabsTrigger>
            </TabsList>
          </div>

          {/* ---------------- Catálogo ---------------- */}
          <TabsContent value="catalog" className="px-6 pb-6">
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
                  <TableHead>Origem</TableHead>
                  <TableHead className="w-10" />
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
                    <TableCell className="text-xs uppercase text-muted-foreground">
                      {r.source === "rule"
                        ? "Regra"
                        : r.source === "manual"
                          ? "Manual"
                          : r.source === "ai"
                            ? "IA"
                            : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Editar NCM"
                        onClick={() =>
                          openEditor({
                            name: r.name,
                            platform: r.platform,
                            ncm: r.ncm,
                            category: r.category,
                          })
                        }
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!table.rows.length && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                      {table.isFetching ? "Carregando..." : "Nenhum produto encontrado."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            <div className="space-y-3 pt-3">
              {remaining > 0 && (
                <LoadMoreButton
                  count={nextChunk}
                  onClick={() => table.setPageSize(table.pageSize + 25)}
                />
              )}
              <p className="text-center text-sm text-muted-foreground">
                Mostrando {table.rows.length} de {table.total} combinação(ões)
              </p>
            </div>
          </TabsContent>

          {/* ---------------- Relatórios ---------------- */}
          <TabsContent value="reports" className="px-6 pb-6">
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
          <TabsContent value="ncm" className="px-6 pb-6">
            <div className="space-y-4 pt-4">
              <NcmFlow />

              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={ncmPlatform}
                  onValueChange={(v) => {
                    setNcmPlatform(v);
                    setGen({
                      running: false,
                      paused: false,
                      done: 0,
                      total: 0,
                      review: 0,
                      log: "",
                      steps: [],
                    });
                  }}
                >
                  <SelectTrigger className="w-52" disabled={gen.running}>
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
                <span className="text-xs text-muted-foreground">
                  {pendingCount.isFetching
                    ? "Contando itens sem NCM..."
                    : `${pendingCount.data?.remaining ?? 0} item(ns) sem NCM`}
                </span>
                <Button className="gap-2" disabled={gen.running} onClick={runRules}>
                  {gen.running ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Wand2 className="size-4" />
                  )}
                  {gen.running
                    ? "Aplicando..."
                    : `Aplicar regra NCM${ncmPlatformValue ? ` (${ncmPlatformValue})` : ""}`}
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  disabled={gen.running}
                  onClick={runGeneration}
                >
                  {gen.running ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  Conferir com IA
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  disabled={gen.running}
                  onClick={() => openEditor(null)}
                >
                  <Pencil className="size-4" /> Editar NCM de um produto
                </Button>
                <Button
                  variant="destructive"
                  className="gap-2"
                  disabled={gen.running || resetting}
                  onClick={() => setResetOpen(true)}
                >
                  <RotateCcw className="size-4" /> Resetar NCM
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
                  <Button variant="outline" className="gap-2" onClick={runRules}>
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
              <p className="text-xs text-muted-foreground">
                A regra é instantânea e não consome créditos de IA. A conferência por IA roda em
                lotes de {BATCH_SIZE}. Classificações manuais nunca são sobrescritas.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>

      <NcmEditDialog open={editOpen} onOpenChange={setEditOpen} target={editTarget} />

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resetar classificações de NCM?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso apaga os NCMs gerados pela regra e pela IA
              {ncmPlatformValue ? ` na plataforma ${ncmPlatformValue}` : " de todos os produtos"}.
              As classificações definidas manualmente são preservadas. Depois você pode aplicar a
              regra novamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={resetting}
              onClick={(e) => {
                e.preventDefault();
                void runReset();
              }}
            >
              {resetting ? "Resetando..." : "Resetar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
