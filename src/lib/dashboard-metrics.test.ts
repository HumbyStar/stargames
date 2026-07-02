import { describe, it, expect } from "vitest";
import {
  ALERT_PREVIEW_KEYS,
  computeDashboardAggregates,
} from "./dashboard-metrics";
import type { Client, Product } from "./store";

const day = (offset: number) =>
  new Date(Date.now() + offset * 86400000).toISOString();

const product = (over: Partial<Product>): Product => ({
  id: "p",
  clientId: "c1",
  name: "Item",
  platform: "PS5",
  totalValue: 100,
  paidValue: 0,
  financialStatus: "Pendente",
  situation: "Em Aberto",
  registerDate: day(-10),
  dueDate: day(-1),
  ...over,
});

const client = (over: Partial<Client>): Client => ({
  id: "c1",
  name: "Cliente Teste",
  phone: "11 90000-0000",
  ...over,
});

describe("computeDashboardAggregates", () => {
  it("retorna zeros quando não há dados", () => {
    const a = computeDashboardAggregates([], []);
    expect(a.totalClients).toBe(0);
    expect(a.totalProducts).toBe(0);
    expect(a.overdueTotal).toBe(0);
    expect(a.topAlerts).toEqual([]);
  });

  it("conta reservas ativas e vencidas independentemente", () => {
    const products = [
      product({ id: "p1", financialStatus: "Reserva", dueDate: day(-2) }),
      product({ id: "p2", financialStatus: "Reserva", dueDate: day(5) }),
      product({ id: "p3", financialStatus: "Reserva", dueDate: day(-10) }),
    ];
    const a = computeDashboardAggregates([client({})], products);
    expect(a.reservasAtivas).toBe(3);
    expect(a.reservasVencidas).toBe(2);
    expect(a.finReserva).toBe(3);
  });

  it("classifica situações e status financeiros num único passo", () => {
    const products = [
      product({ id: "e1", situation: "Enviado", financialStatus: "Pago" }),
      product({ id: "d1", situation: "Desistiu" }),
      product({ id: "ab", situation: "Abandonou" }),
      product({ id: "pg", financialStatus: "Pago" }),
      product({ id: "mg", financialStatus: "MGMV" }),
    ];
    const a = computeDashboardAggregates([client({})], products);
    expect(a.enviados).toBe(1);
    expect(a.desistencias).toBe(1);
    expect(a.abandonos).toBe(1);
    expect(a.finPago).toBe(2);
    expect(a.finMGMV).toBe(1);
    expect(a.aberto).toBe(2);
  });

  it("conta clientes MGMV e parcelas vencidas", () => {
    const c = client({
      id: "c2",
      mgmv: {
        startDate: day(-30),
        totalDebt: 300,
        installments: [
          { number: 1, total: 3, dueDate: day(-20), value: 100, paid: true },
          { number: 2, total: 3, dueDate: day(-5), value: 100, paid: false },
          { number: 3, total: 3, dueDate: day(20), value: 100, paid: false },
        ],
      },
    });
    const a = computeDashboardAggregates([c], []);
    expect(a.clientesMGMV).toBe(1);
    expect(a.mgmvVencidas).toBe(1);
  });

  it("limita topAlerts a 3 e reporta overdueTotal completo", () => {
    const products = Array.from({ length: 6 }, (_, i) =>
      product({
        id: `p${i}`,
        financialStatus: "Reserva",
        dueDate: day(-10),
        paidValue: 20,
      }),
    );
    const a = computeDashboardAggregates([client({})], products);
    expect(a.topAlerts.length).toBe(3);
    expect(a.overdueTotal).toBe(6);
  });

  it("não vaza referências completas de Product/Client no preview", () => {
    const products = [
      product({
        id: "leak",
        financialStatus: "Reserva",
        dueDate: day(-10),
        paidValue: 10,
        notes: "conteúdo interno privado",
      }),
    ];
    const a = computeDashboardAggregates([client({})], products);
    const [alert] = a.topAlerts;
    expect(Object.keys(alert).sort()).toEqual([...ALERT_PREVIEW_KEYS].sort());
    // qualquer campo fora do allow-list é ausente
    expect((alert as unknown as Record<string, unknown>).notes).toBeUndefined();
    expect((alert as unknown as Record<string, unknown>).situation).toBeUndefined();
  });

  it("é puro: mesmas entradas produzem saídas deeply-equal", () => {
    const c = [client({})];
    const p = [product({ id: "x", financialStatus: "Reserva" })];
    const a1 = computeDashboardAggregates(c, p);
    const a2 = computeDashboardAggregates(c, p);
    expect(a1).toEqual(a2);
  });

  it("execução única (varredura) — 5k produtos < 100ms como sanity check", () => {
    const products = Array.from({ length: 5000 }, (_, i) =>
      product({ id: `p${i}`, financialStatus: i % 3 === 0 ? "Reserva" : "Pago" }),
    );
    const t0 = performance.now();
    const a = computeDashboardAggregates([client({})], products);
    const dur = performance.now() - t0;
    expect(a.totalProducts).toBe(5000);
    // guardrail — se cair, algo virou O(n²) sem querer
    expect(dur).toBeLessThan(100);
  });
});