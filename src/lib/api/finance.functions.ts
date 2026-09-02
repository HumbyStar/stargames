import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============================================================================
// getFinanceAggregates — Finanças calculado no servidor.
//
// Antes, o painel de Finanças recalculava tudo sobre a store completa no
// navegador (~2.800 clientes e ~24.000 produtos), o que exigia carregar a base
// inteira e travava a interface. Agora o servidor lê apenas as colunas
// necessárias e devolve um DTO pequeno (KPIs, séries do gráfico já agrupadas e
// os tops), consumido com cache no cliente.
// ============================================================================

export type TimelineMode = "7d" | "30d" | "6m" | "12m" | "all";

export interface TimelineBucket {
  key: string;
  label: string;
  registrado: number;
  recebido: number;
  aReceber: number;
  inadimplencia: number;
}

export interface FinanceTopClient {
  clientId: string;
  name: string;
  isMgmv: boolean;
  value: number;
}

export interface FinanceAggregates {
  total: number;
  received: number;
  open: number;
  receivedPct: number;
  statusData: Array<{ name: string; value: number; count: number }>;
  platforms: Array<{ name: string; value: number }>;
  topDebtors: FinanceTopClient[];
  topBuyers: FinanceTopClient[];
  mgmvTotal: number;
  mgmvPaid: number;
  overdueValue: number;
  overdueCount: number;
  ticket: number;
  activeClients: number;
  productsCount: number;
  timelines: Record<TimelineMode, TimelineBucket[]>;
  generatedAt: string;
}

interface SlimProduct {
  clientId: string;
  platform: string;
  totalValue: number;
  paidValue: number;
  financialStatus: string;
  situation: string;
  registerDate: string | null;
  dueDate: string | null;
}

interface SlimInstallment {
  dueDate: string;
  value: number;
  paid: boolean;
  paidAt?: string;
  paidAmount?: number;
}

interface SlimClient {
  id: string;
  name: string;
  mgmv: { totalDebt: number; startDate: string | null; installments: SlimInstallment[] } | null;
}

const RESOLVED_SITUATIONS = new Set([
  "Enviado",
  "Retirado",
  "Removido",
  "Desistiu",
  "Abandonou",
  "Resolvido",
  "Retirar",
]);

function isOpen(p: { situation: string; financialStatus: string }): boolean {
  if (p.financialStatus === "MGMV") return false;
  return !RESOLVED_SITUATIONS.has(p.situation);
}

function isOverdue(iso: string | null | undefined, now: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t < now;
}

function paidAmountOf(i: SlimInstallment): number {
  return Math.max(0, i.paidAmount ?? (i.paid ? i.value : 0));
}

function bucketKeyFor(date: Date, granularity: "day" | "month" | "year") {
  if (granularity === "day") {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return {
      key,
      label: date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    };
  }
  if (granularity === "month") {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    return { key, label: date.toLocaleString("pt-BR", { month: "short" }).replace(".", "") };
  }
  const key = String(date.getFullYear());
  return { key, label: key };
}

