import { create } from "zustand";
import { persist } from "zustand/middleware";

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
  setPreferences: (patch: Partial<SystemPreferences>) => void;
  setRules: (patch: Partial<OperationalRules>) => void;
  setSecurity: (patch: Partial<SecuritySettings>) => void;
  addImportHistory: (entry: Omit<ImportHistoryEntry, "id" | "date"> & { date?: string }) => void;
  executeDangerAction: (action: DangerAction) => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

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

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      clients: seedClients,
      products: seedProducts,
      openClientId: null,
      preferences: defaultPreferences,
      rules: defaultRules,
      security: defaultSecurity,
      importHistory: seedImportHistory,
      openClient: (id) => set({ openClientId: id }),
      addClient: (c) => {
        const client = { ...c, id: uid() };
        set((s) => ({ clients: [...s.clients, client] }));
        return client;
      },
      updateClient: (id, patch) =>
        set((s) => ({
          clients: s.clients.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),
      findClientByPhone: (phone) =>
        get().clients.find((c) => c.phone.replace(/\D/g, "") === phone.replace(/\D/g, "")),
      addProduct: (p) => set((s) => ({ products: [...s.products, { ...p, id: uid() }] })),
      updateProduct: (id, patch) =>
        set((s) => ({
          products: s.products.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
      registerPayment: (productId, amount) =>
        set((s) => ({
          products: s.products.map((p) => {
            if (p.id !== productId) return p;
            const paidValue = Math.min(p.totalValue, p.paidValue + amount);
            const nextStatus =
              p.financialStatus === "MGMV"
                ? "MGMV"
                : calculateFinancialStatus(p.totalValue, paidValue);
            return {
              ...p,
              paidValue,
              financialStatus: nextStatus,
            };
          }),
        })),
      markResolved: (productId) =>
        set((s) => ({
          products: s.products.map((p) =>
            p.id === productId ? { ...p, situation: "Resolvido" } : p,
          ),
        })),
      setProductSituation: (productId, situation) =>
        set((s) => ({
          products: s.products.map((p) =>
            p.id === productId ? { ...p, situation } : p,
          ),
        })),
      updateProductNotes: (productId, notes) =>
        set((s) => ({
          products: s.products.map((p) => (p.id === productId ? { ...p, notes } : p)),
        })),
      updateClientNotes: (clientId, notes) =>
        set((s) => ({
          clients: s.clients.map((c) => (c.id === clientId ? { ...c, notes } : c)),
        })),
      payMGMVInstallment: (clientId, installmentNumber) =>
        set((s) => ({
          clients: s.clients.map((c) => {
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
          }),
        })),
      setPreferences: (patch) =>
        set((s) => ({ preferences: { ...s.preferences, ...patch } })),
      setRules: (patch) => set((s) => ({ rules: { ...s.rules, ...patch } })),
      setSecurity: (patch) => set((s) => ({ security: { ...s.security, ...patch } })),
      addImportHistory: (entry) =>
        set((s) => ({
          importHistory: [
            {
              id: uid(),
              date: entry.date ?? new Date().toISOString(),
              source: entry.source,
              file: entry.file,
              clientsCreated: entry.clientsCreated,
              productsAdded: entry.productsAdded,
              errors: entry.errors,
              status: entry.status,
            },
            ...s.importHistory,
          ].slice(0, 50),
        })),
      executeDangerAction: (action) =>
        set((s) => {
          switch (action) {
            case "deleteImportedData":
              return { ...s, importHistory: [] };
            case "deleteAllClients":
              return { ...s, clients: [], products: [], openClientId: null };
            case "deleteAllProducts":
              return { ...s, products: [] };
            case "resetSystem":
              return {
                ...s,
                clients: [],
                products: [],
                importHistory: [],
                openClientId: null,
                preferences: defaultPreferences,
                rules: defaultRules,
                security: defaultSecurity,
              };
            default:
              return s;
          }
        }),
    }),
    {
      name: "star-games-store",
      version: 3,
      migrate: (persisted: unknown) => migrateStoreV3(persisted) as State,
    },
  ),
);

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
    (p.financialStatus === "Reserva" || p.financialStatus === "Pendente" || p.financialStatus === "MGMV") &&
    p.situation === "Em Aberto" &&
    isOverdue(p.dueDate)
  );
}

export function productCollectionStatus(p: Product): {
  label: string;
  variant: "danger" | "warning" | "neutral";
} {
  if (p.financialStatus === "Reserva" && isOverdue(p.dueDate))
    return { label: "Reserva vencida", variant: "danger" };
  if (p.financialStatus === "Pendente" && isOverdue(p.dueDate))
    return { label: "Pendente vencido", variant: "danger" };
  if (p.financialStatus === "MGMV" && isOverdue(p.dueDate))
    return { label: "MGMV vencido", variant: "danger" };
  if (p.financialStatus === "Reserva") return { label: "Reserva", variant: "warning" };
  if (p.financialStatus === "Pendente") return { label: "Pendente", variant: "warning" };
  return { label: p.financialStatus, variant: "neutral" };
}