import { create } from "zustand";
import {
  dbDeleteAllClientsAsync,
  dbDeleteAllProductsAsync,
  dbDeleteAllMGMVAsync,
  dbDeleteAllTeamAsync,
  dbDeleteAllImportProgressAsync,
  clearImportRuntimeState,
  dbDeleteHistoryAllAsync,
  dbInsertHistory,
  dbUpsertClientsAsync,
  dbUpsertHistoryAsync,
  dbUpsertProductsAsync,
  dbSaveSettings,
  flushUiStateNow,
  queueClientUpsert,
  queueProductUpsert,
  loadSnapshot,
  migrateLocalStorageOnce,
  primeUiState,
  getUiValue,
  setUiValue,
  dbSyncAgreementForClient,
  dbSyncAgreementForClientAsync,
  dbInsertMgmvReviewAuditLog,
  dbSyncAgreementsBulkAsync,
  dbFetchDiagnostics,
  dbReassignProductsClientAsync,
  dbReassignAgreementClientAsync,
  dbDeleteClientsByIdsAsync,
} from "./db-sync";
import type { ImportDiagnostics } from "./db-sync";
export type { ImportDiagnostics } from "./db-sync";
import { recalcPendingDueDates } from "./mgmv-schedule";

export type FinancialStatus = "Pago" | "Reserva" | "Pendente" | "MGMV";

/**
 * Resultado do registro de pagamento parcial em uma parcela MGMV.
 * Sucesso inclui `becameQuitado` para o caller decidir toasts/refresh.
 */
export type PartialPaymentResult =
  | { ok: true; becameQuitado: boolean }
  | { ok: false; error: string };

/**
 * Resultado da distribuição pura de um pagamento parcial sobre uma lista de
 * parcelas. Não faz side effects — usado tanto pelo store quanto pelos testes.
 */
export type ApplyPartialPaymentResult =
  | {
      ok: true;
      installments: MGMVInstallment[];
      becameQuitado: boolean;
      targetFullyPaid: boolean;
      /** Números das parcelas cujo `value` foi recalculado (redistribuído). */
      recalculatedNumbers: number[];
    }
  | { ok: false; error: string };

/**
 * Aplica um pagamento parcial a uma parcela do acordo MGMV, redistribuindo
 * o excedente/faltante entre as outras parcelas pendentes. Regras:
 *
 * - Valida `amount` (finito, > 0) e que não exceda o saldo restante do acordo
 *   (tolerância de 1 centavo para arredondamentos de exibição).
 * - `value` da parcela alvo NUNCA é alterado — preservado como histórico.
 * - Se o pagamento é >= `value`, ela vira `paid=true` e o `newRemaining`
 *   (saldo do acordo) é RATEADO entre as demais pendentes (pode reduzir
 *   quando há excedente).
 * - Se o pagamento é MENOR que `value` (quitação curta), a alvo vira
 *   `paid=true` com `paidAmount=amount` e `shortPaid=true`. O restante
 *   `value − amount` é SOMADO (acréscimo) igualmente entre as demais
 *   pendentes — nunca gera desconto.
 * - Nenhuma parcela redistribuída pode ficar com `value` menor que seu
 *   `paidAmount` já registrado (evita saldo negativo em parcial pré-existente).
 *   Se isso aconteceria, o `value` é preservado no piso `paidAmount`.
 * - Marca `recalculatedAt` em toda parcela pendente cujo `value` mudou.
 */
export function applyMGMVPartialPayment(
  installments: MGMVInstallment[],
  installmentNumber: number,
  amount: number,
  agreementRemaining: number,
  nowIso: string = new Date().toISOString(),
): ApplyPartialPaymentResult {
  if (!Number.isFinite(amount)) {
    return { ok: false, error: "Informe um valor numérico válido." };
  }
  if (amount <= 0) {
    return { ok: false, error: "Informe um valor maior que zero." };
  }
  const target = installments.find((i) => i.number === installmentNumber);
  if (!target) {
    return { ok: false, error: `Parcela ${installmentNumber} não encontrada.` };
  }
  if (target.paid) {
    return { ok: false, error: `Parcela ${installmentNumber} já está paga.` };
  }
  if (!Number.isFinite(agreementRemaining) || agreementRemaining < 0) {
    return { ok: false, error: "Saldo restante do acordo inválido." };
  }
  if (amount > agreementRemaining + 0.01) {
    return {
      ok: false,
      error: `Valor excede o restante do acordo (${formatBRL(agreementRemaining)}).`,
    };
  }

  const prevRemainingCents = Math.round(agreementRemaining * 100);
  const amountCents = Math.round(amount * 100);
  const newRemainingCents = Math.max(0, prevRemainingCents - amountCents);
  const prevPaid = target.paidAmount ?? 0;
  const paidPartialTargetNew = prevPaid + amount;
  const targetFullyPaid = paidPartialTargetNew >= target.value - 0.005;

  const recalculated: number[] = [];
  let next: MGMVInstallment[];

  if (targetFullyPaid) {
    next = installments.map((i) =>
      i.number === installmentNumber
        ? { ...i, paid: true, paidAt: nowIso, paidAmount: target.value }
        : i,
    );
    const otherPending = next.filter(
      (i) => !i.paid && i.number !== installmentNumber,
    );
    if (otherPending.length > 0) {
      const base = Math.floor(newRemainingCents / otherPending.length);
      const rest = newRemainingCents - base * otherPending.length;
      const lastOtherNumber = otherPending[otherPending.length - 1].number;
      next = next.map((i) => {
        if (i.paid) return i;
        if (i.number === installmentNumber) return i;
        const cents = i.number === lastOtherNumber ? base + rest : base;
        const rawValue = Math.max(0, cents / 100);
        // Nunca deixar `value` abaixo do parcial já pago da própria parcela.
        const floorPaid = Math.max(0, i.paidAmount ?? 0);
        const newValue = Math.max(rawValue, floorPaid);
        if (Math.abs(newValue - i.value) > 0.005) {
          recalculated.push(i.number);
          return { ...i, value: newValue, recalculatedAt: nowIso };
        }
        return i;
      });
    }
  } else {
    // Pagamento parcial CURTO: alvo é quitada com o valor recebido,
    // e o "que sobrou" da parcela (value − amount) é SOMADO nas outras
    // pendentes de forma igual (nunca desconta).
    const targetValueCents = Math.round(target.value * 100);
    const shortfallCents = Math.max(0, targetValueCents - amountCents);
    const otherPending = installments.filter(
      (i) => !i.paid && i.number !== installmentNumber,
    );
    if (otherPending.length > 0 && shortfallCents > 0) {
      const addBase = Math.floor(shortfallCents / otherPending.length);
      const addRest = shortfallCents - addBase * otherPending.length;
      const lastOtherNumber = otherPending[otherPending.length - 1].number;
      next = installments.map((i) => {
        if (i.paid) return i;
        if (i.number === installmentNumber) {
          return {
            ...i,
            paid: true,
            paidAt: nowIso,
            paidAmount: amount,
            manualPartial: true,
            shortPaid: true,
          };
        }
        const addCents = i.number === lastOtherNumber ? addBase + addRest : addBase;
        const currentCents = Math.round(i.value * 100);
        const newCents = currentCents + addCents;
        const rawValue = Math.max(0, newCents / 100);
        const floorPaid = Math.max(0, i.paidAmount ?? 0);
        const newValue = Math.max(rawValue, floorPaid);
        if (Math.abs(newValue - i.value) > 0.005) {
          recalculated.push(i.number);
          return { ...i, value: newValue, recalculatedAt: nowIso };
        }
        return i;
      });
    } else {
      // Sem outras pendentes (ou sem shortfall): alvo vira paga curta.
      next = installments.map((i) =>
        i.number === installmentNumber
          ? {
              ...i,
              paid: true,
              paidAt: nowIso,
              paidAmount: amount,
              manualPartial: true,
              shortPaid: shortfallCents > 0,
            }
          : i,
      );
    }
  }

  const becameQuitado = next.every((i) => i.paid);
  return {
    ok: true,
    installments: next,
    becameQuitado,
    targetFullyPaid,
    recalculatedNumbers: recalculated,
  };
}

