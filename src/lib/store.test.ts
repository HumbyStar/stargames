import { describe, it, expect } from "vitest";
import {
  calculateFinancialStatus,
  calculateReservaDueDate,
  migrateStoreV3,
  normalizeProductDueDateForCreate,
  productCollectionStatus,
  applyMGMVPartialPayment,
  type MGMVInstallment,
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

describe("reserva due date", () => {
  it("força limite de Reserva para um mês após o cadastro", () => {
    expect(calculateReservaDueDate("2026-07-17").slice(0, 10)).toBe("2026-08-17");
  });

  it("corrige Reserva criada com limite igual ao cadastro", () => {
    const normalized = normalizeProductDueDateForCreate(
      baseProduct({
        financialStatus: "Reserva",
        registerDate: "2026-07-17T12:00:00.000Z",
        dueDate: "2026-07-17T12:00:00.000Z",
      }),
    );
    expect(normalized.dueDate.slice(0, 10)).toBe("2026-08-17");
  });
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

describe("applyMGMVPartialPayment", () => {
  const NOW = "2026-01-01T00:00:00.000Z";
  const mkInstallments = (values: number[]): MGMVInstallment[] =>
    values.map((v, idx) => ({
      number: idx + 1,
      total: values.length,
      dueDate: new Date(2026, 0, 10 + idx).toISOString(),
      value: v,
      paid: false,
    }));

  it("pagamento parcial MENOR que o valor da parcela: alvo vira paga curta, restante é SOMADO nas OUTRAS pendentes (nunca desconta)", () => {
    const ins = mkInstallments([100, 100, 100, 100]);
    const res = applyMGMVPartialPayment(ins, 2, 40, 400, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const target = res.installments.find((i) => i.number === 2)!;
    // Valor original preservado, mas alvo agora paga (quitação curta)
    expect(target.value).toBe(100);
    expect(target.paid).toBe(true);
    expect(target.paidAmount).toBeCloseTo(40, 5);
    expect(target.manualPartial).toBe(true);
    expect(target.shortPaid).toBe(true);
    // Shortfall = 100 − 40 = 60. Somado em 3 outras = +20 cada → 120 cada.
    const others = res.installments.filter((i) => i.number !== 2);
    expect(others.every((i) => i.value === 120)).toBe(true);
    expect(others.every((i) => i.recalculatedAt === NOW)).toBe(true);
    expect(res.targetFullyPaid).toBe(false);
    expect(res.becameQuitado).toBe(false);
  });

  it("sequência de parciais inferiores nunca gera desconto — outras sempre crescem", () => {
    // Estado inicial: 4× 100, saldo 400.
    const ins = mkInstallments([100, 100, 100, 100]);
    const r1 = applyMGMVPartialPayment(ins, 2, 40, 400, NOW);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    // Após 1º parcial: #2 paga curta, #1/#3/#4 = 120.
    const afterFirst = r1.installments;
    expect(afterFirst.find((i) => i.number === 1)!.value).toBe(120);
    expect(afterFirst.find((i) => i.number === 3)!.value).toBe(120);
    expect(afterFirst.find((i) => i.number === 4)!.value).toBe(120);

    // Novo saldo do acordo = 400 − 40 = 360. Pagar 30 na #3 (value 120).
    const r2 = applyMGMVPartialPayment(afterFirst, 3, 30, 360, NOW);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const t3 = r2.installments.find((i) => i.number === 3)!;
    expect(t3.paid).toBe(true);
    expect(t3.shortPaid).toBe(true);
    expect(t3.paidAmount).toBe(30);
    // Shortfall = 120 − 30 = 90. Somado em 2 outras pendentes (#1 e #4).
    // +45 cada → 165 cada. NUNCA menor que o valor anterior (120).
    const n1 = r2.installments.find((i) => i.number === 1)!;
    const n4 = r2.installments.find((i) => i.number === 4)!;
    expect(n1.value).toBe(165);
    expect(n4.value).toBe(165);
    expect(n1.value).toBeGreaterThanOrEqual(120);
    expect(n4.value).toBeGreaterThanOrEqual(120);
  });

  it("pagamento IGUAL ao valor da parcela: alvo vira paga, sem excedente para redistribuir; demais pendentes ficam iguais", () => {
    const ins = mkInstallments([100, 100, 100, 100]);
    const res = applyMGMVPartialPayment(ins, 1, 100, 400, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const target = res.installments.find((i) => i.number === 1)!;
    expect(target.paid).toBe(true);
    expect(target.paidAmount).toBe(100);
    // Outras mantêm valor original — nada foi recalculado (300/3 = 100)
    const others = res.installments.filter((i) => i.number !== 1);
    expect(others.every((i) => i.value === 100)).toBe(true);
    expect(others.every((i) => !i.recalculatedAt)).toBe(true);
    expect(res.targetFullyPaid).toBe(true);
  });

  it("pagamento MAIOR que o valor da parcela: alvo vira paga e excedente reduz as outras pendentes igualmente", () => {
    const ins = mkInstallments([100, 100, 100, 100]);
    const res = applyMGMVPartialPayment(ins, 1, 130, 400, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const target = res.installments.find((i) => i.number === 1)!;
    expect(target.paid).toBe(true);
    // Restante: 400 - 130 = 270, dividido em 3 = 90 cada
    const others = res.installments.filter((i) => i.number !== 1);
    expect(others.map((i) => i.value)).toEqual([90, 90, 90]);
    expect(others.every((i) => i.recalculatedAt === NOW)).toBe(true);
  });

  it("pagamento que quita todo o acordo marca becameQuitado", () => {
    const ins = mkInstallments([50, 50]);
    ins[0].paid = true;
    ins[0].paidAmount = 50;
    const res = applyMGMVPartialPayment(ins, 2, 50, 50, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.becameQuitado).toBe(true);
  });

  it("rejeita valor não numérico, zero, negativo e acima do saldo restante", () => {
    const ins = mkInstallments([100, 100]);
    expect(applyMGMVPartialPayment(ins, 1, Number.NaN, 200).ok).toBe(false);
    expect(applyMGMVPartialPayment(ins, 1, 0, 200).ok).toBe(false);
    expect(applyMGMVPartialPayment(ins, 1, -10, 200).ok).toBe(false);
    expect(applyMGMVPartialPayment(ins, 1, 500, 200).ok).toBe(false);
  });

  it("rejeita parcela inexistente ou já paga", () => {
    const ins = mkInstallments([100, 100]);
    ins[0].paid = true;
    expect(applyMGMVPartialPayment(ins, 99, 10, 100).ok).toBe(false);
    expect(applyMGMVPartialPayment(ins, 1, 10, 100).ok).toBe(false);
  });

  it("não deixa value da parcela redistribuída ficar abaixo do paidAmount já existente (sem saldo negativo)", () => {
    // Parcela 2 já tem um parcial de 80. Um pagamento IGUAL na #1 rateia
    // o novo saldo do acordo entre as outras — deve respeitar piso 80.
    const ins = mkInstallments([100, 100]);
    ins[1].paidAmount = 80;
    // saldo restante = (100 + 100) - 80 = 120
    const res = applyMGMVPartialPayment(ins, 1, 100, 120, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const other = res.installments.find((i) => i.number === 2)!;
    // Novo saldo = 120 − 100 = 20, rateado em 1 outra = 20. Piso = 80.
    expect(other.value).toBeGreaterThanOrEqual(80);
    expect(other.value).toBe(80);
  });
});