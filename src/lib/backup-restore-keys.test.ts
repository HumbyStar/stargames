import { describe, expect, it } from "vitest";
import { dedupeRestoreRows, restoreRowKey } from "./backup-restore-keys";

describe("backup restore keys", () => {
  it("consolida configurações que convergem para a mesma chave no sandbox", () => {
    const result = dedupeRestoreRows("app_settings", [
      { id: "default", env: "sandbox", ui_state: { version: 1 } },
      { id: "default", env: "sandbox", ui_state: { version: 2 } },
    ]);

    expect(result.removed).toBe(1);
    expect(result.rows).toEqual([
      { id: "default", env: "sandbox", ui_state: { version: 2 } },
    ]);
  });

  it("usa a chave composta do perfil de treinamento", () => {
    expect(restoreRowKey("ai_training_profile", { user_id: "u1", env: "sandbox" })).toBe(
      "u1\u0000sandbox",
    );
  });

  it("trata batidas de produção e do modo teste como registros independentes", () => {
    const production = { id: "p", user_id: "u1", day: "2026-06-29", kind: "in", env: "producao" };
    const sandbox = { id: "s", user_id: "u1", day: "2026-06-29", kind: "in", env: "sandbox" };

    expect(restoreRowKey("team_punch_entries", production)).not.toBe(
      restoreRowKey("team_punch_entries", sandbox),
    );
    expect(
      dedupeRestoreRows("team_punch_entries", [production, sandbox]).removed,
    ).toBe(0);
  });
});