export type Situation =
  | "Em Aberto"
  | "Enviado"
  | "Retirado"
  | "Retirar"
  | "Removido"
  | "Desistiu"
  | "Abandonou"
  | "Resolvido";

export interface MGMVInstallment {
  number: number;
  total: number;
  dueDate: string;
  value: number;
  paid: boolean;
  paidAt?: string;
  /**
   * Valor efetivamente pago desta parcela. Quando ausente, assume-se
   * `value` se `paid=true`, ou 0 se `paid=false`. Quando presente e menor
   * que `value`, representa um pagamento parcial (parcela permanece
   * pendente até a soma atingir `value`).
   */
  paidAmount?: number;
  /**
   * Marcado como `true` somente quando o pagamento parcial foi registrado
   * manualmente pelo botão "Pagamento parcial" (popover). Não é setado
   * quando o parcial vem da revisão da IA. Usado para ocultar os botões
   * de ação da parcela nesse caso específico.
   */
  manualPartial?: boolean;
  /**
   * ISO da última vez em que o `value` desta parcela foi recalculado por
   * redistribuição — ou seja, alterado como consequência de um pagamento
   * (parcial ou total) em OUTRA parcela do mesmo acordo. Serve apenas para
   * exibir uma marcação visual ("Recalculada") na tabela de parcelas, sem
   * afetar cálculos financeiros.
   */
  recalculatedAt?: string;
  /**
   * Marcado como `true` quando a parcela foi encerrada com pagamento parcial
   * INFERIOR ao seu valor (quitação curta): `paid=true`, `paidAmount < value`.
   * O restante (`value − paidAmount`) foi somado às outras parcelas pendentes
   * na hora do registro. Serve apenas para a UI indicar "Paga (parcial curto)".
   */
  shortPaid?: boolean;
}

export interface MGMVAgreement {
  startDate: string;
  totalDebt: number;
  installments: MGMVInstallment[];
  /**
   * Status de revisão do acordo MGMV. É SEPARADO do status financeiro
   * (Ativo / Em atraso / Quitado / Cancelado). Definido por:
   *  - "review_required": parser detectou divergência / dado faltando.
   *  - "ai_reviewed": usuário aplicou sugestão da IA com validação matemática
   *     ok (ou confirmou manualmente mesmo com aviso).
   *  - "manually_reviewed": usuário ajustou o acordo manualmente.
   *  - "none": sem pendência de revisão.
   */
  reviewStatus?: "none" | "review_required" | "ai_reviewed" | "manually_reviewed";
  /** True quando a sugestão da IA foi aplicada ao acordo. */
  aiReviewed?: boolean;
  /** ISO da aplicação da sugestão da IA. */
  aiReviewAppliedAt?: string;
  /** Confiança 0..1 retornada pela IA na última aplicação. */
  aiConfidence?: number;
  /** Resultado bruto retornado pela IA (preservado para auditoria). */
  aiReviewRawResult?: unknown;
}

export interface Product {
  id: string;
  clientId: string;
  name: string;
  platform: string;
  totalValue: number;
  paidValue: number;
  financialStatus: FinancialStatus;
  situation: Situation;
  registerDate: string; // ISO
  dueDate: string; // ISO
  notes?: string;
}

