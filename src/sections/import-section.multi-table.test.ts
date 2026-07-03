// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { parseNotionHtml } from "./import-section";

const HTML_MULTI = `<!DOCTYPE html><html><body>
<article class="page">
  <h1 class="page-title">Hadi - (47) 99986-8265</h1>
  <table class="simple-table">
    <tr><th>Item</th><th>Plataforma</th><th>Valor</th><th>Pago</th><th>Status</th><th>Data</th><th>Situação</th></tr>
    <tr><td>Palkia</td><td>Colecionável</td><td>R$ 40,00</td><td>R$ 0,00</td><td>Pendente</td><td>03/07/2026</td><td>Removido</td></tr>
    <tr><td>Jam Pack Vol. 13</td><td>PS2</td><td>R$ 60,00</td><td>R$ 0,00</td><td>Pendente</td><td>03/07/2026</td><td>Removido</td></tr>
  </table>
  <table class="simple-table">
    <tr><th>Item</th><th>Plataforma</th><th>Valor</th><th>Pago</th><th>Status</th><th>Data</th><th>Situação</th></tr>
    <tr><td>Ace 3 The Fin</td><td>PS2</td><td>R$ 90,00</td><td>R$ 0,00</td><td>Pendente</td><td>03/07/2026</td><td>Removido</td></tr>
  </table>
  <table class="simple-table">
    <tr><th>Item</th><th>Plataforma</th><th>Valor</th><th>Pago</th><th>Status</th><th>Data</th><th>Situação</th></tr>
    <tr><td>Tales of Destiny 2</td><td>PS2</td><td>R$ 100,00</td><td>R$ 10,00</td><td>Reserva</td><td>09/12/2025</td><td>Em Aberto</td></tr>
    <tr><td>Dragon Quest VIII</td><td>PS2</td><td>R$ 150,00</td><td>R$ 10,00</td><td>Reserva</td><td>11/12/2025</td><td>Em Aberto</td></tr>
  </table>
</article>
</body></html>`;

describe("parseNotionHtml — múltiplas tabelas por cliente", () => {
  it("concatena produtos de todas as <table> do mesmo article", () => {
    const parsed = parseNotionHtml(HTML_MULTI, "Hadi.html");
    expect(parsed.clients).toHaveLength(1);
    const block = parsed.clients[0];
    expect(block.client.name.toLowerCase()).toContain("hadi");
    expect(block.products).toHaveLength(5);
    const names = block.products.map((p) => p.product);
    expect(names).toEqual([
      "Palkia",
      "Jam Pack Vol. 13",
      "Ace 3 The Fin",
      "Tales of Destiny 2",
      "Dragon Quest VIII",
    ]);
    // line numbers devem ser crescentes entre tabelas
    expect(block.products.map((p) => p.line)).toEqual([1, 2, 3, 4, 5]);
  });
});