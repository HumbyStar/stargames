import { describe, expect, it } from "vitest";
import {
  buildFullCsv,
  buildMarketingCsv,
  buildMarketingTxt,
  segmentFileName,
  type SegmentRow,
} from "@/lib/segmentation-format";

const row = (over: Partial<SegmentRow> = {}): SegmentRow => ({
  clientId: "1",
  name: "João da Silva",
  phone: "(11) 99999-9999",
  email: "joao@ex.com",
  productsCount: 8,
  spent: 1850,
  ...over,
});

/** Regra de cálculo do documento: soma acumulada dentro da categoria filtrada. */
function spentInCategory(
  products: { category: string; value: number }[],
  categories: string[] | null,
): number {
  return products
    .filter((p) => !categories || categories.includes(p.category))
    .reduce((s, p) => s + p.value, 0);
}

describe("regra de cálculo por categoria", () => {
  const products = [
    { category: "Figures", value: 600 },
    { category: "Pops", value: 300 },
    { category: "Outros", value: 400 },
  ];

  it("exemplo 1 — todos os produtos soma 1300 e passa no mínimo de 1000", () => {
    expect(spentInCategory(products, null)).toBe(1300);
  });

  it("exemplo 2 — categoria principal soma as subcategorias", () => {
    const brinquedos = ["Figures", "Pops", "Action Figures"];
    expect(spentInCategory([...products, { category: "Action Figures", value: 200 }], brinquedos)).toBe(
      1100,
    );
  });

  it("exemplo 3 — subcategoria específica não soma as irmãs", () => {
    const only = [
      { category: "Action Figures", value: 750 },
      { category: "Pops", value: 600 },
    ];
    expect(spentInCategory(only, ["Action Figures"])).toBe(750);
    expect(spentInCategory(only, ["Action Figures"]) >= 1000).toBe(false);
  });
});

describe("exportações", () => {
  it("CSV completo traz cabeçalho e telefone normalizado", () => {
    const csv = buildFullCsv([row()], "Brinquedos");
    expect(csv.split("\n")[0]).toContain("valor_gasto");
    expect(csv).toContain("5511999999999");
    expect(csv).toContain("Brinquedos");
  });

  it("CSV de marketing só traz nome, telefone e e-mail", () => {
    const csv = buildMarketingCsv([row()]);
    expect(csv.split("\n")[0].split(",")).toHaveLength(3);
  });

  it("TXT de marketing traz apenas telefones válidos", () => {
    const txt = buildMarketingTxt([row(), row({ clientId: "2", phone: "abc" })]);
    expect(txt).toBe("5511999999999");
  });

  it("nome do arquivo inclui data e resumo", () => {
    const name = segmentFileName("segmentacao", "csv", "Brinquedos min1000");
    expect(name.endsWith(".csv")).toBe(true);
    expect(name).toContain("brinquedos-min1000");
  });
});
