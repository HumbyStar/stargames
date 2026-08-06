/** Geração de PDF da nota fiscal (client-side, import dinâmico do jsPDF). */

function sanitizeFileName(raw: string): string {
  return (raw || "nota-fiscal")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
}

export interface NfPdfOptions {
  clientName: string;
  content: string;
  createdAt?: string | Date;
  totalCents?: number;
}

export async function downloadNfPdf({
  clientName,
  content,
  createdAt,
  totalCents,
}: NfPdfOptions): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 48;
  const marginTop = 56;
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = doc.internal.pageSize.getWidth() - marginX * 2;
  let y = marginTop;

  const date = createdAt ? new Date(createdAt) : new Date();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("DADOS PARA EMISSÃO DE NOTA FISCAL", marginX, y);
  y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    `Cliente: ${clientName}   ·   Gerado em: ${date.toLocaleString("pt-BR")}`,
    marginX,
    y,
  );
  y += 14;
  doc.setDrawColor(180);
  doc.line(marginX, y, marginX + maxWidth, y);
  y += 22;

  doc.setFont("courier", "normal");
  doc.setFontSize(11);
  const lineHeight = 15;
  for (const rawLine of content.split("\n")) {
    const wrapped: string[] = rawLine.trim()
      ? doc.splitTextToSize(rawLine, maxWidth)
      : [""];
    for (const line of wrapped) {
      if (y > pageHeight - marginTop) {
        doc.addPage();
        y = marginTop;
      }
      doc.text(line, marginX, y);
      y += lineHeight;
    }
  }

  if (typeof totalCents === "number") {
    if (y > pageHeight - marginTop - 30) {
      doc.addPage();
      y = marginTop;
    }
    y += 10;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(
      `VALOR TOTAL: ${(totalCents / 100).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      })}`,
      marginX,
      y,
    );
  }

  const stamp = date.toISOString().slice(0, 10);
  doc.save(`nota-fiscal-${sanitizeFileName(clientName)}-${stamp}.pdf`);
}