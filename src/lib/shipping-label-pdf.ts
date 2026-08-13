/** Etiqueta de envio (PDF de exemplo, MVP) — gerada no cliente via jsPDF. */
import type { ShipmentRow } from "@/lib/shipments.functions";

const SENDER = {
  name: "Star Games",
  line1: "Rua das Palmeiras, 1200 - Sala 4",
  line2: "Centro - Sorocaba/SP - CEP 18010-000",
  line3: "Contato: (15) 3200-0000",
};

const brl = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function sanitizeFileName(raw: string): string {
  return (raw || "envio")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
}

export async function downloadShipmentLabelPdf(shipment: ShipmentRow): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 48;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - marginX * 2;
  let y = 56;

  const ensure = (needed: number) => {
    if (y + needed > pageHeight - 56) {
      doc.addPage();
      y = 56;
    }
  };

  const date = new Date(shipment.createdAt);

  // Cabeçalho
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("ETIQUETA DE POSTAGEM", marginX, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    `Envio ${shipment.id.slice(0, 8).toUpperCase()}  ·  ${date.toLocaleString("pt-BR")}`,
    marginX,
    y,
  );
  y += 16;
  doc.setDrawColor(170);
  doc.line(marginX, y, marginX + maxWidth, y);
  y += 22;

  // Remetente
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("REMETENTE", marginX, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (const line of [SENDER.name, SENDER.line1, SENDER.line2, SENDER.line3]) {
    doc.text(line, marginX, y);
    y += 13;
  }
  y += 10;

  // Destinatário em destaque
  const r = shipment.recipient;
  const destLines = r
    ? [
        r.fullName || shipment.clientName,
        [r.street, r.number].filter(Boolean).join(", ") +
          (r.complement ? ` - ${r.complement}` : ""),
        [r.neighborhood, [r.city, r.state].filter(Boolean).join("/")]
          .filter(Boolean)
          .join(" - "),
        r.cep ? `CEP: ${r.cep}` : "",
        [r.cpfCnpj ? `CPF/CNPJ: ${r.cpfCnpj}` : "", r.phone ? `Tel: ${r.phone}` : ""]
          .filter(Boolean)
          .join("   ·   "),
      ].filter(Boolean)
    : [shipment.clientName, "Destinatário não informado"];

  const boxHeight = 34 + destLines.length * 15;
  ensure(boxHeight + 20);
  doc.setDrawColor(30);
  doc.setLineWidth(1);
  doc.rect(marginX, y, maxWidth, boxHeight);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("DESTINATÁRIO", marginX + 12, y + 20);
  let dy = y + 38;
  doc.setFontSize(11);
  destLines.forEach((line, i) => {
    doc.setFont("helvetica", i === 0 ? "bold" : "normal");
    for (const wrapped of doc.splitTextToSize(line, maxWidth - 24) as string[]) {
      doc.text(wrapped, marginX + 12, dy);
      dy += 15;
    }
  });
  y += boxHeight + 24;
  doc.setLineWidth(0.5);

  // Serviço
  ensure(90);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("SERVIÇO", marginX, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  const service = [
    `Transportadora: ${shipment.carrier}${shipment.service ? ` - ${shipment.service}` : ""}`,
    `Prazo estimado: ${shipment.etaDays != null ? `${shipment.etaDays} dia(s) útil(eis)` : "—"}`,
    `Peso total: ${shipment.totalWeightKg.toFixed(2).replace(".", ",")} kg`,
    `Valor do frete: ${brl(shipment.priceCents)}`,
  ];
  for (const line of service) {
    doc.text(line, marginX, y);
    y += 13;
  }
  y += 12;

  // Itens
  ensure(40);
  doc.setFont("helvetica", "bold");
  doc.text("ITENS", marginX, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  shipment.items.forEach((it, i) => {
    ensure(28);
    const dims = `${it.lengthCm}x${it.widthCm}x${it.heightCm} cm`;
    doc.text(`${i + 1}. ${it.name}${it.platform ? ` (${it.platform})` : ""}`, marginX, y);
    y += 12;
    doc.setTextColor(90);
    doc.text(
      `    ${dims}  ·  ${it.weightKg.toFixed(2).replace(".", ",")} kg  ·  ${it.value.toLocaleString(
        "pt-BR",
        { style: "currency", currency: "BRL" },
      )}`,
      marginX,
      y,
    );
    doc.setTextColor(0);
    y += 16;
  });

  if (shipment.notes) {
    ensure(40);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("OBSERVAÇÕES", marginX, y);
    y += 13;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    for (const line of doc.splitTextToSize(shipment.notes, maxWidth) as string[]) {
      ensure(14);
      doc.text(line, marginX, y);
      y += 12;
    }
  }

  ensure(40);
  y += 14;
  doc.setDrawColor(200);
  doc.line(marginX, y, marginX + maxWidth, y);
  y += 14;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    "Documento de exemplo gerado pelo sistema Star Games (MVP). Não é uma etiqueta oficial de transportadora.",
    marginX,
    y,
  );

  doc.save(
    `envio-${sanitizeFileName(shipment.clientName)}-${date.toISOString().slice(0, 10)}.pdf`,
  );
}
