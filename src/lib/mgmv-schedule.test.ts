import { describe, it, expect } from "vitest";
import { rebalanceAgreement } from "./mgmv-schedule";
import type { MGMVAgreement } from "./store";

function makeAgreement(): MGMVAgreement {
  return {
    startDate: new Date("2026-01-15T12:00:00").toISOString(),
    totalDebt: 500,
    installments: Array.from({ length: 5 }, (_, i) => ({
      number: i + 1,
      total: 5,
      dueDate: new Date(2026, i + 1, 15, 12).toISOString(),
      value: 100,
      paid: false,
    })),
  };
}

describe("rebalanceAgreement", () => {
  it("redistributes remaining balance uniformly across pending installments", () => {
    const a = makeAgreement();
    const r = rebalanceAgreement(a, { targetInstallmentsCount: 10 });
    expect(r.agreement.installments).toHaveLength(10);
    expect(r.pendingValue).toBe(50);
    expect(r.agreement.installments.every((i) => i.value === 50)).toBe(true);
  });

  it("bumps installment count when minimum forces it (5x100 + parcial 50 → 10x50)", () => {
    const a = makeAgreement();
    // Registra pagamento parcial de 50 na parcela 1.
    a.installments[0] = { ...a.installments[0], paidAmount: 50 };
    const r = rebalanceAgreement(a, {
      targetInstallmentsCount: 5,
      minInstallmentValue: 50,
    });
    expect(r.bumpedInstallments).toBe(true);
    // 450 restante / 50 min = 9 pendentes + 0 pagas totais + 1 parcial pendente
    // Como o parcial não estava pago, paidCount=0, e pendingCount=ceil(450/50)=9.
    expect(r.agreement.installments).toHaveLength(9);
    expect(r.remaining).toBe(450);
    expect(r.pendingValue).toBe(50);
  });

  it("preserves paid installments (paidAt / paidAmount / dueDate)", () => {
    const a = makeAgreement();
    const paidAt = new Date("2026-02-15T12:00:00").toISOString();
    a.installments[0] = {
      ...a.installments[0],
      paid: true,
      paidAt,
      paidAmount: 100,
    };
    const r = rebalanceAgreement(a, { targetInstallmentsCount: 6 });
    const p1 = r.agreement.installments[0];
    expect(p1.paid).toBe(true);
    expect(p1.paidAt).toBe(paidAt);
    expect(p1.paidAmount).toBe(100);
    expect(r.agreement.installments).toHaveLength(6);
    // Remaining = 400 across 5 pending → 80 each.
    const pending = r.agreement.installments.filter((i) => !i.paid);
    expect(pending).toHaveLength(5);
    expect(pending.every((i) => i.value === 80)).toBe(true);
  });

  it("adjusts total when a product is removed (newTotalDebt)", () => {
    const a = makeAgreement();
    const r = rebalanceAgreement(a, {
      newTotalDebt: 300,
      targetInstallmentsCount: 5,
    });
    expect(r.agreement.totalDebt).toBe(300);
    expect(r.remaining).toBe(300);
    expect(r.pendingValue).toBe(60);
  });
});