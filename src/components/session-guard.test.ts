import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";

type AnyArgs = unknown[];
const claimSpy = vi.fn<(...args: AnyArgs) => Promise<{ ok: true; sessionId: string }>>(
  async () => ({ ok: true, sessionId: "x" }),
);
const heartbeatSpy = vi.fn<(...args: AnyArgs) => Promise<{ valid: true }>>(
  async () => ({ valid: true }),
);
const releaseSpy = vi.fn<(...args: AnyArgs) => Promise<{ ok: true }>>(
  async () => ({ ok: true }),
);

vi.mock("@/lib/session-guard.functions", () => ({
  claimSession: (...a: AnyArgs) => claimSpy(...a),
  heartbeatSession: (...a: AnyArgs) => heartbeatSpy(...a),
  releaseSession: (...a: AnyArgs) => releaseSpy(...a),
}));

const mem: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in mem ? mem[k] : null),
  setItem: (k: string, v: string) => {
    mem[k] = v;
  },
  removeItem: (k: string) => {
    delete mem[k];
  },
  clear: () => {
    for (const k of Object.keys(mem)) delete mem[k];
  },
};
(globalThis as any).location = { pathname: "/dashboard" };

import { handleSessionUnload, SESSION_ID_KEY } from "./session-guard";

describe("session-guard unload", () => {
  beforeEach(() => {
    claimSpy.mockClear();
    heartbeatSpy.mockClear();
    releaseSpy.mockClear();
    localStorage.setItem(SESSION_ID_KEY, "abcdefgh");
  });
  afterEach(() => localStorage.clear());

  it("nunca dispara RPC em beforeunload", () => {
    handleSessionUnload("beforeunload");
    expect(claimSpy).not.toHaveBeenCalled();
    expect(heartbeatSpy).not.toHaveBeenCalled();
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  it("nunca dispara RPC em pagehide, mesmo sem sessionId local", () => {
    localStorage.removeItem(SESSION_ID_KEY);
    handleSessionUnload("pagehide");
    expect(claimSpy).not.toHaveBeenCalled();
    expect(heartbeatSpy).not.toHaveBeenCalled();
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  it("registra log estruturado com contexto de rota", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    handleSessionUnload("beforeunload");
    expect(info).toHaveBeenCalledWith(
      "[session-guard] unload",
      expect.objectContaining({
        reason: "beforeunload",
        hasSessionId: true,
        path: "/dashboard",
      }),
    );
    // Não deve incluir tokens ou dados sensíveis no payload.
    const payload = info.mock.calls[0]?.[1] as Record<string, unknown>;
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/access_token|bearer|authorization/i);
    info.mockRestore();
  });

  it("não dispara RPC em visibilitychange (aba oculta)", () => {
    handleSessionUnload("visibilitychange");
    expect(claimSpy).not.toHaveBeenCalled();
    expect(heartbeatSpy).not.toHaveBeenCalled();
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  it("não dispara RPC em freeze (Page Lifecycle)", () => {
    handleSessionUnload("freeze");
    expect(claimSpy).not.toHaveBeenCalled();
    expect(heartbeatSpy).not.toHaveBeenCalled();
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  it("módulo session-guard não importa nem referencia releaseSession", () => {
    const src = fs.readFileSync("src/components/session-guard.tsx", "utf8");
    expect(src).not.toMatch(/releaseSession/);
  });
});