function buildTimeline(
  products: SlimProduct[],
  clients: SlimClient[],
  mode: TimelineMode,
  now: Date,
): TimelineBucket[] {
  const nowMs = now.getTime();
  const clientById = new Map(clients.map((c) => [c.id, c]));
  let granularity: "day" | "month" | "year";
  const buckets: TimelineBucket[] = [];
  const idx = new Map<string, number>();

  const push = (d: Date) => {
    const { key, label } = bucketKeyFor(d, granularity);
    if (idx.has(key)) return;
    idx.set(key, buckets.length);
    buckets.push({ key, label, registrado: 0, recebido: 0, aReceber: 0, inadimplencia: 0 });
  };

  if (mode === "7d" || mode === "30d") {
    granularity = "day";
    const days = mode === "7d" ? 7 : 30;
    for (let i = days - 1; i >= 0; i--) {
      push(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
    }
  } else if (mode === "6m" || mode === "12m") {
    granularity = "month";
    const months = mode === "6m" ? 6 : 12;
    for (let i = months - 1; i >= 0; i--) push(new Date(now.getFullYear(), now.getMonth() - i, 1));
  } else {
    granularity = "year";
    let earliest = now.getFullYear();
    for (const p of products) {
      const d = new Date(p.registerDate || p.dueDate || now);
      if (!Number.isNaN(d.getTime())) earliest = Math.min(earliest, d.getFullYear());
    }
    for (const c of clients) {
      if (!c.mgmv) continue;
      const d = new Date(c.mgmv.startDate || now);
      if (!Number.isNaN(d.getTime())) earliest = Math.min(earliest, d.getFullYear());
    }
    // Limite defensivo: no máximo 30 pontos no gráfico.
    earliest = Math.max(earliest, now.getFullYear() - 29);
    for (let y = earliest; y <= now.getFullYear(); y++) push(new Date(y, 0, 1));
  }

  const bucketOf = (d: Date) => idx.get(bucketKeyFor(d, granularity).key);

  for (const p of products) {
    const owner = clientById.get(p.clientId);
    if (owner?.mgmv && p.financialStatus === "MGMV") continue;

    const reg = new Date(p.registerDate || p.dueDate || 0);
    if (!Number.isNaN(reg.getTime())) {
      const i = bucketOf(reg);
      if (i !== undefined) {
        buckets[i].registrado += p.totalValue;
        buckets[i].recebido += p.paidValue;
      }
    }
    const saldo = Math.max(0, p.totalValue - p.paidValue);
    if (saldo > 0 && p.financialStatus !== "Pago" && isOpen(p)) {
      const due = new Date(p.dueDate || 0);
      if (!Number.isNaN(due.getTime())) {
        const i = bucketOf(due);
        if (i !== undefined) {
          buckets[i].aReceber += saldo;
          if (isOverdue(p.dueDate, nowMs)) buckets[i].inadimplencia += saldo;
        }
      }
    }
  }

  for (const c of clients) {
    if (!c.mgmv) continue;
    const start = new Date(c.mgmv.startDate || 0);
    if (!Number.isNaN(start.getTime())) {
      const i = bucketOf(start);
      if (i !== undefined) buckets[i].registrado += c.mgmv.totalDebt;
    }
    for (const inst of c.mgmv.installments) {
      const paidAmt = paidAmountOf(inst);
      if (paidAmt > 0) {
        const pd = new Date(inst.paidAt || inst.dueDate || 0);
        if (!Number.isNaN(pd.getTime())) {
          const i = bucketOf(pd);
          if (i !== undefined) buckets[i].recebido += paidAmt;
        }
      }
      const rem = Math.max(0, inst.value - paidAmt);
      if (!inst.paid && rem > 0) {
        const due = new Date(inst.dueDate || 0);
        if (!Number.isNaN(due.getTime())) {
          const i = bucketOf(due);
          if (i !== undefined) {
            buckets[i].aReceber += rem;
            if (isOverdue(inst.dueDate, nowMs)) buckets[i].inadimplencia += rem;
          }
        }
      }
    }
  }

  return buckets;
}

const PAGE = 1000;

export const getFinanceAggregates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FinanceAggregates> => {
    const { supabase } = context;
    const now = new Date();
    const nowMs = now.getTime();

    // --- leitura enxuta (só as colunas usadas nos cálculos) -----------------
    const clients: SlimClient[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, mgmv")
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      for (const r of rows) {
        const raw = r.mgmv as
          | { totalDebt?: number; startDate?: string; installments?: SlimInstallment[] }
          | null;
        clients.push({
          id: r.id,
          name: r.name ?? "Cliente",
          mgmv: raw
            ? {
                totalDebt: Math.max(0, Number(raw.totalDebt) || 0),
                startDate: raw.startDate ?? null,
                installments: (raw.installments ?? []).map((i) => ({
                  dueDate: i.dueDate,
                  value: Number(i.value) || 0,
                  paid: Boolean(i.paid),
                  paidAt: i.paidAt,
                  paidAmount: i.paidAmount === undefined ? undefined : Number(i.paidAmount),
                })),
              }
            : null,
        });
      }
      if (rows.length < PAGE) break;
    }

    const products: SlimProduct[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("products")
        .select(
          "client_id, platform, total_value, paid_value, financial_status, situation, register_date, due_date",
        )
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      for (const r of rows) {
        products.push({
          clientId: r.client_id,
          platform: r.platform || "Outros",
          totalValue: Math.max(0, Number(r.total_value) || 0),
          paidValue: Math.max(0, Number(r.paid_value) || 0),
          financialStatus: r.financial_status || "Pendente",
          situation: r.situation || "Em Aberto",
          registerDate: r.register_date,
          dueDate: r.due_date,
        });
      }
      if (rows.length < PAGE) break;
    }

    // --- agregação por cliente (mesma regra de calculateClientFinancialSummary)
    const byClient = new Map<string, SlimProduct[]>();
    for (const p of products) {
      const list = byClient.get(p.clientId);
      if (list) list.push(p);
      else byClient.set(p.clientId, [p]);
    }

    let total = 0;
    let received = 0;
    let openTotal = 0;
    let overdueValue = 0;
    let overdueCount = 0;
    let mgmvTotal = 0;
    let mgmvPaid = 0;
    let agreementPlatformTotal = 0;
    const debtors: FinanceTopClient[] = [];
    const buyers: FinanceTopClient[] = [];

    for (const c of clients) {
      const list = byClient.get(c.id) ?? [];
      let purchased = 0;
      let paid = 0;
      let remaining = 0;
      let cOverdueValue = 0;
      let eligible = true;

      for (const p of list) {
        if (c.mgmv && p.financialStatus === "MGMV") continue;
        purchased += p.totalValue;
        paid += p.paidValue;
        const rem = Math.max(0, p.totalValue - p.paidValue);
        if (rem > 0 && p.financialStatus !== "Pago" && isOpen(p)) {
          remaining += rem;
          if (isOverdue(p.dueDate, nowMs)) {
            cOverdueValue += rem;
            overdueCount += 1;
          }
        }
        if (
          p.situation === "Desistiu" ||
          p.situation === "Abandonou" ||
          p.situation === "Removido" ||
          p.financialStatus === "Pendente" ||
          (p.financialStatus === "Reserva" && isOpen(p) && isOverdue(p.dueDate, nowMs))
        ) {
          eligible = false;
        }
      }

      if (c.mgmv) {
        mgmvTotal += c.mgmv.totalDebt;
        agreementPlatformTotal += c.mgmv.totalDebt;
        purchased += c.mgmv.totalDebt;
        for (const inst of c.mgmv.installments) {
          const p = paidAmountOf(inst);
          mgmvPaid += p;
          paid += p;
          if (inst.paid) continue;
          const rem = Math.max(0, inst.value - p);
          if (rem <= 0) continue;
          remaining += rem;
          if (isOverdue(inst.dueDate, nowMs)) {
            cOverdueValue += rem;
            overdueCount += 1;
            eligible = false;
          }
        }
      }

      total += purchased;
      received += paid;
      openTotal += remaining;
      overdueValue += cOverdueValue;

      if (remaining > 0) {
        debtors.push({ clientId: c.id, name: c.name, isMgmv: Boolean(c.mgmv), value: remaining });
      }
      if (
        eligible &&
        remaining === 0 &&
        cOverdueValue === 0 &&
        purchased > 0 &&
        (list.length > 0 || c.mgmv)
      ) {
        buyers.push({ clientId: c.id, name: c.name, isMgmv: Boolean(c.mgmv), value: purchased });
      }
    }

    // --- distribuições -------------------------------------------------------
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const financeProducts = products.filter((p) => {
      const owner = clientById.get(p.clientId);
      return !(owner?.mgmv && p.financialStatus === "MGMV");
    });

    const byStatus: Record<string, { count: number; value: number }> = {};
    for (const p of financeProducts) {
      const k = p.financialStatus || "Pendente";
      byStatus[k] ??= { count: 0, value: 0 };
      byStatus[k].count += 1;
      byStatus[k].value += p.totalValue;
    }
    for (const c of clients) {
      if (!c.mgmv) continue;
      byStatus.MGMV ??= { count: 0, value: 0 };
      byStatus.MGMV.count += 1;
      byStatus.MGMV.value += c.mgmv.totalDebt;
    }

    const byPlatform: Record<string, number> = {};
    for (const p of financeProducts) {
      byPlatform[p.platform] = (byPlatform[p.platform] || 0) + p.totalValue;
    }
    if (agreementPlatformTotal > 0) {
      byPlatform.MGMV = (byPlatform.MGMV || 0) + agreementPlatformTotal;
    }

    const modes: TimelineMode[] = ["7d", "30d", "6m", "12m", "all"];
    const timelines = Object.fromEntries(
      modes.map((m) => [m, buildTimeline(products, clients, m, now)]),
    ) as Record<TimelineMode, TimelineBucket[]>;

    return {
      total,
      received,
      open: openTotal,
      receivedPct: total > 0 ? (received / total) * 100 : 0,
      statusData: Object.entries(byStatus).map(([name, v]) => ({
        name,
        value: v.value,
        count: v.count,
      })),
      platforms: Object.entries(byPlatform)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5),
      topDebtors: debtors.sort((a, b) => b.value - a.value).slice(0, 6),
      topBuyers: buyers.sort((a, b) => b.value - a.value).slice(0, 6),
      mgmvTotal,
      mgmvPaid,
      overdueValue,
      overdueCount,
      ticket: products.length > 0 ? total / products.length : 0,
      activeClients: clients.length,
      productsCount: products.length,
      timelines,
      generatedAt: now.toISOString(),
    };
  });
