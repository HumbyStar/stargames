import { describe, it, expect } from "vitest";
import { extractMGMVAgreementFromNotes } from "./import-section";

describe("extractMGMVAgreementFromNotes", () => {
  it("retorna null quando não há observações", () => {
    expect(extractMGMVAgreementFromNotes("")).toBeNull();
    expect(extractMGMVAgreementFromNotes("Cliente fiel, sempre paga em dia.")).toBeNull();
  });

  it("ignora texto sem sinais de MGMV/parcelas/dividido", () => {
    expect(extractMGMVAgreementFromNotes("Comprou à vista no PIX")).toBeNull();
  });

  it("não cria acordo quando há menção a MGMV mas faltam números", () => {
    expect(extractMGMVAgreementFromNotes("Cliente entrou no MGMV mas sem valores")).toBeNull();
  });

  it("extrai acordo do padrão TOTAL + Nx Parcelas de Y", () => {
    const notes = "MGMV\nTOTAL: 200 PENDENTES (4x Parcelas de 50 reais)";
    const a = extractMGMVAgreementFromNotes(notes);
    expect(a).not.toBeNull();
    expect(a!.totalDebt).toBe(200);
    expect(a!.installments).toHaveLength(4);
    expect(a!.installments[0].value).toBe(50);
    expect(a!.installments.every((i) => i.total === 4)).toBe(true);
    expect(a!.installments.every((i) => !i.paid)).toBe(true);
  });

  it("extrai acordo do padrão 'X dividido em Nx de Y'", () => {
    const a = extractMGMVAgreementFromNotes("Valor de 50 dividido em 2x de 25 reais");
    expect(a).not.toBeNull();
    expect(a!.totalDebt).toBe(50);
    expect(a!.installments).toHaveLength(2);
    expect(a!.installments[0].value).toBe(25);
  });

  it("infere totalDebt de Nx Parcelas quando não há TOTAL explícito", () => {
    const a = extractMGMVAgreementFromNotes("Parcelado: 3x Parcelas de 40");
    expect(a).not.toBeNull();
    expect(a!.installments).toHaveLength(3);
    expect(a!.installments[0].value).toBe(40);
    expect(a!.totalDebt).toBe(120);
  });

  it("aceita valores em formato BR com vírgula decimal", () => {
    const a = extractMGMVAgreementFromNotes(
      "TOTAL: 199,90 (2x Parcelas de 99,95)",
    );
    expect(a).not.toBeNull();
    expect(a!.totalDebt).toBeCloseTo(199.9, 2);
    expect(a!.installments[0].value).toBeCloseTo(99.95, 2);
  });

  it("marca primeira parcela como paga quando observação diz 'Pago primeira parcela'", () => {
    const a = extractMGMVAgreementFromNotes(
      "MGMV\nTOTAL: 200 (4x Parcelas de 50)\nPago primeira parcela",
    );
    expect(a).not.toBeNull();
    expect(a!.installments[0].paid).toBe(true);
    expect(a!.installments.slice(1).every((i) => !i.paid)).toBe(true);
  });

  it("interpreta 'N parcelas pagas' nas observações", () => {
    const a = extractMGMVAgreementFromNotes(
      "MGMV\nTOTAL: 200 (4x Parcelas de 50)\n2 parcelas pagas",
    );
    expect(a).not.toBeNull();
    expect(a!.installments.filter((i) => i.paid)).toHaveLength(2);
    expect(a!.installments[0].paid).toBe(true);
    expect(a!.installments[1].paid).toBe(true);
    expect(a!.installments[2].paid).toBe(false);
  });

  it("interpreta 'Pagou N parcelas' nas observações", () => {
    const a = extractMGMVAgreementFromNotes(
      "MGMV\nTOTAL: 200 (4x Parcelas de 50)\nPagou 3 parcelas",
    );
    expect(a).not.toBeNull();
    expect(a!.installments.filter((i) => i.paid)).toHaveLength(3);
  });

  it("interpreta 'quitou N parcela' como variação de pagamento", () => {
    const a = extractMGMVAgreementFromNotes(
      "MGMV\n3x Parcelas de 40\nquitou 1 parcela",
    );
    expect(a).not.toBeNull();
    expect(a!.installments.filter((i) => i.paid)).toHaveLength(1);
  });

  it("não marca mais parcelas pagas do que o total", () => {
    const a = extractMGMVAgreementFromNotes(
      "MGMV\n2x Parcelas de 50\n9 parcelas pagas",
    );
    expect(a).not.toBeNull();
    expect(a!.installments.filter((i) => i.paid)).toHaveLength(2);
  });

  it("usa data do '1º Pagamento' como vencimento da primeira parcela", () => {
    const a = extractMGMVAgreementFromNotes(
      "MGMV\nTOTAL: 200 (4x Parcelas de 50)\n1º Pagamento -> 07/03/2025",
    );
    expect(a).not.toBeNull();
    const first = new Date(a!.installments[0].dueDate);
    expect(first.getUTCFullYear()).toBe(2025);
    expect(first.getUTCMonth()).toBe(2); // março
    expect(first.getUTCDate()).toBe(7);
    // próximas parcelas espaçadas mensalmente
    const second = new Date(a!.installments[1].dueDate);
    expect(second.getUTCMonth()).toBe(3); // abril
  });

  it("detecta sinal MGMV via menção isolada à palavra 'mgmv' (case-insensitive)", () => {
    const a = extractMGMVAgreementFromNotes("Cliente MGMV — 2x Parcelas de 25");
    expect(a).not.toBeNull();
    expect(a!.installments).toHaveLength(2);
  });
});

// A coluna "Situação" também pode indicar MGMV; o parser usa /mgmv/i para
// detectar essa condição mesmo quando o Status diz outra coisa.
describe("detecção de MGMV na coluna Situação", () => {
  const situationMentionsMgmv = (s: string) => /mgmv/i.test(String(s ?? ""));

  it.each([
    ["MGMV", true],
    ["mgmv", true],
    ["Em MGMV - 4x", true],
    ["Em Aberto", false],
    ["Enviado", false],
    ["", false],
  ])("situação %p → MGMV=%p", (input, expected) => {
    expect(situationMentionsMgmv(input)).toBe(expected);
  });
});