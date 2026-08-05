import { describe, it, expect } from "vitest";
import { waitForRowConfirmation, notifyRowConfirmed } from "./write-confirm";

describe("waitForRowConfirmation — importação (upsert)", () => {
  it("confirma quando o banco já tem as linhas importadas", async () => {
    const res = await waitForRowConfirmation("client", ["c1", "c2"], "upsert", {
      verify: async (_k, ids) => new Set(ids),
      pollMs: 10,
      timeoutMs: 500,
    });
    expect(res.ok).toBe(true);
    expect(res.confirmed.sort()).toEqual(["c1", "c2"]);
  });

  it("confirma pelo evento realtime da própria linha, sem consultar o banco", async () => {
    const p = waitForRowConfirmation("product", ["p1"], "upsert", {
      pollMs: 10,
      timeoutMs: 1000,
    });
    setTimeout(() => notifyRowConfirmed("product", "p1", "upsert"), 20);
    const res = await p;
    expect(res.ok).toBe(true);
  });

  it("NÃO confirma (sem sucesso falso) quando a linha nunca chega ao banco", async () => {
    const res = await waitForRowConfirmation("product", ["p9"], "upsert", {
      verify: async () => new Set<string>(),
      pollMs: 10,
      timeoutMs: 60,
    });
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(["p9"]);
  });
});

describe("waitForRowConfirmation — exclusão (delete)", () => {
  it("confirma somente quando a linha desaparece do banco", async () => {
    let stillThere = true;
    setTimeout(() => (stillThere = false), 30);
    const res = await waitForRowConfirmation("product", ["p1"], "delete", {
      verify: async (_k, ids) => (stillThere ? new Set(ids) : new Set<string>()),
      pollMs: 10,
      timeoutMs: 1000,
    });
    expect(res.ok).toBe(true);
  });

  it("falha quando a linha permanece no banco — a UI deve reverter", async () => {
    const res = await waitForRowConfirmation("product", ["p1"], "delete", {
      verify: async (_k, ids) => new Set(ids),
      pollMs: 10,
      timeoutMs: 60,
    });
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(["p1"]);
  });

  it("erro transitório de rede não vira confirmação", async () => {
    const res = await waitForRowConfirmation("client", ["c1"], "delete", {
      verify: async () => {
        throw new Error("network");
      },
      pollMs: 10,
      timeoutMs: 60,
    });
    expect(res.ok).toBe(false);
  });

  it("lista vazia é sucesso imediato", async () => {
    const res = await waitForRowConfirmation("client", [], "upsert");
    expect(res.ok).toBe(true);
  });
});
