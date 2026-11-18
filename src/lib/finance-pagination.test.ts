import { describe, expect, it } from "vitest";
import { readFinancePages } from "./finance-pagination";

describe("financial pagination", () => {
  it("reads beyond a full batch without omitting or duplicating rows", async () => {
    const rows = Array.from({ length: 9103 }, (_, id) => id);
    let active = 0;
    let peak = 0;
    const result = await readFinancePages(async (from, to) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return rows.slice(from, to + 1);
    });
    expect(result).toEqual(rows);
    expect(peak).toBe(4);
  });

  it("rejects a failed page instead of returning incomplete totals", async () => {
    await expect(readFinancePages(async (from) => {
      if (from === 1000) throw new Error("connection failed");
      return [] as number[];
    })).rejects.toThrow("connection failed");
  });
});