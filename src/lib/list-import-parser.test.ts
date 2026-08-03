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

  it("aplica sinal padrão de R$10 quando RESERVA vem sem valor", () => {
    const out = parseListText(`Grupo 4:
Joao - 11 91194-7693 - Mario - Switch - 100 reais - RESERVA`);
    expect(out.rows[0].reviewStatus).toBe("ok");
    expect(out.rows[0].paidValue).toBe(10);
    expect(out.rows[0].remainingValue).toBe(90);
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

  it("lê 'Data de Entrada' e 'Data Limite' do cabeçalho", () => {
    const out = parseListText(`Data de Entrada: 23/07/26
Data Limite: 23/08/26

Grupo 1:
Breno - 11 91194-7693 - Fire Emblem - Switch - 60 reais - RESERVA (30)`);
    expect(out.headerDate).toBe("2026-07-23");
    expect(out.headerDueDate).toBe("2026-08-23");
  });

  it("ignora 'Data Limite' <= 'Data de Entrada'", () => {
    const out = parseListText(`Data de Entrada: 23/07/26
Data Limite: 20/07/26

Grupo 1:
Breno - 11 91194-7693 - Fire Emblem - Switch - 60 reais - RESERVA (30)`);
    expect(out.headerDate).toBe("2026-07-23");
    expect(out.headerDueDate).toBeUndefined();
  });
});
describe("correções de formatação (lista colada)", () => {
  it("divide dois clientes grudados na mesma linha", () => {
    const out = parseListText(
      ` soldier - 13 99805-6851 - Pure Vessel (Hollow Knight) - Figure - 80 reais  - Pago  Zanon - 44 9984-8236 - Dragon Quest XI: Echoes of an Elusive Age - PS4 - 90 reais -  Reserva`,
    );
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0].clientName).toBe("soldier");
    expect(out.rows[0].productName).toBe("Pure Vessel (Hollow Knight)");
    expect(out.rows[1].clientName).toBe("Zanon");
    expect(out.rows[1].phone).toBe("4499848236");
    expect(out.rows[1].financialStatus).toBe("Reserva");
    expect(out.totals.splitRows).toBe(2);
  });

  it("marca plataforma ausente sem perder o produto", () => {
    const out = parseListText("Paulo - 11 98504-6889 - Controle de PS2 - 50 reais - Reserva");
    const r = out.rows[0];
    expect(r.productName).toBe("Controle de PS2");
    expect(r.platformOrCategory).toBe("—");
    expect(r.reviewStatus).toBe("review_required");
    expect(out.totals.missingPlatformRows).toBe(1);
  });

  it("aceita Reserva(65) e status em minúsculo", () => {
    const out = parseListText(
      `Gaby Anad - 91 9178-1390 - Sabrina Spellman - Funko Pop 777 - 130 reais  - Reserva(65)
CODE - 62 99224-5792 - The Knight (Hollow Knight) - Figure - 50 reais - reserva`,
    );
    expect(out.rows[0].financialStatus).toBe("Reserva");
    expect(out.rows[0].paidValue).toBe(65);
    expect(out.rows[1].financialStatus).toBe("Reserva");
  });

  it("ignora cabeçalho solto e sinaliza telefone de 10 dígitos", () => {
    const out = parseListText(
      `PASSADOS

Pedro Paulo - 32 9199-7720 - Pac Man - Atari 2600 ORIGINAL - 70 reais - Pago`,
    );
    expect(out.rows).toHaveLength(1);
    expect(out.totals.shortPhones).toBe(1);
    expect(out.rows[0].reviewStatus).toBe("ok");
  });
});

describe("canonicalPhone", () => {
  it("insere o 9 ausente em celular de 10 dígitos", () => {
    expect(canonicalPhone("1588267132")).toBe("15988267132");
    expect(canonicalPhone("15 98826-7132")).toBe("15988267132");
  });

  it("mantém telefone fixo de 10 dígitos", () => {
    expect(canonicalPhone("1533221100")).toBe("1533221100");
  });

  it("remove o DDI 55", () => {
    expect(canonicalPhone("+55 15 98826-7132")).toBe("15988267132");
    expect(canonicalPhone("551588267132")).toBe("15988267132");
  });

  it("normalizePhone expõe canonical e wasFixed", () => {
    const a = normalizePhone("1588267132");
    expect(a.canonical).toBe("15988267132");
    expect(a.wasFixed).toBe(true);
    const b = normalizePhone("15988267132");
    expect(b.wasFixed).toBe(false);
  });
});
