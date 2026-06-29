import { describe, it, expect } from "vitest";
import { parseListText, parseMoney, normalizePhone } from "./list-import-parser";

describe("list-import-parser", () => {
  it("parses groups, paid and reserva lines", () => {
    const sample = `Grupo 1:
Breno Yano - 11 91194-7693 - Fire Emblem - Super Original - 60 reais - RESERVA (30)
Zeca - 11 97728-4310 - Final Fantasy VI - Super Original - 80 reais - PAGO

Grupo Action Figures:
Guilherme - 31 9943-0297 - Batman - Pop Alternativo - 60 reais - PAGO`;

    const out = parseListText(sample);
    expect(out.groups).toEqual(["Grupo 1", "Grupo Action Figures"]);
    expect(out.rows).toHaveLength(3);

    const breno = out.rows[0];
    expect(breno.clientName).toBe("Breno Yano");
    expect(breno.phone).toBe("11911947693");
    expect(breno.productName).toBe("Fire Emblem");
    expect(breno.platformOrCategory).toBe("Super Original");
    expect(breno.totalValue).toBe(60);
    expect(breno.paidValue).toBe(30);
    expect(breno.remainingValue).toBe(30);
    expect(breno.financialStatus).toBe("Reserva");
    expect(breno.reviewStatus).toBe("ok");

    const zeca = out.rows[1];
    expect(zeca.financialStatus).toBe("Pago");
    expect(zeca.paidValue).toBe(80);
    expect(zeca.remainingValue).toBe(0);
  });

  it("keeps hyphens inside the product name", () => {
    const out = parseListText(`Grupo 3:
Allef - 81 8995-3053 - Dying Light + EXPANSAO E DLC - PS4 Completo - 60 reais - RESERVA (30)`);
    const row = out.rows[0];
    expect(row.productName).toBe("Dying Light + EXPANSAO E DLC");
    expect(row.platformOrCategory).toBe("PS4 Completo");
    expect(row.paidValue).toBe(30);
    expect(row.remainingValue).toBe(30);
  });

  it("flags RESERVA without value for review", () => {
    const out = parseListText(`Grupo 4:
Joao - 11 91194-7693 - Mario - Switch - 100 reais - RESERVA`);
    expect(out.rows[0].reviewStatus).toBe("review_required");
    expect(out.rows[0].paidValue).toBeNull();
    expect(out.rows[0].warnings.some((w) => w.includes("Valor pago"))).toBe(true);
  });

  it("flags invalid phones", () => {
    const out = parseListText(`Grupo 5:
Joao - 123 - Mario - Switch - 100 reais - PAGO`);
    expect(out.rows[0].phoneValid).toBe(false);
    expect(out.rows[0].reviewStatus).toBe("review_required");
  });

  it("groups duplicate clients by name+phone", () => {
    const out = parseListText(`Grupo 1:
Breno - 11 91194-7693 - A - X - 60 reais - RESERVA (30)
Breno - 11 91194-7693 - B - Y - 50 reais - RESERVA (20)`);
    expect(out.clients).toHaveLength(1);
    expect(out.clients[0].totalValue).toBe(110);
    expect(out.clients[0].paidValue).toBe(50);
    expect(out.clients[0].remainingValue).toBe(60);
  });

  it("detects duplicate-candidate when phone repeats with diff name", () => {
    const out = parseListText(`Grupo 1:
Breno - 11 91194-7693 - A - X - 60 reais - PAGO
Bruno - 11 91194-7693 - B - Y - 60 reais - PAGO`);
    expect(out.rows[0].duplicateCandidate).toBe(true);
    expect(out.rows[1].duplicateCandidate).toBe(true);
  });

  it("parseMoney accepts variations", () => {
    expect(parseMoney("60 reais")).toBe(60);
    expect(parseMoney("R$ 60")).toBe(60);
    expect(parseMoney("R$60,00")).toBe(60);
    expect(parseMoney("60,50")).toBe(60.5);
    expect(parseMoney("1.200,00")).toBe(1200);
  });

  it("normalizePhone validates length", () => {
    expect(normalizePhone("11 91194-7693").valid).toBe(true);
    expect(normalizePhone("11 9194-7693").valid).toBe(true);
    expect(normalizePhone("12345").valid).toBe(false);
  });
});