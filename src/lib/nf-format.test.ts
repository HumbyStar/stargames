import { describe, it, expect } from "vitest";
import {
  buildFiscalHeader,
  formatNcm,
  groupByNcm,
  missingFiscalFields,
  renderNfText,
  type NfProduct,
} from "./nf-format";
import type { CustomerFiscalData } from "./customer-data-ai.functions";

const fiscal: CustomerFiscalData = {
  fullName: "Humberto Gomes",
  cpfCnpj: "15845748798",
  email: "",
  phone: "",
  cep: "18070700",
  street: "Rua José Gabrioti",
  number: "522",
  complement: "",
  neighborhood: "Vila Nova Sorocaba",
  city: "Sorocaba",
  state: "SP",
  notes: "",
  missing: [],
};

describe("formatNcm", () => {
  it("mascara 8 dígitos", () => {
    expect(formatNcm("85234990")).toBe("8523.49.90");
    expect(formatNcm("8523.49.90")).toBe("8523.49.90");
  });
});

describe("missingFiscalFields", () => {
  it("detecta faltantes obrigatórios", () => {
    const miss = missingFiscalFields({ ...fiscal, cep: "", number: "" });
    expect(miss).toContain("CEP");
    expect(miss).toContain("Número");
  });
});

describe("buildFiscalHeader", () => {
  it("gera header formatado", () => {
    const h = buildFiscalHeader(fiscal);
    expect(h).toContain("Humberto Gomes");
    expect(h).toContain("158.457.487-98");
    expect(h).toContain("18070-700");
    expect(h).toContain("Sorocaba/SP");
  });
});

describe("groupByNcm + renderNfText", () => {
  const products: NfProduct[] = [
    { id: "a", name: "Avatar", platform: "PSP", totalValue: 60 },
    { id: "b", name: "Resistance", platform: "PS3", totalValue: 80 },
    { id: "c", name: "Uncharted", platform: "PS3", totalValue: 70 },
    { id: "d", name: "Prince of Persia", platform: "PSP", totalValue: 50 },
    { id: "e", name: "Controle X", platform: "PS3", totalValue: 100 },
  ];
  const classifications = [
    { id: "a", ncm: "85234990", category: "Jogos de videogame mídia física" },
    { id: "b", ncm: "8523.49.90", category: "Jogos de videogame mídia física" },
    { id: "c", ncm: "8523.49.90", category: "Jogos de videogame mídia física" },
    { id: "d", ncm: "85234990", category: "Jogos de videogame mídia física" },
    { id: "e", ncm: "95045000", category: "Acessórios de videogame" },
  ];

  it("agrupa por NCM e calcula subtotais", () => {
    const g = groupByNcm(products, classifications);
    expect(g).toHaveLength(2);
    const jogos = g.find((x) => x.ncm === "8523.49.90")!;
    expect(jogos.items).toHaveLength(4);
    expect(jogos.subtotal).toBe(260);
  });

  it("empurra sem classificação para o fim", () => {
    const g = groupByNcm(products, [
      { id: "a", ncm: "", category: "" },
      { id: "b", ncm: "8523.49.90", category: "Jogos" },
      { id: "c", ncm: "8523.49.90", category: "Jogos" },
      { id: "d", ncm: "8523.49.90", category: "Jogos" },
      { id: "e", ncm: "9504.50.00", category: "Acessórios" },
    ]);
    expect(g[g.length - 1].category).toMatch(/Sem classificação/);
  });

  it("renderiza texto com total geral", () => {
    const groups = groupByNcm(products, classifications);
    const txt = renderNfText(buildFiscalHeader(fiscal), groups);
    expect(txt).toContain("Lote 1");
    expect(txt).toContain("NCM: 8523.49.90");
    expect(txt).toContain("VALOR TOTAL DA NOTA: R$");
    // total = 60+80+70+50+100 = 360
    expect(txt).toMatch(/VALOR TOTAL DA NOTA: R\$\s?360,00/);
  });
});