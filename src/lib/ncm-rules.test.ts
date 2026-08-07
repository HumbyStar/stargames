import { describe, expect, it } from "vitest";
import { aderirNCM } from "./ncm-rules";

describe("aderirNCM", () => {
  it("cai no fallback Figure", () => {
    expect(aderirNCM("Hunter x Hunter")).toMatchObject({ ncm: "39264000", descricao: "Figure" });
  });
  it("identifica pop alternativo", () => {
    expect(aderirNCM("Hunter x Hunter Pop Alternativo")).toMatchObject({
      ncm: "95030031",
      descricao: "Boneco pelúcia",
    });
  });
  it("identifica figure 3D", () => {
    expect(aderirNCM("Hunter x Hunter Figure 3D")).toMatchObject({
      ncm: "95030080",
      descricao: "Figure 3D",
    });
  });
  it("identifica boneco original", () => {
    expect(aderirNCM("Hunter x Hunter Bandai Original")).toMatchObject({
      ncm: "95030099",
      descricao: "Boneco colecionável",
    });
  });
  it("identifica videogame", () => {
    expect(aderirNCM("Hunter x Hunter Nintendo Switch")).toMatchObject({
      ncm: "95045000",
      descricao: "Videogame ou jogo",
    });
  });
  it("não casa 3d dentro de outra palavra", () => {
    expect(aderirNCM("Naruto 3december").fallback).toBe(true);
  });
});