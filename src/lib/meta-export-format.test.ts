import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  buildAnalyticCsv,
  buildMetaCsv,
  filterLeads,
  isLeadComplete,
  metaRow,
  missingFields,
  sha256Hex,
  splitName,
  toE164,
  type MetaLead,
} from "./meta-export-format";

function lead(over: Partial<MetaLead> = {}): MetaLead {
  return {
    id: "c1",
    name: "João Silva",
    phone: "11987654321",
    clientType: "common",
    createdAt: new Date(Date.now() - 400 * 86_400_000).toISOString(),
    folder: "",
    productCount: 3,
    totalValue: 300,
    paidValue: 300,
    openValue: 0,
    avgTicket: 100,
    firstPurchase: new Date(Date.now() - 300 * 86_400_000).toISOString(),
    lastPurchase: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    platforms: ["PS5"],
    situations: ["Em Aberto"],
    financialStatuses: ["Pago"],
    hasShipment: false,
    mgmvStatus: "",
    ficha: {
      fullName: "João da Silva",
      cpfCnpj: "12345678900",
      email: "Joao@Email.com ",
      phone: "11987654321",
      cep: "01310100",
      street: "Av Paulista",
      number: "1000",
      complement: "",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
    },
    ...over,
  };
}

describe("normalização", () => {
  it("converte telefone para E.164", () => {
    expect(toE164("(11) 98765-4321")).toBe("+5511987654321");
    expect(toE164("5511987654321")).toBe("+5511987654321");
    expect(toE164("123")).toBe("");
  });

  it("divide nome em primeiro/último", () => {
    expect(splitName("João da Silva")).toEqual({ first: "joao", last: "silva" });
  });

  it("gera hash sha-256 estável", async () => {
    expect(await sha256Hex("joao@email.com")).toHaveLength(64);
    expect(await sha256Hex("")).toBe("");
  });
});

describe("completude da ficha", () => {
  it("aprova ficha completa", () => {
    expect(isLeadComplete(lead())).toBe(true);
  });

  it("aponta campos faltando", () => {
    const l = lead({
      ficha: { ...lead().ficha, email: "", cpfCnpj: "", cep: "", state: "", city: "" },
    });
    expect(missingFields(l).sort()).toEqual(["cep", "email", "state"]);
  });
});

describe("filtros", () => {
  it("filtra por total comprado e UF", () => {
    const rows = [lead(), lead({ id: "c2", totalValue: 50, ficha: { ...lead().ficha, state: "RJ" } })];
    expect(filterLeads(rows, { ...EMPTY_FILTERS, totalMin: 100 }).map((l) => l.id)).toEqual(["c1"]);
    expect(filterLeads(rows, { ...EMPTY_FILTERS, states: ["RJ"] }).map((l) => l.id)).toEqual(["c2"]);
  });

  it("remove duplicados por telefone", () => {
    const rows = [lead(), lead({ id: "c2" })];
    expect(filterLeads(rows, { ...EMPTY_FILTERS, dedupePhone: true })).toHaveLength(1);
  });

  it("filtra inatividade", () => {
    const rows = [lead()];
    expect(filterLeads(rows, { ...EMPTY_FILTERS, inactiveForDays: 100 })).toHaveLength(0);
    expect(filterLeads(rows, { ...EMPTY_FILTERS, lastPurchaseWithinDays: 30 })).toHaveLength(1);
  });
});

describe("exportação", () => {
  it("gera linha Meta normalizada", async () => {
    const row = await metaRow(lead(), false);
    expect(row.slice(0, 8)).toEqual([
      "joao@email.com",
      "+5511987654321",
      "joao",
      "silva",
      "sao paulo",
      "sp",
      "01310100",
      "br",
    ]);
  });

  it("aplica hash mantendo país em texto", async () => {
    const row = await metaRow(lead(), true);
    expect(row[0]).toHaveLength(64);
    expect(row[7]).toBe("br");
  });

  it("gera CSVs com cabeçalho", async () => {
    expect((await buildMetaCsv([lead()], false)).split("\r\n")[0]).toContain("email,phone,fn,ln");
    expect(buildAnalyticCsv([lead()]).split("\r\n")[0]).toContain("nome_sistema");
  });
});
