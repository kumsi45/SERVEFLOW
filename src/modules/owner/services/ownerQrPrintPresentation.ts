export type QrPrintFormat = "compact" | "large" | "single";

export const QR_PRINT_FORMATS: Record<QrPrintFormat, { cardsPerPage: number; label: string; description: string }> = {
  compact: { cardsPerPage: 6, label: "6 per page", description: "Balanced size and paper use" },
  large: { cardsPerPage: 4, label: "4 per page", description: "Larger QR and text" },
  single: { cardsPerPage: 1, label: "Single table", description: "One large QR per page" },
};

// Shared customer-card styles: physical dimensions in print, proportionally
// scaled by the existing A4 preview. No Owner controls belong to this output.
export const QR_PRINT_CARD_CSS = `
.sf-print-page{--card-padding:3mm;--card-gap:1mm;--name-size:8pt;--table-size:16pt;--qr-size:54mm;--logo-width:16mm;--logo-height:7mm;--instruction-size:8pt;--attribution-size:6pt;width:190mm;height:277mm;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(3,minmax(0,1fr));gap:5mm;page-break-after:always}
.sf-print-page:last-child{page-break-after:auto}
.sf-print-page.large{--card-padding:5mm;--card-gap:2mm;--name-size:10pt;--table-size:20pt;--qr-size:72mm;--logo-width:20mm;--logo-height:10mm;--instruction-size:10pt;--attribution-size:7pt;grid-template-rows:repeat(2,minmax(0,1fr))}
.sf-print-page.single{--card-padding:8mm;--card-gap:3mm;--name-size:14pt;--table-size:32pt;--qr-size:115mm;--logo-width:28mm;--logo-height:12mm;--instruction-size:14pt;--attribution-size:8pt;grid-template-columns:1fr;grid-template-rows:1fr}
.sf-print-card{min-width:0;min-height:0;break-inside:avoid;page-break-inside:avoid;display:grid;justify-items:center;align-content:center;gap:var(--card-gap);padding:var(--card-padding);border:.2mm dashed #aaa;background:#fff;color:#000;text-align:center;font-family:Arial,sans-serif}
.sf-print-name{max-width:100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--name-size);line-height:1.15;font-weight:700;text-transform:uppercase}
.sf-print-table{font-size:var(--table-size);line-height:1.05;font-weight:900;letter-spacing:.04em;white-space:nowrap}
.sf-print-qr{display:block;width:var(--qr-size);height:var(--qr-size);aspect-ratio:1;object-fit:contain;background:#fff;image-rendering:auto}
.sf-print-instruction{font-size:var(--instruction-size);line-height:1.2;font-weight:600;white-space:nowrap}
.sf-print-attribution{font-size:var(--attribution-size);line-height:1.2;color:#555}
.sf-print-logo{display:block;width:var(--logo-width);height:var(--logo-height);object-fit:contain;aspect-ratio:auto}
`;

function escape(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function buildQrPrintDocument(input: {
  restaurantName: string;
  logoUrl: string | null;
  showServeFlow: boolean;
  format: QrPrintFormat;
  cards: { tableNumber: number; image: string }[];
}) {
  const { restaurantName, logoUrl, showServeFlow, format, cards } = input;
  const rendered = cards.map(({ tableNumber, image }) => `<article class="sf-print-card">${logoUrl ? `<img class="sf-print-logo" src="${escape(logoUrl)}" alt="" onerror="this.remove()" />` : ""}<strong class="sf-print-name">${escape(restaurantName)}</strong><b class="sf-print-table">TABLE ${String(tableNumber).padStart(2, "0")}</b><img class="sf-print-qr" src="${escape(image)}" alt="QR code for table ${tableNumber}" /><span class="sf-print-instruction">Scan to view menu &amp; order</span>${showServeFlow ? '<small class="sf-print-attribution">Powered by ServeFlow</small>' : ""}</article>`);
  const perPage = QR_PRINT_FORMATS[format].cardsPerPage;
  const pages = Array.from({ length: Math.ceil(rendered.length / perPage) }, (_, index) => `<main class="sf-print-page ${format}">${rendered.slice(index * perPage, (index + 1) * perPage).join("")}</main>`);
  return `<!doctype html><html><head><title>${escape(restaurantName)} QR cards</title><style>@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#000;font-family:Arial,sans-serif}${QR_PRINT_CARD_CSS}</style></head><body>${pages.join("")}<script>window.addEventListener('load',()=>window.print());<\/script></body></html>`;
}
