import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase client BEFORE importing the module under test.
type Range = { from: number; to: number };
let pages: Record<string, unknown[]> = {};
let calls: Record<string, Range[]> = {};

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      from(table: string) {
        return {
          select(_columns: string) {
            return {
              range(from: number, to: number) {
                calls[table] = calls[table] ?? [];
                calls[table].push({ from, to });
                const all = pages[table] ?? [];
                const slice = all.slice(from, to + 1);
                return Promise.resolve({ data: slice, error: null });
              },
            };
          },
        };
      },
    },
  };
});

import { fetchAllRows } from "./db-sync";

function makeRows(n: number, prefix = "r") {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}` }));
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
  });

  it("pagina em lotes de 1000 (3 chamadas para 2500 linhas)", async () => {
    pages.products = makeRows(2500, "p");
    await fetchAllRows("products");
    expect(calls.products).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
      { from: 2000, to: 2999 },
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
        range: () => Promise.resolve({ data: null, error: { message: "boom" } }),
      }),
    });
    const res = await fetchAllRows("clients");
    expect(res.data).toBeNull();
    expect(res.error).toEqual({ message: "boom" });
    (mod.supabase as unknown as { from: unknown }).from = original;
  });
});