import { describe, it, expect } from "vitest";
import {
  calculateFinancialStatus,
  migrateStoreV3,
  productCollectionStatus,
  type Product,
} from "./store";

const baseProduct = (overrides: Partial<Product>): Product => ({
  id: "x",
  clientId: "c",
  name: "Item",
  platform: "PS5",
  totalValue: 0,
  paidValue: 0,
  financialStatus: "Pendente",
  situation: "Em Aberto",
  registerDate: new Date().toISOString(),
  dueDate: new Date().toISOString(),
  ...overrides,
});

describe("calculateFinancialStatus", () => {
  it("retorna Pendente quando valor pago é zero", () => {
    expect(calculateFinancialStatus(400, 0)).toBe("Pendente");
  });
  it("retorna Reserva quando pago > 0 e < total (mesmo com total alto)", () => {
    expect(calculateFinancialStatus(180, 80)).toBe("Reserva");
    expect(calculateFinancialStatus(300, 100)).toBe("Reserva");
  });
  it("retorna Pago quando pago >= total", () => {
    expect(calculateFinancialStatus(280, 280)).toBe("Pago");
    expect(calculateFinancialStatus(100, 150)).toBe("Pago");
  });
  it("retorna Pendente quando total é zero", () => {
    expect(calculateFinancialStatus(0, 0)).toBe("Pendente");
  });
  it("trata valores nulos/undefined como zero", () => {
    expect(calculateFinancialStatus(null, null)).toBe("Pendente");
    expect(calculateFinancialStatus(undefined, undefined)).toBe("Pendente");
  });
});

describe("migrateStoreV3", () => {
  it("recalcula financialStatus de todos os produtos a partir de total/pago", () => {
    const persisted = {
      products: [
        // status persistido errado: 0 pago marcado como Reserva → vira Pendente
        baseProduct({ id: "a", totalValue: 400, paidValue: 0, financialStatus: "Reserva" }),
        // Figure Goku: parcial marcado como Pendente → vira Reserva
        baseProduct({ id: "b", totalValue: 180, paidValue: 80, financialStatus: "Pendente" }),
        // pago total marcado como Reserva → vira Pago
        baseProduct({ id: "c", totalValue: 250, paidValue: 250, financialStatus: "Reserva" }),
      ],
    };
    const result = migrateStoreV3(persisted) as { products: Product[] };
    expect(result.products.map((p) => [p.id, p.financialStatus])).toEqual([
      ["a", "Pendente"],
      ["b", "Reserva"],
      ["c", "Pago"],
    ]);
  });

  it("preserva status MGMV durante a migração", () => {
    const persisted = {
      products: [
        baseProduct({ id: "m", totalValue: 500, paidValue: 100, financialStatus: "MGMV" }),
      ],
    };
    const result = migrateStoreV3(persisted) as { products: Product[] };
    expect(result.products[0].financialStatus).toBe("MGMV");
  });

  it("não quebra quando products é ausente", () => {
    expect(() => migrateStoreV3({})).not.toThrow();
    expect(() => migrateStoreV3(undefined)).not.toThrow();
  });
});

describe("productCollectionStatus", () => {
  const past = new Date(Date.now() - 5 * 86400000).toISOString();
  const future = new Date(Date.now() + 5 * 86400000).toISOString();

  it("Figure Goku (pago parcial, vencido) aparece como Reserva vencida — nunca Pendente vencido", () => {
    const p = baseProduct({
      totalValue: 180,
      paidValue: 80,
      financialStatus: calculateFinancialStatus(180, 80),
      dueDate: past,
    });
    const status = productCollectionStatus(p);
    expect(p.financialStatus).toBe("Reserva");
    expect(status.label).toBe("Reserva vencida");
    expect(status.variant).toBe("danger");
  });

  it("sem entrada e vencido = Pendente vencido", () => {
    const p = baseProduct({
      totalValue: 400,
      paidValue: 0,
      financialStatus: calculateFinancialStatus(400, 0),
      dueDate: past,
    });
    expect(productCollectionStatus(p).label).toBe("Pendente vencido");
  });

  it("Reserva no prazo = Reserva (warning)", () => {
    const p = baseProduct({
      totalValue: 300,
      paidValue: 100,
      financialStatus: calculateFinancialStatus(300, 100),
      dueDate: future,
    });
    const s = productCollectionStatus(p);
    expect(s.label).toBe("Reserva");
    expect(s.variant).toBe("warning");
  });

  it("nenhum produto com entrada parcial pode terminar como Pendente vencido", () => {
    const persisted = {
      products: [
        baseProduct({ id: "1", totalValue: 180, paidValue: 80, financialStatus: "Pendente", dueDate: past }),
        baseProduct({ id: "2", totalValue: 600, paidValue: 1, financialStatus: "Pendente", dueDate: past }),
      ],
    };
    const migrated = migrateStoreV3(persisted) as { products: Product[] };
    for (const p of migrated.products) {
      expect(productCollectionStatus(p).label).not.toBe("Pendente vencido");
    }
  });
});