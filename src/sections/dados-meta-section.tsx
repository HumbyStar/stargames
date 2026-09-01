import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bookmark,
  BookmarkPlus,
  Check,
  Download,
  Filter,
  Loader2,
  MapPin,
  Package,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Card } from "@/components/ui-bits";
import { usePermissions } from "@/lib/use-permissions";
import { fetchMetaLeads, logMetaExport } from "@/lib/meta-export.functions";
import {
  ANALYTIC_HEADERS,
  EMPTY_FILTERS,
  META_HEADERS,
  analyticRow,
  buildAnalyticCsv,
  buildMetaCsv,
  buildPhoneList,
  exportFileName,
  filterLeads,
  isLeadComplete,
  metaRow,
  missingLabels,
  summarizeFilters,
  toE164,
  type MetaFilters,
  type MetaLead,
} from "@/lib/meta-export-format";
import { buildXlsxBlob } from "@/lib/xlsx-writer";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const UFS = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
];

const SAVED_KEY = "stargames:meta-saved-filters:v1";

type SavedFilter = {
  id: string;
  title: string;
  description: string;
  goal: string;
  createdAt: string;
  filters: MetaFilters;
};

function loadSaved(): SavedFilter[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    const parsed = raw ? (JSON.parse(raw) as SavedFilter[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function numOrNull(v: string): number | null {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const STEPS = [
  { key: "base", title: "Base", hint: "Quem entra na busca", icon: Users },
  { key: "regiao", title: "Região & contato", hint: "Onde e como falar", icon: MapPin },
  { key: "valor", title: "Valor & recência", hint: "Quanto e quando", icon: TrendingUp },
  { key: "produtos", title: "Produtos & status", hint: "O que compraram", icon: Package },
  { key: "qualidade", title: "Qualidade da ficha", hint: "Pronto para o Meta", icon: BadgeCheck },
] as const;

export function DadosMetaSection() {
  const navigate = useNavigate();
  const { hasRole, loading: permsLoading } = usePermissions();
  const isAdmin = hasRole("admin") || hasRole("admin_master");

  const fetchFn = useServerFn(fetchMetaLeads);
  const logFn = useServerFn(logMetaExport);

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["meta-leads"],
    queryFn: () => fetchFn(),
    enabled: isAdmin,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  const [filters, setFilters] = useState<MetaFilters>(EMPTY_FILTERS);
  const [hashed, setHashed] = useState(false);
  const [includeIncomplete, setIncludeIncomplete] = useState(true);
  const [visibleOk, setVisibleOk] = useState(20);
  const [visibleBad, setVisibleBad] = useState(20);
  const [exporting, setExporting] = useState(false);
  const [step, setStep] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", goal: "" });

  useEffect(() => {
    setSaved(loadSaved());
  }, []);

  const persist = (next: SavedFilter[]) => {
    setSaved(next);
    try {
      window.localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    } catch {
      /* storage cheio ou bloqueado */
    }
  };

  const set = <K extends keyof MetaFilters>(key: K, value: MetaFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setVisibleOk(20);
    setVisibleBad(20);
  };

  const leads = data?.leads ?? [];

  const options = useMemo(() => {
    const platforms = new Set<string>();
    const situations = new Set<string>();
    const financial = new Set<string>();
    for (const l of leads) {
      l.platforms.forEach((p) => platforms.add(p));
      l.situations.forEach((s) => situations.add(s));
      l.financialStatuses.forEach((s) => financial.add(s));
    }
    return {
      platforms: Array.from(platforms).sort().slice(0, 400),
      situations: Array.from(situations).sort(),
      financial: Array.from(financial).sort(),
    };
  }, [leads]);

  const filtered = useMemo(() => filterLeads(leads, filters), [leads, filters]);
  const complete = useMemo(() => filtered.filter(isLeadComplete), [filtered]);
  const incomplete = useMemo(() => filtered.filter((l) => !isLeadComplete(l)), [filtered]);
  const exportSet = includeIncomplete ? filtered : complete;

  const activeCount = useMemo(() => summarizeFilters(filters).length, [filters]);

  const totals = useMemo(
    () => ({
      value: filtered.reduce((s, l) => s + l.totalValue, 0),
      phones: filtered.filter((l) => toE164(l.ficha.phone || l.phone)).length,
    }),
    [filtered],
  );

  function applySaved(s: SavedFilter) {
    setFilters({ ...EMPTY_FILTERS, ...s.filters });
    setConfirmed(true);
    setStep(STEPS.length - 1);
    setVisibleOk(20);
    setVisibleBad(20);
    toast.success(`Filtro "${s.title}" aplicado.`);
  }

  function saveCurrent() {
    const title = form.title.trim();
    if (!title) {
      toast.error("Dê um título para o filtro.");
      return;
    }
    persist([
      {
        id: crypto.randomUUID(),
        title,
        description: form.description.trim(),
        goal: form.goal.trim(),
        createdAt: new Date().toISOString(),
        filters,
      },
      ...saved,
    ]);
    setSaveOpen(false);
    setForm({ title: "", description: "", goal: "" });
    toast.success("Filtro salvo.");
  }

  async function runExport(kind: "meta" | "analytic" | "xlsx" | "phones") {
    if (!exportSet.length) {
      toast.error("Nenhum cliente no filtro atual.");
      return;
    }
    setExporting(true);
    const summary = summarizeFilters(filters);
    try {
      if (kind === "meta") {
        const csv = await buildMetaCsv(exportSet, hashed);
        download(
          new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
          exportFileName(hashed ? "meta-ads-hash" : "meta-ads", "csv", summary),
        );
      } else if (kind === "analytic") {
        const csv = buildAnalyticCsv(exportSet);
        download(
          new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
          exportFileName("dados-meta-analitico", "csv", summary),
        );
      } else if (kind === "xlsx") {
        const aptos = includeIncomplete ? complete : exportSet;
        const metaRows: (string | number)[][] = [[...META_HEADERS]];
        for (const l of aptos) metaRows.push(await metaRow(l, hashed));
        const sheets = [
          { name: "Aptos (Meta)", rows: metaRows },
          {
            name: "Analitico",
            rows: [[...ANALYTIC_HEADERS], ...exportSet.map((l) => analyticRow(l))],
          },
        ];
        if (includeIncomplete) {
          sheets.push({
            name: "Ficha incompleta",
            rows: [
              ["id", "nome", "telefone", "total_comprado", "campos_faltando"],
              ...incomplete.map((l) => [
                l.id,
                l.name,
                l.phone,
                l.totalValue,
                missingLabels(l).join(", "),
              ]),
            ],
          });
        }
        const blob = await buildXlsxBlob(sheets);
        download(blob, exportFileName("dados-meta", "xlsx", summary));
      } else {
        const text = buildPhoneList(exportSet);
        await navigator.clipboard.writeText(text);
        toast.success(`${text.split("\n").filter(Boolean).length} telefones copiados.`);
      }
      void logFn({
        data: {
          format: kind,
          rows: exportSet.length,
          hashed,
          includeIncomplete,
          filters: summary,
        },
      }).catch(() => {});
      if (kind !== "phones") toast.success(`Exportação gerada com ${exportSet.length} clientes.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao exportar.");
    } finally {
      setExporting(false);
    }
  }

  if (permsLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <ShieldAlert className="mx-auto size-10 text-destructive" />
        <h1 className="mt-4 text-xl font-semibold">Acesso restrito</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Apenas admin e admin master podem acessar a extração de dados para campanhas.
        </p>
        <Button className="mt-6" variant="outline" onClick={() => navigate({ to: "/" })}>
          <ArrowLeft className="size-4" /> Voltar
        </Button>
      </div>
    );
  }

  const StepIcon = STEPS[step].icon;
  const isLast = step === STEPS.length - 1;

  return (
    <div className="space-y-5">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:flex-wrap sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Sparkles className="size-5 shrink-0 text-primary" /> Dados Meta
          </h1>
          <p className="truncate text-sm text-muted-foreground">
            Filtre a base em etapas e exporte listas prontas para o Meta Business.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? "size-4 animate-spin" : "size-4"} /> Atualizar base
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/" })}>
            <ArrowLeft className="size-4" /> Voltar
          </Button>
        </div>
      </header>

      {error ? (
        <Card title="Erro">
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : "Falha ao carregar a base."}
          </p>
        </Card>
      ) : null}

      {/* Filtros salvos */}
      <Card title="Filtros salvos">
        <div className="flex flex-wrap items-start gap-2">
          {saved.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum filtro salvo ainda. Monte as etapas abaixo e confirme para salvar.
            </p>
          ) : (
            saved.map((s) => (
              <div
                key={s.id}
                className="group w-full max-w-xs rounded-xl border bg-card p-3 transition hover:border-primary/60 hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 truncate font-medium">
                      <Bookmark className="size-3.5 shrink-0 text-primary" />
                      <span className="truncate">{s.title}</span>
                    </div>
                    {s.goal ? (
                      <div className="mt-1 flex items-center gap-1 text-xs text-primary">
                        <Target className="size-3" /> {s.goal}
                      </div>
                    ) : null}
                    {s.description ? (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {s.description}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 text-muted-foreground"
                    onClick={() => persist(saved.filter((x) => x.id !== s.id))}
                    aria-label={`Excluir filtro ${s.title}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => applySaved(s)}
                >
                  Aplicar filtro
                </Button>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Etapas de filtro */}
      <Card title="Montar filtro">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {STEPS.map((s, i) => {
              const done = i < step;
              const active = i === step;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setStep(i)}
                  className={
                    "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition " +
                    (active
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : done
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-muted/50 text-muted-foreground hover:bg-accent")
                  }
                >
                  {done ? <Check className="size-3.5" /> : <s.icon className="size-3.5" />}
                  {i + 1}. {s.title}
                </button>
              );
            })}
            <span className="ml-auto text-xs text-muted-foreground">
              {activeCount} filtro(s) ativo(s)
            </span>
          </div>

          <Progress value={((step + 1) / STEPS.length) * 100} className="h-2" />

          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                <StepIcon className="size-4" />
              </span>
              <div>
                <div className="text-sm font-semibold">{STEPS[step].title}</div>
                <div className="text-xs text-muted-foreground">{STEPS[step].hint}</div>
              </div>
            </div>

            {step === 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Buscar (nome, telefone, e-mail)</Label>
                  <Input
                    value={filters.search}
                    onChange={(e) => set("search", e.target.value)}
                    placeholder="Ex.: joão"
                  />
                </div>
                <div>
                  <Label className="text-xs">Tipo de cliente</Label>
                  <Select
                    value={filters.clientType}
                    onValueChange={(v) => set("clientType", v as MetaFilters["clientType"])}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="mgmv">MGMV</SelectItem>
                      <SelectItem value="common">Comum</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Acordo MGMV</Label>
                  <Select
                    value={filters.mgmvStatus}
                    onValueChange={(v) => set("mgmvStatus", v as MetaFilters["mgmvStatus"])}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Tanto faz</SelectItem>
                      <SelectItem value="active">Acordo ativo</SelectItem>
                      <SelectItem value="settled">Quitado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Pasta / origem</Label>
                  <Input value={filters.folder} onChange={(e) => set("folder", e.target.value)} />
                </div>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Região — UF</Label>
                  <div className="mt-1 flex flex-wrap gap-1 rounded-md border bg-background p-2">
                    {UFS.map((uf) => {
                      const active = filters.states.includes(uf);
                      return (
                        <button
                          key={uf}
                          type="button"
                          onClick={() =>
                            set(
                              "states",
                              active
                                ? filters.states.filter((s) => s !== uf)
                                : [...filters.states, uf],
                            )
                          }
                          className={
                            "rounded px-2 py-0.5 text-xs transition " +
                            (active
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-accent")
                          }
                        >
                          {uf}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <Label className="text-xs">Cidade</Label>
                    <Input value={filters.city} onChange={(e) => set("city", e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">CEP começa com</Label>
                    <Input
                      value={filters.cepPrefix}
                      onChange={(e) => set("cepPrefix", e.target.value)}
                      placeholder="01"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">DDD</Label>
                    <Input
                      value={filters.ddd}
                      onChange={(e) => set("ddd", e.target.value)}
                      placeholder="11"
                    />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        checked={filters.onlyMobile}
                        onCheckedChange={(v) => set("onlyMobile", v)}
                      />
                      Só celular
                    </label>
                  </div>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Label className="text-xs">Total comprado (mín.)</Label>
                  <Input
                    inputMode="decimal"
                    value={filters.totalMin ?? ""}
                    onChange={(e) => set("totalMin", numOrNull(e.target.value))}
                    placeholder="R$ 0"
                  />
                </div>
                <div>
                  <Label className="text-xs">Total (máx.)</Label>
                  <Input
                    inputMode="decimal"
                    value={filters.totalMax ?? ""}
                    onChange={(e) => set("totalMax", numOrNull(e.target.value))}
                    placeholder="—"
                  />
                </div>
                <div>
                  <Label className="text-xs">Ticket mín.</Label>
                  <Input
                    inputMode="decimal"
                    value={filters.avgTicketMin ?? ""}
                    onChange={(e) => set("avgTicketMin", numOrNull(e.target.value))}
                  />
                </div>
                <div>
                  <Label className="text-xs">Cliente há mais de (dias)</Label>
                  <Input
                    inputMode="numeric"
                    value={filters.clientSinceDays ?? ""}
                    onChange={(e) => set("clientSinceDays", numOrNull(e.target.value))}
                    placeholder="180"
                  />
                </div>
                <div>
                  <Label className="text-xs">Até (dias)</Label>
                  <Input
                    inputMode="numeric"
                    value={filters.clientUntilDays ?? ""}
                    onChange={(e) => set("clientUntilDays", numOrNull(e.target.value))}
                    placeholder="—"
                  />
                </div>
                <div>
                  <Label className="text-xs">Comprou nos últimos (dias)</Label>
                  <Input
                    inputMode="numeric"
                    value={filters.lastPurchaseWithinDays ?? ""}
                    onChange={(e) => set("lastPurchaseWithinDays", numOrNull(e.target.value))}
                    placeholder="90"
                  />
                </div>
                <div>
                  <Label className="text-xs">Sem comprar há (dias)</Label>
                  <Input
                    inputMode="numeric"
                    value={filters.inactiveForDays ?? ""}
                    onChange={(e) => set("inactiveForDays", numOrNull(e.target.value))}
                    placeholder="120"
                  />
                </div>
                <div>
                  <Label className="text-xs">Pendência financeira</Label>
                  <Select
                    value={filters.openValue}
                    onValueChange={(v) => set("openValue", v as MetaFilters["openValue"])}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Tanto faz</SelectItem>
                      <SelectItem value="none">Sem valor em aberto</SelectItem>
                      <SelectItem value="only">Só com valor em aberto</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label className="text-xs">Mín. itens</Label>
                    <Input
                      inputMode="numeric"
                      value={filters.minProducts ?? ""}
                      onChange={(e) => set("minProducts", numOrNull(e.target.value))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Máx. itens</Label>
                    <Input
                      inputMode="numeric"
                      value={filters.maxProducts ?? ""}
                      onChange={(e) => set("maxProducts", numOrNull(e.target.value))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Envios</Label>
                    <Select
                      value={filters.shipment}
                      onValueChange={(v) => set("shipment", v as MetaFilters["shipment"])}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Tanto faz</SelectItem>
                        <SelectItem value="with">Já recebeu envio</SelectItem>
                        <SelectItem value="without">Nunca recebeu envio</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <MultiChips
                    label="Situação dos produtos"
                    options={options.situations}
                    selected={filters.situations}
                    onChange={(v) => set("situations", v)}
                  />
                  <MultiChips
                    label="Status financeiro"
                    options={options.financial}
                    selected={filters.financialStatuses}
                    onChange={(v) => set("financialStatuses", v)}
                  />
                </div>
                <MultiChips
                  label="Plataformas"
                  options={options.platforms}
                  selected={filters.platforms}
                  onChange={(v) => set("platforms", v)}
                  max={40}
                />
              </div>
            ) : null}

            {step === 4 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2 rounded-md border bg-background p-3">
                  <ToggleRow label="Exigir telefone válido" checked={filters.requirePhone} onChange={(v) => set("requirePhone", v)} />
                  <ToggleRow label="Exigir e-mail" checked={filters.requireEmail} onChange={(v) => set("requireEmail", v)} />
                  <ToggleRow label="Exigir CPF/CNPJ" checked={filters.requireCpf} onChange={(v) => set("requireCpf", v)} />
                  <ToggleRow label="Exigir endereço completo" checked={filters.requireAddress} onChange={(v) => set("requireAddress", v)} />
                  <ToggleRow label="Remover telefones duplicados" checked={filters.dedupePhone} onChange={(v) => set("dedupePhone", v)} />
                </div>
                <div className="space-y-2 rounded-md border bg-background p-3">
                  <ToggleRow label="Exportar com hash SHA-256" checked={hashed} onChange={setHashed} />
                  <ToggleRow
                    label="Incluir fichas incompletas na exportação"
                    checked={includeIncomplete}
                    onChange={setIncludeIncomplete}
                  />
                  <p className="pt-1 text-xs text-muted-foreground">
                    O Meta aceita listas com hash. Fichas incompletas viram uma aba separada.
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
            >
              <ArrowLeft className="size-4" /> Voltar
            </Button>
            {!isLast ? (
              <Button size="sm" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
                Próxima etapa <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  setConfirmed(true);
                  setSaveOpen(true);
                }}
              >
                <Check className="size-4" /> Confirmar filtro
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setStep(0);
                setConfirmed(false);
                setVisibleOk(20);
                setVisibleBad(20);
              }}
            >
              <Filter className="size-4" /> Limpar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setSaveOpen(true)}
            >
              <BookmarkPlus className="size-4" /> Salvar filtro atual
            </Button>
          </div>
        </div>
      </Card>

      {/* Encontrados */}
      <Card title="Encontrados">
        <div className="flex flex-wrap items-center gap-3">
          <Stat label="Clientes" value={isLoading ? "…" : String(filtered.length)} icon />
          <Stat label="Com ficha" value={isLoading ? "…" : String(complete.length)} />
          <Stat label="Sem ficha" value={isLoading ? "…" : String(incomplete.length)} />
          <Stat label="Com telefone" value={isLoading ? "…" : String(totals.phones)} />
          <Stat label="Total comprado" value={isLoading ? "…" : BRL.format(totals.value)} />
          {confirmed ? (
            <Badge variant="outline" className="ml-1">
              filtro confirmado
            </Badge>
          ) : null}
          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button disabled={exporting || isLoading || !exportSet.length}>
                  {exporting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  Exportar ({exportSet.length})
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void runExport("meta")}>
                  CSV Meta Ads (Customer List)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void runExport("analytic")}>
                  CSV completo (analítico)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void runExport("xlsx")}>
                  XLSX (aptos + ficha incompleta)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void runExport("phones")}>
                  Copiar telefones
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <Tabs defaultValue="ok" className="mt-4">
          <TabsList>
            <TabsTrigger value="ok">Com ficha ({complete.length})</TabsTrigger>
            <TabsTrigger value="bad">Sem ficha ({incomplete.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="ok" className="mt-3">
            <LeadTable
              leads={complete}
              loading={isLoading}
              visible={visibleOk}
              onMore={() => setVisibleOk((v) => v + 20)}
              empty="Nenhum cliente com ficha completa nesses filtros."
            />
          </TabsContent>
          <TabsContent value="bad" className="mt-3">
            <LeadTable
              leads={incomplete}
              loading={isLoading}
              visible={visibleBad}
              onMore={() => setVisibleBad((v) => v + 20)}
              empty="Nenhuma ficha incompleta nesses filtros."
              showMissing
            />
          </TabsContent>
        </Tabs>
      </Card>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Salvar filtro</DialogTitle>
            <DialogDescription>
              {filtered.length} clientes no filtro atual ({activeCount} critério(s)).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Título</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Ex.: SP — compradores acima de R$ 500"
              />
            </div>
            <div>
              <Label className="text-xs">Meta da campanha (opcional)</Label>
              <Input
                value={form.goal}
                onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))}
                placeholder="Ex.: 300 leads / remarketing"
              />
            </div>
            <div>
              <Label className="text-xs">Descrição (opcional)</Label>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Para que serve este público…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveCurrent}>
              <Bookmark className="size-4" /> Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LeadTable({
  leads,
  loading,
  visible,
  onMore,
  empty,
  showMissing,
}: {
  leads: MetaLead[];
  loading: boolean;
  visible: number;
  onMore: () => void;
  empty: string;
  showMissing?: boolean;
}) {
  return (
    <>
      <div className="max-h-[46vh] overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/95 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Cliente</th>
              <th className="p-2 text-left">Telefone</th>
              <th className="p-2 text-left">Região</th>
              <th className="p-2 text-right">Itens</th>
              <th className="p-2 text-right">Total</th>
              <th className="p-2 text-left">Tipo</th>
              <th className="p-2 text-left">{showMissing ? "Falta" : "Ficha"}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  <Loader2 className="mx-auto size-5 animate-spin" />
                </td>
              </tr>
            ) : leads.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">
                  {empty}
                </td>
              </tr>
            ) : (
              leads.slice(0, visible).map((l) => <Row key={l.id} lead={l} />)
            )}
          </tbody>
        </table>
      </div>
      {leads.length > visible ? (
        <Button variant="outline" className="mt-3 w-full" onClick={onMore}>
          Carregar mais 20 ({leads.length - visible} restantes)
        </Button>
      ) : null}
    </>
  );
}

function Row({ lead }: { lead: MetaLead }) {
  const ok = isLeadComplete(lead);
  const region = [lead.ficha.city, lead.ficha.state].filter(Boolean).join(" / ");
  return (
    <tr className="border-t">
      <td className="p-2">
        <div className="font-medium">{lead.ficha.fullName || lead.name}</div>
        {lead.ficha.email ? (
          <div className="text-xs text-muted-foreground">{lead.ficha.email}</div>
        ) : null}
      </td>
      <td className="p-2 tabular-nums">{toE164(lead.ficha.phone || lead.phone) || lead.phone}</td>
      <td className="p-2">{region || <span className="text-muted-foreground">—</span>}</td>
      <td className="p-2 text-right tabular-nums">{lead.productCount}</td>
      <td className="p-2 text-right tabular-nums">{BRL.format(lead.totalValue)}</td>
      <td className="p-2">
        <Badge variant={lead.clientType === "mgmv" ? "default" : "secondary"}>
          {lead.clientType === "mgmv" ? "MGMV" : "Comum"}
        </Badge>
      </td>
      <td className="p-2">
        {ok ? (
          <Badge variant="outline">Completa</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">{missingLabels(lead).join(", ")}</span>
        )}
      </td>
    </tr>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: boolean }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon ? <Users className="size-3" /> : null}
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function MultiChips({
  label,
  options,
  selected,
  onChange,
  max = 20,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  max?: number;
}) {
  const [q, setQ] = useState("");
  const list = q
    ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())).slice(0, max)
    : options.slice(0, max);
  if (!options.length) return null;
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      {options.length > max ? (
        <Input
          className="mt-1 h-8"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filtrar opções…"
        />
      ) : null}
      <div className="mt-1 flex max-h-28 flex-wrap gap-1 overflow-auto rounded-md border bg-background p-2">
        {list.map((o) => {
          const active = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() =>
                onChange(active ? selected.filter((s) => s !== o) : [...selected, o])
              }
              className={
                "rounded px-1.5 py-0.5 text-xs " +
                (active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent")
              }
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}
