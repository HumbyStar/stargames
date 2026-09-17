import { describe, expect, it } from "vitest";
import {
  buildShippingDescription,
  productDescription,
  shortenDescription,
} from "./product-descriptions";

describe("product descriptions", () => {
  it("uses the saved description and falls back to the product name", () => {
    expect(productDescription("Jogo antigo", "Jogo mídia física")).toBe("Jogo mídia física");
    expect(productDescription("Jogo antigo", "  ")).toBe("Jogo antigo");
  });

  it("builds a unique product summary", () => {
    expect(buildShippingDescription(["Jogo PS5", "Jogo PS5", "Controle"])).toBe(
      "Produtos: Jogo PS5, Controle",
    );
  });

  it("shortens without exceeding the carrier-safe limit", () => {
    const result = shortenDescription("Console com acessórios originais e controles adicionais", 32);
    expect(result.length).toBeLessThanOrEqual(32);
    expect(result.endsWith("…")).toBe(true);
  });
});