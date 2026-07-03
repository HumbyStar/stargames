import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseZipNotionFile } from "./zip-import-parser";

function makeHtml(name: string, phone: string, situation = "REMOVIDO"): string {
  return `<html><head><title>${name} - ${phone}</title></head><body>
    <h1>${name} - ${phone}</h1>
    <table>
      <tr><td>Produto A</td><td>PS2</td><td>50 R$</td><td>50 R$</td><td>PAGO</td><td></td><td>ENVIADO</td></tr>
      <tr><td>Produto B</td><td>PS3</td><td>80 R$</td><td>-</td><td>-</td><td></td><td>${situation}</td></tr>
    </table>
  </body></html>`;
}

async function makeZip(files: Record<string, string>): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return await zip.generateAsync({ type: "blob" });
}

describe("zip-import-parser", () => {
  it("pega todos os HTMLs dentro da pasta Clientes (X) — o (X) é sufixo, não contagem", async () => {
    const zip = await makeZip({
      "Clientes (3)/Alice - (11) 99999-1111.html": makeHtml("Alice", "(11) 99999-1111"),
      "Clientes (3)/Beto - (11) 99999-2222.html": makeHtml("Beto", "(11) 99999-2222"),
      "Clientes (3)/Carla - (11) 99999-3333.html": makeHtml("Carla", "(11) 99999-3333"),
      "Clientes (3)/Diego - (11) 99999-4444.html": makeHtml("Diego", "(11) 99999-4444"),
      "Clientes (3)/Elena - (11) 99999-5555.html": makeHtml("Elena", "(11) 99999-5555"),
    });
    const res = await parseZipNotionFile(zip as unknown as File);
    // 5 arquivos reais, não 3 (o "(3)" é sufixo do Notion).
    expect(res.clients).toHaveLength(5);
    expect(res.matchedFolder).toBe(true);
    expect(res.folders).toContain("Clientes (3)");
  });

  it("faz fallback para HTMLs na raiz quando não há pasta Clientes*", async () => {
    const zip = await makeZip({
      "Alice - (11) 99999-1111.html": makeHtml("Alice", "(11) 99999-1111"),
      "Beto - (11) 99999-2222.html": makeHtml("Beto", "(11) 99999-2222"),
    });
    const res = await parseZipNotionFile(zip as unknown as File);
    expect(res.clients).toHaveLength(2);
    expect(res.matchedFolder).toBe(false);
  });

  it("mapeia REMOVIDO -> Retirado; RETIRAR -> Retirar; DESISTIU -> Abandonou", async () => {
    const zip = await makeZip({
      "Clientes/A - (11) 99999-1111.html": makeHtml("A", "(11) 99999-1111", "REMOVIDO"),
      "Clientes/B - (11) 99999-2222.html": makeHtml("B", "(11) 99999-2222", "RETIRAR"),
      "Clientes/C - (11) 99999-3333.html": makeHtml("C", "(11) 99999-3333", "DESISTIU"),
    });
    const res = await parseZipNotionFile(zip as unknown as File);
    const sits = res.clients.map(
      (c) => c.preview.rows.find((r) => r.productName === "Produto B")?.situation,
    );
    expect(sits).toEqual(["Retirado", "Retirar", "Abandonou"]);
  });
});