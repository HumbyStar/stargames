import { describe, it, expect } from "vitest";
import {
  parseFichaFromText,
  renderFichaText,
  isFichaComplete,
  fichaFromTextWithDefaults,
} from "./ficha-parse";

describe("ficha-parse", () => {
  it("faz round-trip do formato canônico", () => {
    const f = {
      fullName: "João Silva",
      cpfCnpj: "12345678900",
      state: "SP",
      city: "São Paulo",
      neighborhood: "Centro",
      street: "Rua A",
      number: "123",
      cep: "01001000",
      complement: "Apto 4",
      phone: "11911947693",
      email: "joao@example.com",
      notes: "Cliente antigo",
    };
    const text = renderFichaText(f);
    const parsed = parseFichaFromText(text);
    expect(parsed).toMatchObject(f);
  });

  it("isFichaComplete exige Nome + CPF + CEP", () => {
    expect(isFichaComplete("")).toBe(false);
    expect(isFichaComplete("Nome: João")).toBe(false);
    expect(
      isFichaComplete("Nome: João\nCPF: 12345678900\nCEP: 01001000"),
    ).toBe(true);
  });

  it("ignora linhas desconhecidas sem quebrar", () => {
    const f = parseFichaFromText(
      "Nome: João\nAlguma coisa qualquer\nCPF: 12345678900\n",
    );
    expect(f.fullName).toBe("João");
    expect(f.cpfCnpj).toBe("12345678900");
  });

  it("aceita aliases (CPF/CNPJ, UF, Endereço, Email)", () => {
    const f = parseFichaFromText(
      "Nome: X\nCPF/CNPJ: 111.222.333-44\nUF: sp\nEndereço: Rua B\nEmail: a@b.com",
    );
    expect(f.cpfCnpj).toBe("11122233344");
    expect(f.state).toBe("SP");
    expect(f.street).toBe("Rua B");
    expect(f.email).toBe("a@b.com");
  });

  it("renderFichaText usa telefone do cliente como fallback", () => {
    const text = renderFichaText({ fullName: "X" }, "(11) 91194-7693");
    expect(text).toContain("Telefone: 11911947693");
  });

  it("renderFichaText omite campos vazios", () => {
    const text = renderFichaText({ fullName: "X" });
    expect(text).toBe("Nome: X");
  });

  it("fichaFromTextWithDefaults preenche telefone quando ausente", () => {
    const f = fichaFromTextWithDefaults("Nome: X", { phone: "11911947693" });
    expect(f.phone).toBe("11911947693");
  });

  it("texto livre não-estruturado devolve ficha vazia", () => {
    expect(parseFichaFromText("apenas um texto solto sem labels")).toEqual({});
    expect(isFichaComplete("apenas um texto solto")).toBe(false);
  });
});