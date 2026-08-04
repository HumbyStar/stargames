import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: { products: string[][]; agreements: string[] } = {
  products: [],
  agreements: [],
};

vi.mock("./db-sync", () => {
  const noop = () => {};
  const asyncNoop = async () => {};
  return new Proxy(
    {
      dbUpsertProductsAsync: async (ps: { id: string }[]) => {
        calls.products.push(ps.map((p) => p.id));
      },
      dbSyncAgreementForClientAsync: async (c: { id: string }) => {
        calls.agreements.push(c.id);
      },
      loadSnapshot: async () => ({
        clients: [],
        products: [],
        history: [],
        settings: null,
        env: "producao",
      }),
      resolveCurrentEnv: async () => "producao",
      getUiValue: () => undefined,
      dbFetchDiagnostics: asyncNoop,
      migrateLocalStorageOnce: noop,
      primeUiState: asyncNoop,
    } as Record<string, unknown>,
    {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        return prop.endsWith("Async") ? asyncNoop : noop;
      },
    },
  );
});

const { useStore } = await import("./store");

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
});
