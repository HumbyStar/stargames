import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: { products: string[][]; agreements: string[] } = {
  products: [],
  agreements: [],
};

vi.mock("./db-sync", () => ({
  dbUpsertProductsAsync: async (ps: { id: string }[]) => {
    calls.products.push(ps.map((p) => p.id));
  },
  dbSyncAgreementForClientAsync: async (c: { id: string }) => {
    calls.agreements.push(c.id);
  },
  loadSnapshot: async () => ({ clients: [], products: [], history: [], settings: null, env: "producao" }),
  resolveCurrentEnv: async () => "producao",
  getUiValue: () => undefined,
  dbFetchDiagnostics: async () => ({}),
  migrateLocalStorageOnce: () => undefined,
  primeUiState: async () => undefined,
  dbDeleteAllClientsAsync: async () => undefined,
  dbDeleteAllProductsAsync: async () => undefined,
  dbDeleteAllMGMVAsync: async () => undefined,
  dbDeleteAllTeamAsync: async () => undefined,
  dbDeleteAllImportProgressAsync: async () => undefined,
  clearImportRuntimeState: async () => undefined,
  dbDeleteHistoryAllAsync: async () => undefined,
  dbInsertHistory: async () => undefined,
  dbUpsertClientsAsync: async () => undefined,
  dbUpsertHistoryAsync: async () => undefined,
  dbSaveSettings: async () => undefined,
  flushUiStateNow: async () => undefined,
  queueClientUpsert: async () => undefined,
  queueProductUpsert: async () => undefined,
  setUiValue: async () => undefined,
  dbSyncAgreementForClient: async () => undefined,
  dbInsertMgmvReviewAuditLog: async () => undefined,
  dbSyncAgreementsBulkAsync: async () => undefined,
  dbReassignProductsClientAsync: async () => undefined,
  dbReassignAgreementClientAsync: async () => undefined,
  dbDeleteClientsByIdsAsync: async () => undefined,
  dbDeleteProductsByIdsAsync: async () => undefined,
  suspendRealtimeRefresh: async () => undefined,
  getCurrentUserInfo: async () => undefined,
}));

const { useStore } = await import("./store");
const { isAgreementFullyPaid } = await import("./mgmv-schedule");

describe("isAgreementFullyPaid", () => {
  it("reconhece quitação de registros antigos com paidAmount zerado", () => {
    expect(
      isAgreementFullyPaid({
        startDate: "2026-08-04T00:00:00.000Z",
        totalDebt: 40,
        installments: [
          { number: 1, total: 3, dueDate: "2026-09-04", value: 13.33, paid: true, paidAmount: 13.33 },
          { number: 2, total: 3, dueDate: "2026-09-04", value: 13.33, paid: true, paidAmount: 0 },
          { number: 3, total: 3, dueDate: "2026-09-04", value: 13.33, paid: true, paidAmount: 0 },
        ],
      }),
    ).toBe(true);
  });

  it("não reconhece quitação se alguma parcela continuar pendente", () => {
    expect(
      isAgreementFullyPaid({
        startDate: "2026-08-04T00:00:00.000Z",
        totalDebt: 40,
        installments: [
          { number: 1, total: 2, dueDate: "2026-09-04", value: 20, paid: true },
          { number: 2, total: 2, dueDate: "2026-10-04", value: 20, paid: false },
        ],
      }),
    ).toBe(false);
  });
});

describe("completeMGMVAgreement", () => {
  beforeEach(() => {
    calls.products = [];
    calls.agreements = [];
  });

  it("converte produtos MGMV em individuais Pago/Em Aberto e persiste na ordem certa", async () => {
    const now = new Date().toISOString();
    useStore.setState({
      clients: [
        {
          id: "c1",
          name: "Cliente",
          phone: "11999999999",
          clientType: "mgmv",
          mgmv: {
            startDate: now,
            totalDebt: 100,
            installments: [
              { number: 1, total: 1, dueDate: now, value: 100, paid: true, paidAt: now },
            ],
          },
        },
      ] as never,
      products: [
        {
          id: "p1",
          clientId: "c1",
          name: "Item",
          platform: "PS5",
          totalValue: 100,
          paidValue: 0,
          financialStatus: "MGMV",
          situation: "Em Aberto",
          registerDate: now,
          dueDate: now,
        },
        {
          id: "p2",
          clientId: "c1",
          name: "Item enviado",
          platform: "PS5",
          totalValue: 50,
          paidValue: 0,
          financialStatus: "MGMV",
          situation: "Enviado",
          registerDate: now,
          dueDate: now,
        },
      ] as never,
    });

    const res = useStore.getState().completeMGMVAgreement("c1");
    expect(res).toEqual({ ok: true, movedProducts: 2 });

    const products = useStore.getState().products;
    const p1 = products.find((p) => p.id === "p1")!;
    expect(p1.financialStatus).toBe("Pago");
    expect(p1.paidValue).toBe(100);
    expect(p1.situation).toBe("Em Aberto");
    // situação fechada é preservada
    expect(products.find((p) => p.id === "p2")!.situation).toBe("Enviado");

    const client = useStore.getState().clients.find((c) => c.id === "c1")!;
    expect(client.clientType).toBe("common");
    expect(client.mgmv?.completedAt).toBeTruthy();

    await new Promise((r) => setTimeout(r, 0));
    expect(calls.products[0]).toEqual(["p1", "p2"]);
    expect(calls.agreements).toEqual(["c1"]);
  });

  it("bloqueia a conclusão quando os produtos MGMV ainda não foram carregados", () => {
    const now = new Date().toISOString();
    useStore.setState({
      clients: [{
        id: "c-sem-itens",
        name: "Cliente MGMV",
        phone: "11999999999",
        clientType: "mgmv",
        mgmv: {
          startDate: now,
          totalDebt: 100,
          installments: [
            { number: 1, total: 1, dueDate: now, value: 100, paid: true },
          ],
        },
      }] as never,
      products: [],
    });

    expect(useStore.getState().completeMGMVAgreement("c-sem-itens")).toEqual({
      ok: false,
      movedProducts: 0,
    });
    const client = useStore.getState().clients[0];
    expect(client.clientType).toBe("mgmv");
    expect(client.mgmv?.completedAt).toBeUndefined();
  });
});
