import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase client BEFORE importing the module under test.
type Page = { after: string | null; limit: number };
let pages: Record<string, unknown[]> = {};
let calls: Record<string, Page[]> = {};

vi.mock("@/integrations/supabase/client", () => {
  function builder(table: string) {
    let after: string | null = null;
    const api: any = {
      order() {
        return api;
      },
      gt(_col: string, value: string) {
        after = value;
        return api;
      },
      limit(n: number) {
        calls[table] = calls[table] ?? [];
        calls[table].push({ after, limit: n });
        const all = (pages[table] ?? []) as Array<{ id: string }>;
        const sorted = [...all].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const start = after === null ? 0 : sorted.findIndex((r) => r.id === after) + 1;
        return Promise.resolve({ data: sorted.slice(start, start + n), error: null });
      },
    };
    return api;
  }
  return {
    supabase: {
      from(table: string) {
        return {
          select(_columns: string) {
            return builder(table);
          },
        };
      },
    },
  };
});

import { fetchAllRows, rowToClient, clientToRow } from "./db-sync";

function makeRows(n: number, prefix = "r") {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${String(i).padStart(6, "0")}`,
  }));
}

describe("fetchAllRows (anti-truncamento PostgREST)", () => {
  beforeEach(() => {
    pages = {};
    calls = {};
  });

  it("retorna todas as linhas mesmo acima do teto de 1000 do PostgREST", async () => {
    pages.clients = makeRows(2500, "c");
    const res = await fetchAllRows("clients");
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(2500);
    // Paginação por chave: nenhuma linha repetida nem faltando.
    const ids = new Set((res.data as Array<{ id: string }>).map((r) => r.id));
    expect(ids.size).toBe(2500);
  });

  it("pagina em lotes de 1000 avançando por chave (3 chamadas para 2500 linhas)", async () => {
    pages.products = makeRows(2500, "p");
    await fetchAllRows("products");
    expect(calls.products).toEqual([
      { after: null, limit: 1000 },
      { after: "p-000999", limit: 1000 },
      { after: "p-001999", limit: 1000 },
    ]);
  });

  it("para na primeira página parcial (menos linhas que o pageSize)", async () => {
    pages.clients = makeRows(150, "c");
    await fetchAllRows("clients");
    expect(calls.clients).toHaveLength(1);
  });

  it("respeita um pageSize customizado para clientes, produtos e MGMV", async () => {
    pages.clients = makeRows(7, "c");
    pages.products = makeRows(7, "p");
    pages.mgmv_agreements = makeRows(7, "a");
    pages.mgmv_installments = makeRows(7, "i");
    await fetchAllRows("clients", "*", 3);
    await fetchAllRows("products", "*", 3);
    await fetchAllRows("mgmv_agreements", "*", 3);
    await fetchAllRows("mgmv_installments", "*", 3);
    // 7 itens / pageSize 3 → 3 páginas (3 + 3 + 1)
    expect(calls.clients).toHaveLength(3);
    expect(calls.products).toHaveLength(3);
    expect(calls.mgmv_agreements).toHaveLength(3);
    expect(calls.mgmv_installments).toHaveLength(3);
  });

  it("propaga erro sem mascarar como sucesso vazio", async () => {
    // Simula erro retornando supabase com error.
    const mod = await import("@/integrations/supabase/client");
    const original = mod.supabase.from;
    (mod.supabase as unknown as { from: unknown }).from = () => ({
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: null, error: { message: "boom" } }),
        }),
      }),
    });
    const res = await fetchAllRows("clients");
    expect(res.data).toBeNull();
    expect(res.error).toEqual({ message: "boom" });
    (mod.supabase as unknown as { from: unknown }).from = original;
  });
});

describe("rowToClient / clientToRow", () => {
  it("preserva customer_data entre DB e Client", () => {
    const dbRow = {
      id: "c-1",
      name: "João",
      phone: "11911947693",
      notes: null,
      customer_data: "CPF: 123.456.789-00\nEndereço: Rua A, 123",
      folder: null,
      mgmv: null,
      client_type: "common",
    };
    const client = rowToClient(dbRow as unknown as Parameters<typeof rowToClient>[0]);
    expect(client.customerData).toBe("CPF: 123.456.789-00\nEndereço: Rua A, 123");

    const row = clientToRow(client);
    expect(row.customer_data).toBe("CPF: 123.456.789-00\nEndereço: Rua A, 123");
  });

  it("trata customer_data nulo/indefinido como undefined no Client", () => {
    const client = rowToClient({
      id: "c-2",
      name: "Maria",
      phone: "11911947694",
      notes: null,
      customer_data: null,
      folder: null,
      mgmv: null,
    } as unknown as Parameters<typeof rowToClient>[0]);
    expect(client.customerData).toBeUndefined();
  });
});