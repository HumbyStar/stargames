import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Download,
  Filter,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
  const [visible, setVisible] = useState(20);
  const [exporting, setExporting] = useState(false);

  const set = <K extends keyof MetaFilters>(key: K, value: MetaFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setVisible(20);
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

  const totals = useMemo(
    () => ({
      value: filtered.reduce((s, l) => s + l.totalValue, 0),
      phones: filtered.filter((l) => toE164(l.ficha.phone || l.phone)).length,
    }),
    [filtered],
  );

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Sparkles className="size-5 text-primary" /> Dados Meta
          </h1>
          <p className="text-sm text-muted-foreground">
            Filtre a base e exporte listas prontas para públicos do Meta Business.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? "size-4 animate-spin" : "size-4"} /> Atualizar base
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/" })}>
            <ArrowLeft className="size-4" /> Voltar
          </Button>
        </div>
      </div>

      {error ? (
        <Card title="Erro">
          <p className="text-sm text-destructive">
            {error instanceof Error ? error.message : "Falha ao carregar a base."}
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Filtros */}
        <Card title="Filtros">
          <div className="space-y-4 text-sm">
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

            <div className="grid grid-cols-2 gap-2">
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
            </div>

            <div>
              <Label className="text-xs">Região — UF</Label>
              <div className="mt-1 flex max-h-28 flex-wrap gap-1 overflow-auto rounded-md border p-2">
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
                        "rounded px-1.5 py-0.5 text-xs " +
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

            <div className="grid grid-cols-2 gap-2">
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
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">DDD</Label>
                <Input value={filters.ddd} onChange={(e) => set("ddd", e.target.value)} placeholder="11" />
              </div>
              <div className="flex flex-col justify-end gap-2 pb-1">
                <label className="flex items-center gap-2 text-xs">
                  <Switch checked={filters.onlyMobile} onCheckedChange={(v) => set("onlyMobile", v)} />
                  Só celular
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
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
            </div>

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

            <div className="grid grid-cols-2 gap-2">
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
            </div>

            <div className="grid grid-cols-3 gap-2">
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
                <Label className="text-xs">Ticket mín.</Label>
                <Input
                  inputMode="decimal"
                  value={filters.avgTicketMin ?? ""}
                  onChange={(e) => set("avgTicketMin", numOrNull(e.target.value))}
                />
              </div>
            </div>

            <MultiChips
              label="Plataformas"
              options={options.platforms}
              selected={filters.platforms}
              onChange={(v) => set("platforms", v)}
              max={40}
            />

            <div className="grid grid-cols-1 gap-2">
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
              <div>
                <Label className="text-xs">Pasta / origem</Label>
                <Input value={filters.folder} onChange={(e) => set("folder", e.target.value)} />
              </div>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <ToggleRow label="Exigir telefone válido" checked={filters.requirePhone} onChange={(v) => set("requirePhone", v)} />
              <ToggleRow label="Exigir e-mail" checked={filters.requireEmail} onChange={(v) => set("requireEmail", v)} />
              <ToggleRow label="Exigir CPF/CNPJ" checked={filters.requireCpf} onChange={(v) => set("requireCpf", v)} />
              <ToggleRow label="Exigir endereço completo" checked={filters.requireAddress} onChange={(v) => set("requireAddress", v)} />
              <ToggleRow label="Remover telefones duplicados" checked={filters.dedupePhone} onChange={(v) => set("dedupePhone", v)} />
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setVisible(20);
              }}
            >
              <Filter className="size-4" /> Limpar filtros
            </Button>
          </div>
        </Card>

        {/* Resultado */}
        <div className="space-y-4">
          <Card title="Resultado">
            <div className="flex flex-wrap items-center gap-3">
              <Stat label="Clientes" value={isLoading ? "…" : String(filtered.length)} icon />
              <Stat label="Ficha completa" value={isLoading ? "…" : String(complete.length)} />
              <Stat label="Ficha incompleta" value={isLoading ? "…" : String(incomplete.length)} />
              <Stat label="Com telefone" value={isLoading ? "…" : String(totals.phones)} />
              <Stat label="Total comprado" value={isLoading ? "…" : BRL.format(totals.value)} />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-4 border-t pt-4">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={hashed} onCheckedChange={setHashed} />
                Exportar com hash SHA-256
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={includeIncomplete} onCheckedChange={setIncludeIncomplete} />
                Incluir fichas incompletas
              </label>
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
          </Card>

          <Card title={`Clientes encontrados (${filtered.length})`}>
            <div className="max-h-[52vh] overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/95 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">Cliente</th>
                    <th className="p-2 text-left">Telefone</th>
                    <th className="p-2 text-left">Região</th>
                    <th className="p-2 text-right">Itens</th>
                    <th className="p-2 text-right">Total</th>
                    <th className="p-2 text-left">Tipo</th>
                    <th className="p-2 text-left">Ficha</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-muted-foreground">
                        <Loader2 className="mx-auto size-5 animate-spin" />
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-muted-foreground">
                        Nenhum cliente com esses filtros.
                      </td>
                    </tr>
                  ) : (
                    filtered.slice(0, visible).map((l) => <Row key={l.id} lead={l} />)
                  )}
                </tbody>
              </table>
            </div>
            {filtered.length > visible ? (
              <Button
                variant="outline"
                className="mt-3 w-full"
                onClick={() => setVisible((v) => v + 20)}
              >
                Carregar mais 20 ({filtered.length - visible} restantes)
              </Button>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
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
          <span className="text-xs text-[color:var(--warning-foreground)]">
            falta {missingLabels(lead).join(", ")}
          </span>
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
      <div className="mt-1 flex max-h-28 flex-wrap gap-1 overflow-auto rounded-md border p-2">
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
