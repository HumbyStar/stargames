import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { parseClientHtml } from "./html-client-import-parser";

const SAMPLE_MIN = `<html><head><title>Hadi - (47) 9986-8265</title></head><body>
<h1>Hadi - (47) 9986-8265</h1>
<table>
  <tr><td>Nintendo 64 na Caixa</td><td>Console</td><td>870 R$</td><td>870 R$</td><td>PAGO</td><td></td><td>ENVIADO</td></tr>
  <tr><td>Basara</td><td>PS2</td><td>110 R$</td><td>10 R$</td><td>Reserva Paga</td><td>30 de Dezembro</td><td>REMOVIDO</td></tr>
  <tr><td>Dialga</td><td>Colecionável</td><td>40 R$</td><td>-</td><td>-</td><td>09 de Fevereiro</td><td>REMOVIDO</td></tr>
</table>
<h2>LOTE FECHADO MEU GAME MINHA VIDA</h2>
<table>
  <tr><th>Item</th><th>Plataforma</th><th>Valor</th><th>Valor Pago</th><th>Status</th><th>Data</th><th>Situação</th></tr>
  <tr><td>Dark Mirror</td><td>PS2</td><td>R$ 50,00</td><td>R$ 50,00</td><td>PAGO</td><td>25/11</td><td>ENVIADO</td></tr>
</table>
</body></html>`;

describe("html-client-import-parser", () => {
  it("extrai nome e telefone do <h1>", () => {
    const out = parseClientHtml(SAMPLE_MIN);
    expect(out.clientHeader.name).toBe("Hadi");
    expect(out.clientHeader.phone).toBe("4799868265");
    expect(out.clientHeader.phoneValid).toBe(true);
  });

  it("concatena múltiplas tabelas num mesmo cliente", () => {
    const out = parseClientHtml(SAMPLE_MIN);
    // 3 linhas na 1ª tabela + 1 linha na 2ª (o header foi ignorado)
    expect(out.rows).toHaveLength(4);
    expect(out.clients).toHaveLength(1);
    expect(out.clients[0].clientName).toBe("Hadi");
  });

  it("usa heading intermediário como sourceGroup", () => {
    const out = parseClientHtml(SAMPLE_MIN);
    expect(out.rows[0].sourceGroup).toBe("(sem grupo)");
    const lote = out.rows.find((r) => r.productName === "Dark Mirror");
    expect(lote?.sourceGroup).toBe("LOTE FECHADO MEU GAME MINHA VIDA");
  });

  it("mapeia REMOVIDO -> Retirado", () => {
    const out = parseClientHtml(SAMPLE_MIN);
    const basara = out.rows.find((r) => r.productName === "Basara")!;
    expect(basara.situation).toBe("Retirado");
  });

  it("mapeia ENVIADO -> Enviado", () => {
    const out = parseClientHtml(SAMPLE_MIN);
    const nintendo = out.rows.find((r) => r.productName === "Nintendo 64 na Caixa")!;
    expect(nintendo.situation).toBe("Enviado");
  });

  it("Reserva Paga mantém valor pago e status Reserva", () => {
    const out = parseClientHtml(SAMPLE_MIN);
    const basara = out.rows.find((r) => r.productName === "Basara")!;
    expect(basara.financialStatus).toBe("Reserva");
    expect(basara.paidValue).toBe(10);
    expect(basara.totalValue).toBe(110);
  });

  it("status '-' com valor pago '-' vira review_required", () => {
    const out = parseClientHtml(SAMPLE_MIN);
    const dialga = out.rows.find((r) => r.productName === "Dialga")!;
    expect(dialga.financialStatus).toBe("Revisão necessária");
    expect(dialga.reviewStatus).toBe("review_required");
    expect(dialga.paidValue).toBeNull();
  });

  it("PAGO sem valor pago explícito assume o total", () => {
    const out = parseClientHtml(SAMPLE_MIN);
    const dm = out.rows.find((r) => r.productName === "Dark Mirror")!;
    expect(dm.financialStatus).toBe("Pago");
    expect(dm.paidValue).toBe(50);
    expect(dm.remainingValue).toBe(0);
  });

  it("processa o arquivo do Hadi (upload real) se estiver disponível", () => {
    const path = "/mnt/user-uploads/Hadi_-_47_9986-8265_1b01edb7fee380ceb187e1602fab1173.html";
    if (!existsSync(path)) return;
    const html = readFileSync(path, "utf8");
    const out = parseClientHtml(html);
    expect(out.clientHeader.name).toBe("Hadi");
    expect(out.clientHeader.phone).toBe("4799868265");
    // 3 tabelas: 23 + 15 + 17 linhas de dados (a última descontada do header)
    expect(out.rows.length).toBeGreaterThanOrEqual(50);
    expect(out.clients).toHaveLength(1);
    // deve ter capturado ao menos uma linha REMOVIDO -> Retirado
    expect(out.rows.some((r) => r.situation === "Retirado")).toBe(true);
    expect(out.rows.some((r) => r.situation === "Enviado")).toBe(true);
  });
});