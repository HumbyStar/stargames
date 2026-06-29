import { create } from "zustand";
import {
  dbDeleteAllClientsAsync,
  dbDeleteAllProductsAsync,
  dbDeleteAllMGMVAsync,
  dbDeleteAllImportProgressAsync,
  clearImportRuntimeState,
  dbDeleteHistoryAllAsync,
  dbInsertHistory,
  dbUpsertClientsAsync,
  dbUpsertHistoryAsync,
  dbUpsertProductsAsync,
  dbSaveSettings,
  flushUiStateNow,
  dbUpsertClient,
  dbUpsertProduct,
  loadSnapshot,
  migrateLocalStorageOnce,
  primeUiState,
  getUiValue,
  setUiValue,
  dbSyncAgreementForClient,
  dbSyncAgreementsBulkAsync,
  dbFetchDiagnostics,
} from "./db-sync";
import type { ImportDiagnostics } from "./db-sync";
export type { ImportDiagnostics } from "./db-sync";

export type FinancialStatus = "Pago" | "Reserva" | "Pendente" | "MGMV";
export type Situation = "Em Aberto" | "Enviado" | "Desistiu" | "Abandonou" | "Resolvido";

export interface MGMVInstallment {
  number: number;
  total: number;
  dueDate: string;
  value: number;
  paid: boolean;
  paidAt?: string;
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

export interface Client {
  id: string;
  name: string;
  phone: string;
  notes?: string;
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
  reset: () => void;
  openClient: (id: string | null) => void;
  addClient: (c: Omit<Client, "id">) => Client;
  updateClient: (id: string, patch: Partial<Omit<Client, "id">>) => void;
  findClientByPhone: (phone: string) => Client | undefined;
  addProduct: (p: Omit<Product, "id">) => void;
  updateProduct: (id: string, patch: Partial<Omit<Product, "id">>) => void;
  registerPayment: (productId: string, amount: number) => void;
  markResolved: (productId: string) => void;
  setProductSituation: (productId: string, situation: Situation) => void;
  updateProductNotes: (productId: string, notes: string) => void;
  updateClientNotes: (clientId: string, notes: string) => void;
  payMGMVInstallment: (clientId: string, installmentNumber: number) => void;
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
}

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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

const today = new Date();
const daysAgo = (n: number) => new Date(today.getTime() - n * 86400000).toISOString();
const daysAhead = (n: number) => new Date(today.getTime() + n * 86400000).toISOString();

const seedClients: Client[] = [
  {
    id: "c1",
    name: "João Silva",
    phone: "11 99999-9999",
    mgmv: {
      startDate: daysAgo(20),
      totalDebt: 1000,
      installments: [
        { number: 1, total: 5, dueDate: daysAgo(20), value: 200, paid: true, paidAt: daysAgo(20) },
        { number: 2, total: 5, dueDate: daysAgo(5), value: 200, paid: false },
        { number: 3, total: 5, dueDate: daysAhead(10), value: 200, paid: false },
        { number: 4, total: 5, dueDate: daysAhead(40), value: 200, paid: false },
        { number: 5, total: 5, dueDate: daysAhead(70), value: 200, paid: false },
      ],
    },
  },
  { id: "c2", name: "Maria Oliveira", phone: "21 98888-8888" },
  { id: "c3", name: "Carlos Santos", phone: "41 97777-7777" },
  { id: "c4", name: "Pedro Almeida", phone: "11 96666-6666" },
  { id: "c5", name: "Ana Costa", phone: "31 95555-5555" },
];

const seedProducts: Product[] = [
  {
    id: "p1", clientId: "c1", name: "GTA V", platform: "PS5",
    totalValue: 250, paidValue: 50, financialStatus: "Reserva",
    situation: "Em Aberto", registerDate: daysAgo(30), dueDate: daysAgo(12),
    notes: "Cliente pediu prazo adicional.",
  },
  {
    id: "p2", clientId: "c1", name: "FIFA 24", platform: "PS5",
    totalValue: 300, paidValue: 100, financialStatus: "Reserva",
    situation: "Em Aberto", registerDate: daysAgo(25), dueDate: daysAgo(5),
  },
  {
    id: "p3", clientId: "c1", name: "Controle DualSense", platform: "PS5",
    totalValue: 400, paidValue: 0, financialStatus: "Pendente",
    situation: "Em Aberto", registerDate: daysAgo(15), dueDate: daysAhead(3),
  },
  {
    id: "p4", clientId: "c2", name: "Figure Goku", platform: "Colecionável",
    totalValue: 180, paidValue: 80, financialStatus: "Reserva",
    situation: "Em Aberto", registerDate: daysAgo(10), dueDate: daysAgo(2),
  },
  {
    id: "p5", clientId: "c3", name: "PS2 Slim", platform: "PS2",
    totalValue: 600, paidValue: 300, financialStatus: "Reserva",
    situation: "Em Aberto", registerDate: daysAgo(8), dueDate: daysAgo(1),
  },
  {
    id: "p6", clientId: "c4", name: "Spider-Man 2", platform: "PS5",
    totalValue: 280, paidValue: 280, financialStatus: "Pago",
    situation: "Enviado", registerDate: daysAgo(40), dueDate: daysAgo(35),
  },
  {
    id: "p7", clientId: "c5", name: "Xbox Series S", platform: "Xbox",
    totalValue: 2200, paidValue: 1000, financialStatus: "Reserva",
    situation: "Em Aberto", registerDate: daysAgo(5), dueDate: daysAhead(15),
  },
];

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

const seedImportHistory: ImportHistoryEntry[] = [
  {
    id: "h1",
    date: daysAgo(0),
    source: "HTML Notion",
    file: "Bruno Kripel.html",
    clientsCreated: 1,
    productsAdded: 5,
    errors: 0,
    status: "Concluído",
  },
  {
    id: "h2",
    date: daysAgo(1),
    source: "CSV",
    file: "clientes_junho.csv",
    clientsCreated: 12,
    productsAdded: 38,
    errors: 2,
    status: "Com avisos",
  },
];

let hydratePromise: Promise<void> | null = null;

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
            products: snap.products,
            importHistory: snap.importHistory,
            preferences: { ...defaultPreferences, ...snap.preferences },
            rules: { ...defaultRules, ...snap.rules },
            security: { ...defaultSecurity, ...snap.security },
            hydrated: true,
          });
        })();
        await hydratePromise;
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
        dbUpsertClient(client);
        return client;
      },
      updateClient: (id, patch) =>
        set((s) => {
          const clients = s.clients.map((c) => (c.id === id ? { ...c, ...patch } : c));
          const updated = clients.find((c) => c.id === id);
          if (updated) dbUpsertClient(updated);
          return { clients };
        }),
      findClientByPhone: (phone) =>
        get().clients.find((c) => c.phone.replace(/\D/g, "") === phone.replace(/\D/g, "")),
      addProduct: (p) =>
        set((s) => {
          const prod = { ...p, id: uid() };
          dbUpsertProduct(prod);
          return { products: [...s.products, prod] };
        }),
      updateProduct: (id, patch) =>
        set((s) => {
          const products = s.products.map((p) => (p.id === id ? { ...p, ...patch } : p));
          const updated = products.find((p) => p.id === id);
          if (updated) dbUpsertProduct(updated);
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
          if (updated) dbUpsertProduct(updated);
          return { products };
        }),
      markResolved: (productId) =>
        set((s) => {
          const products = s.products.map((p) =>
            p.id === productId ? { ...p, situation: "Resolvido" as Situation } : p,
          );
          const updated = products.find((p) => p.id === productId);
          if (updated) dbUpsertProduct(updated);
          return { products };
        }),
      setProductSituation: (productId, situation) =>
        set((s) => {
          const products = s.products.map((p) =>
            p.id === productId ? { ...p, situation } : p,
          );
          const updated = products.find((p) => p.id === productId);
          if (updated) dbUpsertProduct(updated);
          return { products };
        }),
      updateProductNotes: (productId, notes) =>
        set((s) => {
          const products = s.products.map((p) => (p.id === productId ? { ...p, notes } : p));
          const updated = products.find((p) => p.id === productId);
          if (updated) dbUpsertProduct(updated);
          return { products };
        }),
      updateClientNotes: (clientId, notes) =>
        set((s) => {
          const clients = s.clients.map((c) => (c.id === clientId ? { ...c, notes } : c));
          const updated = clients.find((c) => c.id === clientId);
          if (updated) dbUpsertClient(updated);
          return { clients };
        }),
      payMGMVInstallment: (clientId, installmentNumber) =>
        set((s) => {
          const clients = s.clients.map((c) => {
            if (c.id !== clientId || !c.mgmv) return c;
            return {
              ...c,
              mgmv: {
                ...c.mgmv,
                installments: c.mgmv.installments.map((i) =>
                  i.number === installmentNumber
                    ? { ...i, paid: true, paidAt: new Date().toISOString() }
                    : i,
                ),
              },
            };
          });
          const updated = clients.find((c) => c.id === clientId);
          if (updated) {
            dbUpsertClient(updated);
            dbSyncAgreementForClient(updated);
          }
          return { clients };
        }),
      setMGMVAgreement: (clientId, agreement) =>
        set((s) => {
          const clients = s.clients.map((c) =>
            c.id === clientId
              ? {
                  ...c,
                  mgmv: agreement,
                  // Ao receber um acordo MGMV, o cliente é reclassificado
                  // automaticamente. Ao remover o acordo, volta a ser comum.
                  clientType: (agreement ? "mgmv" : "common") as "mgmv" | "common",
                }
              : c,
          );
          const updated = clients.find((c) => c.id === clientId);
          if (updated) {
            dbUpsertClient(updated);
            dbSyncAgreementForClient(updated);
          }
          return { clients };
        }),
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
        await dbUpsertClientsAsync(clients);
        await dbUpsertProductsAsync(products);
        await dbUpsertHistoryAsync(history);
        // Persistência oficial MGMV: para todo cliente com acordo, grava
        // mgmv_agreements + mgmv_installments e atualiza flags dos produtos.
        const mgmvClients = clients.filter(
          (c) => c.mgmv && c.mgmv.installments.length > 0,
        );
        if (mgmvClients.length > 0) {
          await dbSyncAgreementsBulkAsync(mgmvClients);
        }
      },
      executeDangerAction: async (action) => {
        clearImportRuntimeState();
        bumpResetVersion();
        await flushUiStateNow();

        switch (action) {
          case "deleteImportedData":
            await dbDeleteAllImportProgressAsync();
            await dbDeleteHistoryAllAsync();
            set((s) => ({ ...s, importHistory: [] }));
            return;
          case "deleteAllClients":
            await dbDeleteAllImportProgressAsync();
            await dbDeleteAllMGMVAsync();
            await dbDeleteAllProductsAsync();
            await dbDeleteAllClientsAsync();
            set((s) => ({ ...s, clients: [], products: [], openClientId: null }));
            return;
          case "deleteAllProducts":
            await dbDeleteAllImportProgressAsync();
            await dbDeleteAllMGMVAsync();
            await dbDeleteAllProductsAsync();
            set((s) => ({ ...s, products: [] }));
            return;
          case "resetSystem":
            await dbDeleteAllImportProgressAsync();
            await dbDeleteAllMGMVAsync();
            await dbDeleteAllProductsAsync();
            await dbDeleteAllClientsAsync();
            await dbDeleteHistoryAllAsync();
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
    p.situation === "Em Aberto" &&
    isOverdue(p.dueDate)
  );
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
}

export function getMGMVDisplay(client: Client): MGMVDisplay | null {
  if (!client.mgmv) return null;
  const ins = client.mgmv.installments;
  const paid = ins.filter((i) => i.paid);
  const unpaid = ins.filter((i) => !i.paid);
  const overdue = unpaid.filter((i) => isOverdue(i.dueDate));
  const next = unpaid.slice().sort((a, b) => +new Date(a.dueDate) - +new Date(b.dueDate))[0] ?? null;
  const installmentValue = ins[0]?.value ?? 0;
  const remainingBalance = unpaid.reduce((s, i) => s + i.value, 0);
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
  };
}

export function clientHasActiveMGMV(client: Client | undefined | null): boolean {
  if (!client?.mgmv) return false;
  return client.mgmv.installments.some((i) => !i.paid);
}

export function productIncludedInMGMV(p: Product): boolean {
  return p.financialStatus === "MGMV";
}