function parseDateOnlyTime(value: string): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const parsed = dateOnly
    ? new Date(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T12:00:00`).getTime()
    : new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculateReservaDueDate(registerDate: string): string {
  const registerTime = parseDateOnlyTime(registerDate) ?? Date.now();
  const register = new Date(registerTime);
  const due = new Date(register);
  const originalDay = register.getDate();
  due.setMonth(due.getMonth() + 1);
  if (due.getDate() !== originalDay) {
    due.setDate(0);
  }
  return due.toISOString();
}

export function normalizeProductDueDateForCreate(
  product: Omit<Product, "id">,
): Omit<Product, "id"> {
  if (product.financialStatus !== "Reserva") return product;
  // Regra: Reserva NUNCA pode nascer com dueDate <= registerDate. Se o
  // chamador informou um dueDate estritamente maior que o cadastro
  // (ex.: "Data Limite" do cabeçalho da lista colada), preservamos esse
  // valor. Caso contrário, força cadastro + 1 mês.
  const registerTime = parseDateOnlyTime(product.registerDate);
  const providedTime = product.dueDate ? parseDateOnlyTime(product.dueDate) : null;
  if (registerTime !== null && providedTime !== null && providedTime > registerTime) {
    return product;
  }
  return { ...product, dueDate: calculateReservaDueDate(product.registerDate) };
}

export interface Client {
  id: string;
  name: string;
  phone: string;
  notes?: string;
  /** Dados completos do cliente em texto livre (CPF, endereço, etc.). */
  customerData?: string;
  mgmv?: MGMVAgreement;
  /** Pasta de origem (ex.: Notion ZIP) — usada para filtro/agrupamento. */
  folder?: string;
  /**
   * Classificação automática do importador.
   * - "common": cliente comum (Seção Clientes)
   * - "mgmv": cliente MGMV (Seção MGMV)
   * Default = "common". Migrado automaticamente para "mgmv" quando o cliente
   * recebe um acordo MGMV ativo.
   */
  clientType?: "common" | "mgmv";
  /** Nome do arquivo HTML original importado do Notion (auditoria). */
  originalHtmlFileName?: string;
  /** Caminho no bucket privado `notion-html-originals`. */
  originalHtmlStoragePath?: string;
  /** Momento em que o HTML original foi importado (ISO). */
  originalHtmlImportedAt?: string;
  /** Pasta de origem no ZIP importado. */
  originalHtmlSourceFolder?: string;
  /** SHA-1 do HTML original, para detectar duplicidade. */
  originalHtmlChecksum?: string;
}

export interface SystemPreferences {
  companyName: string;
  currency: "BRL" | "USD" | "EUR";
  dateFormat: "DD/MM/AAAA" | "AAAA-MM-DD";
  compactTables: boolean;
  showDashboardAlerts: boolean;
  theme: "light" | "dark" | "system";
}

export interface OperationalRules {
  reservaDaysDefault: number;
  blockReserveOnActiveMGMV: boolean;
  hideDesistenciasFromCollection: boolean;
  hideAbandonosFromCollection: boolean;
  autoCalculateReservaDueDate: boolean;
  treatOverduePendenteAsDelinquent: boolean;
}

export interface SecuritySettings {
  requireConfirmBeforeDelete: boolean;
  blockMassDeleteWithoutPassword: boolean;
  enableAuditLog: boolean;
}

export type ImportSource = "HTML Notion" | "CSV" | "Excel" | "Texto";
export type ImportStatus = "Concluído" | "Com avisos" | "Erro" | "Cancelado";

export interface ImportHistoryEntry {
  id: string;
  date: string; // ISO
  source: ImportSource;
  file: string;
  clientsCreated: number;
  productsAdded: number;
  errors: number;
  status: ImportStatus;
  /** sha1 do conteúdo do arquivo, para detectar re-importação. */
  fileHash?: string;
  /** Acordos MGMV aplicados nesta importação. */
  agreementsCreated?: number;
  /** Acordos MGMV existentes substituídos por decisão do operador. */
  agreementsReplaced?: number;
  /** Produtos ignorados por já existirem (duplicatas). */
  skippedDuplicates?: number;
  /** Tempo total da operação em ms. */
  durationMs?: number;
}

export type DangerAction =
  | "deleteImportedData"
  | "deleteAllClients"
  | "deleteAllProducts"
  | "resetSystem";

interface State {
  clients: Client[];
  products: Product[];
  openClientId: string | null;
  preferences: SystemPreferences;
  rules: OperationalRules;
  security: SecuritySettings;
  importHistory: ImportHistoryEntry[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  refreshFromDb: () => Promise<void>;
  reset: () => void;
  openClient: (id: string | null) => void;
  addClient: (c: Omit<Client, "id">) => Client;
  updateClient: (id: string, patch: Partial<Omit<Client, "id">>) => void;
  deleteClient: (id: string) => Promise<void>;
  findClientByPhone: (phone: string) => Client | undefined;
  addProduct: (p: Omit<Product, "id">) => void;
  updateProduct: (id: string, patch: Partial<Omit<Product, "id">>) => void;
  registerPayment: (productId: string, amount: number) => void;
  markResolved: (productId: string) => void;
  setProductSituation: (productId: string, situation: Situation) => void;
  updateProductNotes: (productId: string, notes: string) => void;
  updateClientNotes: (clientId: string, notes: string) => void;
  payMGMVInstallment: (clientId: string, installmentNumber: number) => void;
  /**
   * Registra um pagamento parcial em uma parcela MGMV.
   * - amount >= installment.value → marca paga integralmente; excedente reduz
   *   o valor da próxima parcela pendente (mesmo comportamento aplicado por IA).
   * - 0 < amount < installment.value → grava paidAmount (parcela segue pendente).
   */
  registerMGMVPartialPayment: (
    clientId: string,
    installmentNumber: number,
    amount: number,
  ) => PartialPaymentResult;
  setMGMVAgreement: (clientId: string, agreement: MGMVAgreement | undefined) => void;
  applyAiReviewToAgreement: (
    clientId: string,
    nextAgreement: MGMVAgreement,
    meta: {
      confidence: number;
      rawResult: unknown;
      mathOk: boolean;
      confirmedWithConflict?: boolean;
    },
  ) => Promise<void>;
  setPreferences: (patch: Partial<SystemPreferences>) => void;
  setRules: (patch: Partial<OperationalRules>) => void;
  setSecurity: (patch: Partial<SecuritySettings>) => void;
  addImportHistory: (entry: Omit<ImportHistoryEntry, "id" | "date"> & { date?: string }) => void;
  persistConfirmedImport: (payload: {
    clients: Client[];
    products: Product[];
    history: ImportHistoryEntry;
  }) => Promise<void>;
  executeDangerAction: (action: DangerAction) => Promise<void>;
  fetchDiagnostics: () => Promise<ImportDiagnostics>;
  clearImportCache: () => void;
  refreshSnapshot: () => Promise<void>;
  findDuplicateClientGroups: () => DuplicateClientGroup[];
  mergeDuplicateClients: () => Promise<MergeDuplicatesResult>;
}

export interface DuplicateClientGroup {
  key: string;
  primaryId: string;
  duplicateIds: string[];
  name: string;
  phone: string;
  productsToReassign: number;
}

export interface MergeDuplicatesResult {
  groups: number;
  removed: number;
  reassignedProducts: number;
}

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Identifica grupos de clientes duplicados (mesmo telefone normalizado, ou
 * mesmo nome normalizado quando o telefone é vazio). Para cada grupo, elege
 * um primário (com MGMV → mais produtos → menor id).
 */
export function computeDuplicateGroups(
  clients: Client[],
  products: Product[],
): DuplicateClientGroup[] {
  const productsByClient = new Map<string, number>();
  for (const p of products) {
    productsByClient.set(p.clientId, (productsByClient.get(p.clientId) ?? 0) + 1);
  }

  const normPhone = (s: string) => s.replace(/\D/g, "");
  const normName = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const buckets = new Map<string, Client[]>();
  for (const c of clients) {
    const phone = normPhone(c.phone ?? "");
    const key = phone ? `p:${phone}` : `n:${normName(c.name ?? "")}`;
    if (!key || key === "p:" || key === "n:") continue;
    const arr = buckets.get(key) ?? [];
    arr.push(c);
    buckets.set(key, arr);
  }

  const groups: DuplicateClientGroup[] = [];
  for (const [key, list] of buckets) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => {
      const am = a.mgmv ? 1 : 0;
      const bm = b.mgmv ? 1 : 0;
      if (am !== bm) return bm - am;
      const ap = productsByClient.get(a.id) ?? 0;
      const bp = productsByClient.get(b.id) ?? 0;
      if (ap !== bp) return bp - ap;
      return a.id.localeCompare(b.id);
    });
    const [primary, ...rest] = sorted;
    groups.push({
      key,
      primaryId: primary.id,
      duplicateIds: rest.map((c) => c.id),
      name: primary.name,
      phone: primary.phone,
      productsToReassign: rest.reduce(
        (s, c) => s + (productsByClient.get(c.id) ?? 0),
        0,
      ),
    });
  }
  return groups;
}

/**
 * Regra única de status financeiro com base nos valores.
 * - Pago: valorPago >= valorTotal (e total > 0)
 * - Reserva: valorPago > 0 && valorPago < valorTotal
 * - Pendente: caso contrário (sem entrada)
 * MGMV é tratado fora desta função (fluxo separado).
 */
export function calculateFinancialStatus(
  totalValue: number | null | undefined,
  paidValue: number | null | undefined,
): FinancialStatus {
  const total = Number(totalValue) || 0;
  const paid = Number(paidValue) || 0;
  if (total > 0 && paid >= total) return "Pago";
  if (paid > 0 && paid < total) return "Reserva";
  return "Pendente";
}

/**
 * Migração v3 do store persistido: recalcula `financialStatus` de todos os
 * produtos a partir de `totalValue` e `paidValue`, preservando MGMV.
 * Exportado para permitir testes unitários da regra.
 */
export function migrateStoreV3(persisted: unknown): unknown {
  const state = persisted as Partial<State> | undefined;
  if (state && Array.isArray(state.products)) {
    state.products = state.products.map((p) => ({
      ...p,
      financialStatus:
        p.financialStatus === "MGMV"
          ? "MGMV"
          : calculateFinancialStatus(p.totalValue, p.paidValue),
    }));
  }
  return state;
}

const defaultPreferences: SystemPreferences = {
  companyName: "Star Games",
  currency: "BRL",
  dateFormat: "DD/MM/AAAA",
  compactTables: false,
  showDashboardAlerts: true,
  theme: "system",
};

const defaultRules: OperationalRules = {
  reservaDaysDefault: 30,
  blockReserveOnActiveMGMV: true,
  hideDesistenciasFromCollection: true,
  hideAbandonosFromCollection: true,
  autoCalculateReservaDueDate: true,
  treatOverduePendenteAsDelinquent: true,
};

const defaultSecurity: SecuritySettings = {
  requireConfirmBeforeDelete: true,
  blockMassDeleteWithoutPassword: true,
  enableAuditLog: false,
};

let hydratePromise: Promise<void> | null = null;
// Coalescência de refreshes do snapshot (Realtime, app:reset, modais).
let refreshInFlight: Promise<void> | null = null;
let refreshQueued = false;

export const RESET_VERSION_KEY = "import.resetVersion";
export function getResetVersion(): string {
  return getUiValue<string>(RESET_VERSION_KEY, "");
}
function bumpResetVersion() {
  const version = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  setUiValue(RESET_VERSION_KEY, version);
  return version;
}

export const useStore = create<State>()((set, get) => ({
      clients: [],
      products: [],
      openClientId: null,
      preferences: defaultPreferences,
      rules: defaultRules,
      security: defaultSecurity,
      importHistory: [],
      hydrated: false,
      hydrate: async () => {
        if (get().hydrated) return;
        if (hydratePromise) return hydratePromise;
        hydratePromise = (async () => {
          let snap = await loadSnapshot();
          snap = await migrateLocalStorageOnce(snap);
          primeUiState(snap.uiState);
          if (!getResetVersion()) {
            bumpResetVersion();
            void flushUiStateNow();
          }
          set({
            clients: snap.clients,
            products: snap.products.map((p) =>
              // Fix retroativo: produtos que já foram consolidados em MGMV
              // não devem permanecer com situation "Em Aberto" (causava dupla
              // cobrança e inflação em "Valores a Receber").
              p.financialStatus === "MGMV" && p.situation === "Em Aberto"
                ? { ...p, situation: "Resolvido" as Situation }
                : p,
            ),
            importHistory: snap.importHistory,
            preferences: { ...defaultPreferences, ...snap.preferences },
            rules: { ...defaultRules, ...snap.rules },
            security: { ...defaultSecurity, ...snap.security },
            hydrated: true,
          });
        })();
        await hydratePromise;
      },
      refreshFromDb: async () => {
        // Coalesce: chamadas concorrentes (Realtime + app:reset + modais)
        // compartilham o mesmo `loadSnapshot()` em voo; se algo chegar
        // durante o fetch, agenda exatamente UM refresh extra ao final.
        if (refreshInFlight) {
          refreshQueued = true;
          return refreshInFlight;
        }
        refreshInFlight = (async () => {
          try {
            const snap = await loadSnapshot();
            set({
              clients: snap.clients,
              products: snap.products.map((p) =>
                p.financialStatus === "MGMV" && p.situation === "Em Aberto"
                  ? { ...p, situation: "Resolvido" as Situation }
                  : p,
              ),
              importHistory: snap.importHistory,
            });
          } catch (err) {
            console.warn("refreshFromDb failed", err);
          } finally {
            refreshInFlight = null;
          }
          if (refreshQueued) {
            refreshQueued = false;
            await get().refreshFromDb();
          }
        })();
        await refreshInFlight;
      },
      reset: () => {
        hydratePromise = null;
        set({
          clients: [],
          products: [],
          importHistory: [],
          preferences: defaultPreferences,
          rules: defaultRules,
          security: defaultSecurity,
          openClientId: null,
          hydrated: false,
        });
      },
      openClient: (id) => set({ openClientId: id }),
      addClient: (c) => {
        const client = { ...c, id: uid() };
        set((s) => ({ clients: [...s.clients, client] }));
        queueClientUpsert(client);
        return client;
      },
      updateClient: (id, patch) =>
        set((s) => {
          const clients = s.clients.map((c) => (c.id === id ? { ...c, ...patch } : c));
          const updated = clients.find((c) => c.id === id);
          if (updated) queueClientUpsert(updated);
          return { clients };
        }),
      deleteClient: async (id) => {
        // Remove do estado local imediatamente: cliente, produtos vinculados,
        // acordo MGMV e a referência aberta. O banco cascateia produtos e
        // mgmv_agreements via FK ON DELETE CASCADE.
        set((s) => ({
          clients: s.clients.filter((c) => c.id !== id),
          products: s.products.filter((p) => p.clientId !== id),
          openClientId: s.openClientId === id ? null : s.openClientId,
        }));
        try {
          await dbDeleteClientsByIdsAsync([id]);
        } catch (err) {
          console.error("deleteClient failed", err);
          throw err;
        }
      },
      findClientByPhone: (phone) =>
        get().clients.find((c) => c.phone.replace(/\D/g, "") === phone.replace(/\D/g, "")),
      addProduct: (p) =>
        set((s) => {
          const prod = { ...normalizeProductDueDateForCreate(p), id: uid() };
          queueProductUpsert(prod);
          return { products: [...s.products, prod] };
        }),
      updateProduct: (id, patch) =>
        set((s) => {
          const products = s.products.map((p) => (p.id === id ? { ...p, ...patch } : p));
          const updated = products.find((p) => p.id === id);
          if (updated) queueProductUpsert(updated);
          return { products };
        }),
      registerPayment: (productId, amount) =>
        set((s) => {
          const products = s.products.map((p) => {
            if (p.id !== productId) return p;
            const paidValue = Math.min(p.totalValue, p.paidValue + amount);
            const nextStatus =
              p.financialStatus === "MGMV"
                ? "MGMV"
                : calculateFinancialStatus(p.totalValue, paidValue);
            return { ...p, paidValue, financialStatus: nextStatus };
          });
          const updated = products.find((p) => p.id === productId);
          if (updated) queueProductUpsert(updated);
          return { products };
        }),
      markResolved: (productId) =>
        set((s) => {
          const products = s.products.map((p) =>
            p.id === productId ? { ...p, situation: "Resolvido" as Situation } : p,
          );
          const updated = products.find((p) => p.id === productId);
          if (updated) queueProductUpsert(updated);
          return { products };
        }),
      setProductSituation: (productId, situation) =>
        set((s) => {
          const products = s.products.map((p) =>
            p.id === productId ? { ...p, situation } : p,
          );
          const updated = products.find((p) => p.id === productId);
          if (updated) queueProductUpsert(updated);
          return { products };
        }),
      updateProductNotes: (productId, notes) =>
        set((s) => {
          const products = s.products.map((p) => (p.id === productId ? { ...p, notes } : p));
          const updated = products.find((p) => p.id === productId);
          if (updated) queueProductUpsert(updated);
          return { products };
        }),
      updateClientNotes: (clientId, notes) =>
        set((s) => {
          const clients = s.clients.map((c) => (c.id === clientId ? { ...c, notes } : c));
          const updated = clients.find((c) => c.id === clientId);
          if (updated) queueClientUpsert(updated);
          return { clients };
        }),
      payMGMVInstallment: (clientId, installmentNumber) =>
        set((s) => {
          const clients = s.clients.map((c) => {
            if (c.id !== clientId || !c.mgmv) return c;
            const updatedAgreement = {
              ...c.mgmv,
              installments: c.mgmv.installments.map((i) =>
                i.number === installmentNumber
                  ? { ...i, paid: true, paidAt: new Date().toISOString() }
                  : i,
              ),
              reviewStatus:
                c.mgmv.reviewStatus === "ai_reviewed"
                  ? c.mgmv.reviewStatus
                  : ("manually_reviewed" as MGMVAgreement["reviewStatus"]),
            };
            // Recalcula os vencimentos das parcelas pendentes com base na
            // última parcela paga (data de pagamento + 1 mês por parcela).
            return { ...c, mgmv: recalcPendingDueDates(updatedAgreement) };
          });
          const updated = clients.find((c) => c.id === clientId);
          if (updated) {
            queueClientUpsert(updated);
            dbSyncAgreementForClient(updated);
          }
          return { clients };
        }),
      registerMGMVPartialPayment: (clientId, installmentNumber, amount) => {
        const state = get();
        const client = state.clients.find((c) => c.id === clientId);
        if (!client || !client.mgmv) {
          return { ok: false, error: "Acordo MGMV não encontrado para este cliente." };
        }
        const display = getMGMVDisplay(client);
        const agreementRemaining = display?.remainingBalance ?? 0;
        // Executa validação + distribuição de forma pura antes de tocar o estado.
        const dry = applyMGMVPartialPayment(
          client.mgmv.installments,
          installmentNumber,
          amount,
          agreementRemaining,
        );
        if (!dry.ok) {
          return { ok: false, error: dry.error };
        }
        let becameQuitado = false;
        set((s) => {
          const clients = s.clients.map((c) => {
            if (c.id !== clientId || !c.mgmv) return c;
            // Recalcula a partir do estado atual do cliente (não do snapshot
            // capturado antes do `set`) para respeitar atualizações concorrentes.
            const applied = applyMGMVPartialPayment(
              c.mgmv.installments,
              installmentNumber,
              amount,
              agreementRemaining,
            );
            if (!applied.ok) return c;
            const nextAgreement = recalcPendingDueDates({
              ...c.mgmv,
              installments: applied.installments,
              reviewStatus:
                c.mgmv.reviewStatus === "ai_reviewed"
                  ? c.mgmv.reviewStatus
                  : ("manually_reviewed" as MGMVAgreement["reviewStatus"]),
            });
            if (applied.becameQuitado) becameQuitado = true;
            return { ...c, mgmv: nextAgreement };
          });
          // Se o acordo virou Quitado, refletir na lista: produtos vinculados
          // ao MGMV (financialStatus === "MGMV") que ainda não foram enviados
          // passam para "Resolvido". Produtos "Enviado" permanecem "Enviado".
          let products = s.products;
          if (becameQuitado) {
            products = s.products.map((p) => {
              if (p.clientId !== clientId) return p;
              if (p.financialStatus !== "MGMV") return p;
              if (p.situation === "Enviado" || p.situation === "Resolvido") return p;
              const next = { ...p, situation: "Resolvido" as Situation };
              queueProductUpsert(next);
              return next;
            });
          }
          const updated = clients.find((c) => c.id === clientId);
          if (updated) {
            queueClientUpsert(updated);
            dbSyncAgreementForClient(updated);
          }
          return { clients, products };
        });
        return { ok: true, becameQuitado };
      },
      setMGMVAgreement: (clientId, agreement) =>
        set((s) => {
          const nextAgreement = agreement
            ? recalcPendingDueDates(agreement)
            : agreement;
          const clients = s.clients.map((c) =>
            c.id === clientId
              ? {
                  ...c,
                  mgmv: nextAgreement,
                  // Ao receber um acordo MGMV, o cliente é reclassificado
                  // automaticamente. Ao remover o acordo, volta a ser comum.
                  clientType: (nextAgreement ? "mgmv" : "common") as "mgmv" | "common",
                }
              : c,
          );
          const updated = clients.find((c) => c.id === clientId);
          if (updated) {
            queueClientUpsert(updated);
            dbSyncAgreementForClient(updated);
          }
          return { clients };
        }),
      applyAiReviewToAgreement: async (clientId, nextAgreement, meta) => {
        const prevClient = get().clients.find((c) => c.id === clientId);
        const prevAgreement = prevClient?.mgmv;
        const reviewStatus: MGMVAgreement["reviewStatus"] =
          meta.mathOk || meta.confirmedWithConflict ? "ai_reviewed" : "review_required";
        const merged: MGMVAgreement = {
          ...nextAgreement,
          reviewStatus,
          aiReviewed: reviewStatus === "ai_reviewed",
          aiReviewAppliedAt:
            reviewStatus === "ai_reviewed" ? new Date().toISOString() : prevAgreement?.aiReviewAppliedAt,
          aiConfidence: meta.confidence,
          aiReviewRawResult: meta.rawResult,
        };
        set((s) => ({
          clients: s.clients.map((c) =>
            c.id === clientId
              ? { ...c, mgmv: merged, clientType: "mgmv" as "mgmv" | "common" }
              : c,
          ),
        }));
        const updated = get().clients.find((c) => c.id === clientId);
        if (updated) {
          queueClientUpsert(updated);
          await dbSyncAgreementForClientAsync(updated);
          await dbInsertMgmvReviewAuditLog({
            clientId,
            agreementId: clientId,
            previousReviewStatus: prevAgreement?.reviewStatus ?? "review_required",
            newReviewStatus: reviewStatus,
            previousAgreement: prevAgreement,
            newAgreement: merged,
            confidence: meta.confidence,
            confirmedWithConflict: !!meta.confirmedWithConflict,
            mathOk: meta.mathOk,
          });
        }
      },
      setPreferences: (patch) =>
        set((s) => {
          const preferences = { ...s.preferences, ...patch };
          dbSaveSettings({ preferences });
          return { preferences };
        }),
      setRules: (patch) =>
        set((s) => {
          const rules = { ...s.rules, ...patch };
          dbSaveSettings({ rules });
          return { rules };
        }),
      setSecurity: (patch) =>
        set((s) => {
          const security = { ...s.security, ...patch };
          dbSaveSettings({ security });
          return { security };
        }),
      addImportHistory: (entry) =>
        set((s) => {
          const newEntry: ImportHistoryEntry = {
            id: uid(),
            date: entry.date ?? new Date().toISOString(),
            source: entry.source,
            file: entry.file,
            clientsCreated: entry.clientsCreated,
            productsAdded: entry.productsAdded,
            errors: entry.errors,
            status: entry.status,
            fileHash: entry.fileHash,
            agreementsCreated: entry.agreementsCreated,
            agreementsReplaced: entry.agreementsReplaced,
            skippedDuplicates: entry.skippedDuplicates,
            durationMs: entry.durationMs,
          };
          dbInsertHistory(newEntry);
          // Mantém um buffer maior na memória — o banco preserva tudo;
          // este slice é só pra UI não inflar indefinidamente.
          return {
            importHistory: [newEntry, ...s.importHistory].slice(0, 200),
          };
        }),
      persistConfirmedImport: async ({ clients, products, history }) => {
        // Paraleliza os 3 upserts principais — cada um já faz chunks internos.
        // Ganho grande vs. o await sequencial anterior, sobretudo em confirmações
        // pequenas onde a latência de rede domina.
        const mgmvClients = clients.filter(
          (c) => c.mgmv && c.mgmv.installments.length > 0,
        );
        // Prova de isolamento: contagens de produção antes da gravação.
        // Em produção o servidor devolve {} e nada é auditado.
        let productionBefore: Record<string, number> = {};
        const startedAt = Date.now();
        try {
          const { snapshotProductionCounts } = await import("@/lib/backup.functions");
          productionBefore = await snapshotProductionCounts();
        } catch {
          productionBefore = {};
        }
        await Promise.all([
          dbUpsertClientsAsync(clients),
          dbUpsertProductsAsync(products),
          dbUpsertHistoryAsync(history),
          mgmvClients.length > 0
            ? dbSyncAgreementsBulkAsync(mgmvClients)
            : Promise.resolve(),
        ]);
        // Auditoria do Modo Teste (ignorada silenciosamente em produção).
        if (Object.keys(productionBefore).length > 0) {
          try {
            const { recordSandboxImport } = await import("@/lib/backup.functions");
            await recordSandboxImport({
              data: {
                source: history?.source ?? "importacao",
                fileName: history?.file ?? null,
                mode: "import",
                tables: ["clients", "products", "mgmv_agreements", "import_history"],
                rowCounts: {
                  clients: clients.length,
                  products: products.length,
                  mgmv_agreements: mgmvClients.length,
                },
                durationMs: Date.now() - startedAt,
                productionBefore,
              },
            });
          } catch (err) {
            console.warn("[sandbox-audit] falha ao registrar importação:", err);
          }
        }
      },
      executeDangerAction: async (action) => {
        clearImportRuntimeState();
        bumpResetVersion();
        await flushUiStateNow();

        const notifyReset = () => {
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("app:reset"));
          }
        };
        switch (action) {
          case "deleteImportedData":
            await dbDeleteAllImportProgressAsync();
            await dbDeleteHistoryAllAsync();
            set((s) => ({ ...s, importHistory: [] }));
            notifyReset();
            return;
          case "deleteAllClients":
            await dbDeleteAllImportProgressAsync();
            await dbDeleteAllMGMVAsync();
            await dbDeleteAllProductsAsync();
            await dbDeleteAllClientsAsync();
            set((s) => ({ ...s, clients: [], products: [], openClientId: null }));
            notifyReset();
            return;
          case "deleteAllProducts":
            await dbDeleteAllImportProgressAsync();
            await dbDeleteAllMGMVAsync();
            await dbDeleteAllProductsAsync();
            set((s) => ({ ...s, products: [] }));
            notifyReset();
            return;
          case "resetSystem":
            await dbDeleteAllImportProgressAsync();
            await dbDeleteAllMGMVAsync();
            await dbDeleteAllProductsAsync();
            await dbDeleteAllClientsAsync();
            await dbDeleteHistoryAllAsync();
            await dbDeleteAllTeamAsync();
            dbSaveSettings({
              preferences: defaultPreferences,
              rules: defaultRules,
              security: defaultSecurity,
            });
            set((s) => ({
              ...s,
              clients: [],
              products: [],
              importHistory: [],
              openClientId: null,
              preferences: defaultPreferences,
              rules: defaultRules,
              security: defaultSecurity,
            }));
            notifyReset();
            return;
          default:
            return;
        }
      },
      fetchDiagnostics: () => dbFetchDiagnostics(),
      clearImportCache: () => {
        clearImportRuntimeState();
        bumpResetVersion();
        void flushUiStateNow();
      },
      refreshSnapshot: async () => {
        const snap = await loadSnapshot();
        set({
          clients: snap.clients,
          products: snap.products,
          importHistory: snap.importHistory,
          preferences: { ...defaultPreferences, ...snap.preferences },
          rules: { ...defaultRules, ...snap.rules },
          security: { ...defaultSecurity, ...snap.security },
          hydrated: true,
        });
      },
      findDuplicateClientGroups: () => {
        const { clients, products } = get();
        return computeDuplicateGroups(clients, products);
      },
      mergeDuplicateClients: async () => {
        const state = get();
        const groups = computeDuplicateGroups(state.clients, state.products);
        if (groups.length === 0) {
          return { groups: 0, removed: 0, reassignedProducts: 0 };
        }

        // Mapa fromId -> toId para reatribuição em memória.
        const reassign = new Map<string, string>();
        const removedIds: string[] = [];
        const updatedPrimaries = new Map<string, Client>();

        for (const g of groups) {
          const primary = state.clients.find((c) => c.id === g.primaryId);
          if (!primary) continue;
          const dups = g.duplicateIds
            .map((id) => state.clients.find((c) => c.id === id))
            .filter((c): c is Client => Boolean(c));

          // Mescla nome (mais longo), notas (concatena únicas), folder, mgmv se faltar.
          const allNames = [primary.name, ...dups.map((d) => d.name)].filter(Boolean);
          const bestName = allNames.reduce((a, b) => (b.length > a.length ? b : a), primary.name);
          const notesPieces = [primary.notes, ...dups.map((d) => d.notes)]
            .map((n) => (n ?? "").trim())
            .filter(Boolean);
          const mergedNotes = Array.from(new Set(notesPieces)).join("\n\n") || undefined;
          const mergedMgmv = primary.mgmv ?? dups.find((d) => d.mgmv)?.mgmv;
          const mergedFolder = primary.folder ?? dups.find((d) => d.folder)?.folder;

          const mergedPrimary: Client = {
            ...primary,
            name: bestName,
            notes: mergedNotes,
            mgmv: mergedMgmv,
            folder: mergedFolder,
          };
          updatedPrimaries.set(primary.id, mergedPrimary);

          for (const d of dups) {
            reassign.set(d.id, primary.id);
            removedIds.push(d.id);
          }
        }

        // 1) Banco: reatribui produtos e (se necessário) acordos antes de apagar.
        const fromIds = Array.from(reassign.keys());
        const targets = new Set(Array.from(reassign.values()));
        for (const toId of targets) {
          const sources = fromIds.filter((id) => reassign.get(id) === toId);
          await dbReassignProductsClientAsync(sources, toId);
          // Se o primário não tem mgmv mas um duplicado tem, move o acordo.
          const primary = updatedPrimaries.get(toId);
          if (primary?.mgmv) {
            for (const src of sources) {
              const dup = state.clients.find((c) => c.id === src);
              if (dup?.mgmv && primary.mgmv === dup.mgmv) {
                await dbReassignAgreementClientAsync(src, toId);
              }
            }
          }
        }
        await dbDeleteClientsByIdsAsync(removedIds);

        // 2) Persiste primários atualizados (nome/notas/mgmv mesclados).
        const mergedClientsToUpsert = Array.from(updatedPrimaries.values());
        await dbUpsertClientsAsync(mergedClientsToUpsert);

        // 3) Atualiza memória.
        const reassignedProducts = state.products.filter((p) => reassign.has(p.clientId)).length;
        set((s) => {
          const removedSet = new Set(removedIds);
          const clients = s.clients
            .filter((c) => !removedSet.has(c.id))
            .map((c) => updatedPrimaries.get(c.id) ?? c);
          const products = s.products.map((p) =>
            reassign.has(p.clientId) ? { ...p, clientId: reassign.get(p.clientId)! } : p,
          );
          return { clients, products };
        });

        return {
          groups: groups.length,
          removed: removedIds.length,
          reassignedProducts,
        };
      },
}));

export const formatBRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const formatDateBR = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR");
};

export const daysLate = (dueIso: string) => {
  const due = new Date(dueIso).getTime();
  const now = Date.now();
  if (now <= due) return 0;
  return Math.floor((now - due) / 86400000);
};

export const isOverdue = (dueIso: string) => daysLate(dueIso) > 0;

export function shouldAppearInCollection(p: Product) {
  return (
    // Produtos marcados como MGMV foram consolidados em um acordo do cliente
    // e a cobrança passa a ser feita pela parcela do acordo (linha consolidada),
    // portanto não devem aparecer como cobrança individual.
    (p.financialStatus === "Reserva" || p.financialStatus === "Pendente") &&
    isOpenSituation(p) &&
    isOverdue(p.dueDate)
  );
}

/**
 * Conjunto único de regra para decidir se um produto ainda está "em aberto"
 * para fins de cobrança/valores a receber.
 *
 * Regras (alinhadas ao Notion):
 * - Enviado/Retirado → produto entregue
 * - Removido/Desistiu/Abandonou → cliente abandonou
 * - Resolvido → marcado manualmente como resolvido
 * - financialStatus === "MGMV" → consolidado em acordo
 * Qualquer um desses NÃO é "em aberto", mesmo que o campo situation
 * tenha vindo da planilha como "Em Aberto" por bug histórico.
 */
export function isResolvedSituation(p: Pick<Product, "situation" | "financialStatus">): boolean {
  if (p.financialStatus === "MGMV") return true;
  switch (p.situation) {
    case "Enviado":
    case "Retirado":
    case "Removido":
    case "Desistiu":
    case "Abandonou":
    case "Resolvido":
      return true;
    case "Retirar":
      // Produto marcado para retirada pelo estoque — não deve mais aparecer
      // como cobrança ativa nem como pendente de envio.
      return true;
    default:
      return false;
  }
}

export function isOpenSituation(p: Pick<Product, "situation" | "financialStatus">): boolean {
  return !isResolvedSituation(p);
}

export interface ClientFinancialSummary {
  totalPurchased: number;
  totalPaid: number;
  totalRemaining: number;
  overdueValue: number;
  overdueCount: number;
  productsTotal: number;
  productsPaid: number;
  productsRemaining: number;
  mgmvTotal: number;
  mgmvPaid: number;
  mgmvRemaining: number;
}

function installmentPaidAmount(i: MGMVInstallment): number {
  return Math.max(0, i.paidAmount ?? (i.paid ? i.value : 0));
}

/**
 * Fonte única dos números financeiros exibidos no cliente e em Finanças.
 * Produtos consolidados em MGMV não entram duas vezes: o total oficial passa
 * a ser o acordo MGMV + produtos individuais fora do acordo.
 */
export function calculateClientFinancialSummary(
  client: Client,
  products: readonly Product[],
): ClientFinancialSummary {
  const clientProducts = products.filter((p) => p.clientId === client.id);
  const summary: ClientFinancialSummary = {
    totalPurchased: 0,
    totalPaid: 0,
    totalRemaining: 0,
    overdueValue: 0,
    overdueCount: 0,
    productsTotal: 0,
    productsPaid: 0,
    productsRemaining: 0,
    mgmvTotal: 0,
    mgmvPaid: 0,
    mgmvRemaining: 0,
  };

  for (const p of clientProducts) {
    if (client.mgmv && p.financialStatus === "MGMV") continue;

    const total = Math.max(0, p.totalValue || 0);
    const paid = Math.max(0, p.paidValue || 0);
    const remaining = Math.max(0, total - paid);

    summary.productsTotal += total;
    summary.productsPaid += paid;
    summary.totalPurchased += total;
    summary.totalPaid += paid;

    if (remaining > 0 && p.financialStatus !== "Pago" && isOpenSituation(p)) {
      summary.productsRemaining += remaining;
      summary.totalRemaining += remaining;
      if (isOverdue(p.dueDate)) {
        summary.overdueValue += remaining;
        summary.overdueCount += 1;
      }
    }
  }

  if (client.mgmv) {
    summary.mgmvTotal = Math.max(0, client.mgmv.totalDebt || 0);
    summary.totalPurchased += summary.mgmvTotal;

    for (const inst of client.mgmv.installments) {
      const paid = installmentPaidAmount(inst);
      summary.mgmvPaid += paid;
      summary.totalPaid += paid;

      if (inst.paid) continue;
      const remaining = Math.max(0, (inst.value || 0) - paid);
      if (remaining <= 0) continue;
      summary.mgmvRemaining += remaining;
      summary.totalRemaining += remaining;
      if (isOverdue(inst.dueDate)) {
        summary.overdueValue += remaining;
        summary.overdueCount += 1;
      }
    }
  }

  return summary;
}

export function productCollectionStatus(p: Product): {
  label: string;
  variant: "danger" | "warning" | "neutral";
} {
  // Produtos incluídos em um acordo MGMV não são cobrados individualmente.
  // A cobrança ativa passa a ser feita pelas parcelas do acordo, então
  // exibimos uma tag informativa em vez de "MGMV vencido".
  if (p.financialStatus === "MGMV")
    return { label: "Incluído no MGMV", variant: "neutral" };
  // Se o produto já foi resolvido (Enviado/Retirado/Removido/Desistiu/
  // Abandonou/Resolvido), não exibir como vencido — mostrar o estado real.
  if (isResolvedSituation(p))
    return { label: p.situation, variant: "neutral" };
  if (p.financialStatus === "Reserva" && isOverdue(p.dueDate))
    return { label: "Reserva vencida", variant: "danger" };
  if (p.financialStatus === "Pendente" && isOverdue(p.dueDate))
    return { label: "Pendente vencido", variant: "danger" };
  if (p.financialStatus === "Reserva") return { label: "Reserva", variant: "warning" };
  if (p.financialStatus === "Pendente") return { label: "Pendente", variant: "warning" };
  return { label: p.financialStatus, variant: "neutral" };
}

/**
 * Data limite exibida no Histórico de Produtos.
 * Para produtos incluídos no MGMV, o vencimento real vive nas parcelas do
 * acordo — a coluna Limite passa a exibir "Acordo MGMV".
 */
export function getProductDisplayDueDate(p: Product): string {
  if (p.financialStatus === "MGMV") return "Acordo MGMV";
  return formatDateBR(p.dueDate);
}

/**
 * Converte o status persistido em um rótulo unificado para exibição.
 * Regra de unificação: "Desistiu" foi absorvido por "Abandonou". Dados
 * históricos permanecem no banco com o valor antigo, mas a UI sempre
 * mostra "Abandonou". Novos registros nunca devem ser criados como
 * "Desistiu" a partir da interface.
 */
export function displaySituation(s: Situation): Situation {
  return s === "Desistiu" ? "Abandonou" : s;
}

/**
 * Verifica se um produto está arquivado (fluxo Retirado concluído).
 * Produtos arquivados saem da lista ativa do cliente mas permanecem no
 * histórico.
 */
export function isProductArchived(p: Pick<Product, "situation">): boolean {
  return p.situation === "Retirado";
}

// ============= MGMV (acordo consolidado por cliente) =============

export interface MGMVDisplay {
  clientId: string;
  totalDebt: number;
  installmentsTotal: number;
  installmentsPaid: number;
  installmentValue: number;
  remainingBalance: number;
  nextInstallment: MGMVInstallment | null;
  hasOverdue: boolean;
  overdueCount: number;
  active: boolean; // tem alguma parcela em aberto
  status: "Ativo" | "Quitado" | "Vencido";
  /** Soma de pagamentos parciais em parcelas ainda pendentes. */
  partialPaidAmount: number;
}

export function getMGMVDisplay(client: Client): MGMVDisplay | null {
  if (!client.mgmv) return null;
  const ins = client.mgmv.installments;
  const paid = ins.filter((i) => i.paid);
  const unpaid = ins.filter((i) => !i.paid);
  const overdue = unpaid.filter((i) => isOverdue(i.dueDate));
  const next = unpaid.slice().sort((a, b) => +new Date(a.dueDate) - +new Date(b.dueDate))[0] ?? null;
  const installmentValue = ins[0]?.value ?? 0;
  const partialPaidAmount = unpaid.reduce(
    (s, i) => s + Math.max(0, Math.min(i.value, i.paidAmount ?? 0)),
    0,
  );
  const remainingBalance = Math.max(
    0,
    unpaid.reduce((s, i) => s + i.value, 0) - partialPaidAmount,
  );
  const active = unpaid.length > 0;
  const status: MGMVDisplay["status"] = !active
    ? "Quitado"
    : overdue.length > 0
      ? "Vencido"
      : "Ativo";
  return {
    clientId: client.id,
    totalDebt: client.mgmv.totalDebt,
    installmentsTotal: ins.length,
    installmentsPaid: paid.length,
    installmentValue,
    remainingBalance,
    nextInstallment: next,
    hasOverdue: overdue.length > 0,
    overdueCount: overdue.length,
    active,
    status,
    partialPaidAmount,
  };
}

export function clientHasActiveMGMV(client: Client | undefined | null): boolean {
  if (!client?.mgmv) return false;
  return client.mgmv.installments.some((i) => !i.paid);
}

export function productIncludedInMGMV(p: Product): boolean {
  return p.financialStatus === "MGMV";
}