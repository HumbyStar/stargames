import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";

const claimSpy = vi.fn(async () => ({ ok: true, sessionId: "x" }));
const heartbeatSpy = vi.fn(async () => ({ valid: true }));
const releaseSpy = vi.fn(async () => ({ ok: true }));

vi.mock("@/lib/session-guard.functions", () => ({
  claimSession: (...a: unknown[]) => claimSpy(...a),
  heartbeatSession: (...a: unknown[]) => heartbeatSpy(...a),
  releaseSession: (...a: unknown[]) => releaseSpy(...a),
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
    info.mockRestore();
  });

  it("módulo session-guard não importa nem referencia releaseSession", () => {
    const src = fs.readFileSync("src/components/session-guard.tsx", "utf8");
    expect(src).not.toMatch(/releaseSession/);
  });
});
