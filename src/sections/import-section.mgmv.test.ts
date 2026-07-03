import { describe, it, expect } from "vitest";
import {
  extractMGMVAgreementFromNotes,
  extractPaymentDate,
  addMonthsClampDay,
  tableHeadingMentionsMgmv,
} from "./import-section";

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

  it("conta parcelas pagas listadas linha-a-linha com seta '→ N Parcela ... paga'", () => {
    const notes = [
      "MGMV:. 1.600 dividido em 5x de 320 reais",
      "→ 1 Parcela de 320 reais paga dia 28 de Fevereiro",
      "→ 2 Parcela de 320 reais paga dia 30 de Março",
      "→ 3 Parcela de 320 reais paga dia 04 de Maio (referente a Abril)",
      "→ 4 Parcela de 320 reais paga dia 29 de Maio",
    ].join("\n");
    const a = extractMGMVAgreementFromNotes(notes);
    expect(a).not.toBeNull();
    expect(a!.totalDebt).toBe(1600);
    expect(a!.installments).toHaveLength(5);
    expect(a!.installments[0].value).toBe(320);
    expect(a!.installments.filter((i) => i.paid)).toHaveLength(4);
    expect(a!.installments[4].paid).toBe(false);
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

describe("MGMV — parcelas pagas com data por extenso (cenário do usuário)", () => {
  const notes = [
    "MGMV: 410 dividido em 5x de 82 reais",
    "→ Primeira parcela paga dia 30 de Abril",
    "→ Segunda parcela paga dia 29 de Maio",
  ].join("\n");

  it("identifica 2 parcelas pagas e saldo restante correto", () => {
    const a = extractMGMVAgreementFromNotes(notes);
    expect(a).not.toBeNull();
    expect(a!.totalDebt).toBe(410);
    expect(a!.installments).toHaveLength(5);
    expect(a!.installments[0].paid).toBe(true);
    expect(a!.installments[1].paid).toBe(true);
    expect(a!.installments[2].paid).toBe(false);
    const paidValue = a!.installments
      .filter((i) => i.paid)
      .reduce((s, i) => s + i.value, 0);
    expect(paidValue).toBe(164);
    expect(a!.totalDebt - paidValue).toBe(246);
  });

  it("guarda paidAt nas parcelas pagas e calcula próximo vencimento +1 mês", () => {
    const a = extractMGMVAgreementFromNotes(notes)!;
    expect(a.installments[0].paidAt).toBeDefined();
    expect(a.installments[1].paidAt).toBeDefined();
    const p2 = new Date(a.installments[1].paidAt!);
    const p3 = new Date(a.installments[2].dueDate);
    expect(p3.getDate()).toBe(p2.getDate());
    expect(p3.getMonth()).toBe((p2.getMonth() + 1) % 12);
  });

  it("interpreta 'pagou primeira parcela' e 'pagou segunda parcela'", () => {
    const a = extractMGMVAgreementFromNotes(
      "MGMV 3x Parcelas de 50\npagou primeira parcela\npagou segunda parcela",
    )!;
    expect(a.installments.filter((i) => i.paid)).toHaveLength(2);
  });

  it("reconhece ordinal sem acento (setima/decima)", () => {
    const a = extractMGMVAgreementFromNotes(
      "MGMV 10x Parcelas de 10\nsetima parcela paga\ndecima parcela paga",
    )!;
    expect(a.installments[6].paid).toBe(true);
    expect(a.installments[9].paid).toBe(true);
  });

  it("aceita data numérica DD/MM/AAAA na linha", () => {
    const a = extractMGMVAgreementFromNotes(
      "MGMV 3x Parcelas de 100\n1ª parcela paga 30/04/2026\n2ª parcela paga 29/05/2026",
    )!;
    expect(a.installments[0].paid).toBe(true);
    expect(a.installments[1].paid).toBe(true);
    const d2 = new Date(a.installments[1].paidAt!);
    expect(d2.getUTCMonth()).toBe(4); // maio
  });
});

describe("MGMV — não confunde '1/4 Parcela paga' com parcela nº 4", () => {
  const notes = [
    "MGMV: 600 dividido em 3x de 200 reais",
    "→ 1/4 Parcela paga (50 reais) - 19 de Junho",
  ].join("\n");

  it("não marca nenhuma parcela como quitada (50 < 200)", () => {
    const a = extractMGMVAgreementFromNotes(notes)!;
    expect(a.installments.filter((i) => i.paid)).toHaveLength(0);
  });

  it("registra pagamento parcial de R$50 na parcela 1", () => {
    const a = extractMGMVAgreementFromNotes(notes)!;
    expect(a.installments[0].paidAmount).toBe(50);
    expect(a.installments[0].paid).toBe(false);
  });

  it("marca acordo como review_required por conflito 1/4 vs 3x", () => {
    const a = extractMGMVAgreementFromNotes(notes)!;
    expect(a.reviewStatus).toBe("review_required");
  });
});

describe("addMonthsClampDay", () => {
  it("preserva o mesmo dia quando possível", () => {
    const d = addMonthsClampDay(new Date(2026, 4, 29), 1);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(29);
  });
  it("usa o último dia do mês destino quando o dia não existe", () => {
    const d = addMonthsClampDay(new Date(2026, 0, 31), 1);
    expect(d.getMonth()).toBe(1); // fevereiro
    expect(d.getDate()).toBe(28); // 2026 não é bissexto
    const d2 = addMonthsClampDay(new Date(2028, 0, 31), 1);
    expect(d2.getDate()).toBe(29); // 2028 é bissexto
  });
});

describe("extractPaymentDate", () => {
  it("usa refYear quando o ano não está escrito", () => {
    const iso = extractPaymentDate("paga dia 30 de Abril", 2026);
    const d = new Date(iso!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3);
    expect(d.getDate()).toBe(30);
  });
});

describe("tableHeadingMentionsMgmv", () => {
  it("detecta 'LOTE FECHADO MEU GAME MINHA VIDA'", () => {
    expect(
      tableHeadingMentionsMgmv("LOTE FECHADO MEU GAME MINHA VIDA"),
    ).not.toBeNull();
  });
  it("detecta 'MGMV Ativo'", () => {
    expect(tableHeadingMentionsMgmv("MGMV Ativo")).not.toBeNull();
  });
  it("detecta 'Meu Game Minha Vida'", () => {
    expect(tableHeadingMentionsMgmv("Meu Game Minha Vida — 2024")).not.toBeNull();
  });
  it("não detecta heading neutro", () => {
    expect(tableHeadingMentionsMgmv("Histórico 2024")).toBeNull();
    expect(tableHeadingMentionsMgmv("Compras avulsas")).toBeNull();
  });
  it("respeita negação 'fora do MGMV'", () => {
    expect(tableHeadingMentionsMgmv("Produtos fora do MGMV")).toBeNull();
    expect(tableHeadingMentionsMgmv("Compras não MGMV")).toBeNull();
  });
  it("retorna o trecho encontrado como label", () => {
    const label = tableHeadingMentionsMgmv(
      "Compras normais • LOTE FECHADO MEU GAME MINHA VIDA",
    );
    expect(label).toMatch(/lote\s+fechado/i);
  });
});