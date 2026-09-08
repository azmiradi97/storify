/**
 * Browser-print helpers. Each function opens a new window, writes the HTML,
 * triggers the print dialog, and closes the window.
 *
 * Why structural types instead of importing entity types from pages:
 * each printer only needs a subset of fields; the structural shape keeps this
 * module independent of page-specific extensions to Invoice/PurchaseOrder/etc.
 */

import { formatMoney, formatDate, formatDateTime } from './format'

function fmt2(n: number): string {
  return formatMoney(n)
}

// SEC-06: every value interpolated into a print document must be HTML-escaped.
// These windows run at the app's origin (about:blank inherits it), so an
// unescaped product name / customer note like `<img onerror=...>` would execute
// with access to the in-memory session token. Escape all user-controlled text.
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function openPrintWindow(html: string, width: number, height: number, closeDelayMs = 250): void {
  const win = window.open('', '_blank', `width=${width},height=${height}`)
  if (!win) return
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => { win.print(); win.close() }, closeDelayMs)
}

// ─── Receipt (POS thermal-printer style) ─────────────────────────────────────
export interface ReceiptInvoice {
  invoiceNumber: string
  createdAt: string
  customerName?: string
  paymentMethodName: string
  subtotal: number
  totalAmount: number
  feeAmount: number
  couponDiscount?: number
  couponCode?: string
  items: { productName: string; sku: string; quantity: number; lineTotal: number }[]
}

export function printReceipt(inv: ReceiptInvoice): void {
  const rows = inv.items.map((i) =>
    `<tr><td>${esc(i.productName)}<br/><small style="color:#666">${esc(i.sku)} × ${Number(i.quantity)}</small></td><td style="text-align:left;white-space:nowrap">${Number(i.lineTotal).toFixed(2)} ج</td></tr>`
  ).join('')
  const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>إيصال ${inv.invoiceNumber}</title>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
    <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'IBM Plex Sans Arabic',Arial,sans-serif;font-size:12px;width:80mm;margin:0 auto;padding:8px;color:#000}
    .center{text-align:center}
    h2{font-size:15px;margin:6px 0}
    table{width:100%;border-collapse:collapse}
    td{padding:3px 2px;vertical-align:top}
    .dashed{border-bottom:1px dashed #000;margin:6px 0}
    .total td{font-weight:bold;font-size:14px;border-top:1px dashed #000;padding-top:6px}
    @media print{@page{margin:4mm;size:80mm auto}}
  </style></head><body>
    <div class="center"><h2>حِسبة</h2><p style="font-size:11px">نقطة البيع</p></div>
    <div class="dashed"></div>
    <p>رقم الفاتورة: <b>${esc(inv.invoiceNumber)}</b></p>
    <p>التاريخ: ${formatDateTime(inv.createdAt)}</p>
    ${inv.customerName ? `<p>العميل: ${esc(inv.customerName)}</p>` : ''}
    <p>الدفع: ${esc(inv.paymentMethodName)}</p>
    <div class="dashed"></div>
    <table><tbody>${rows}</tbody></table>
    <div class="dashed"></div>
    <table><tbody>
      <tr><td>المجموع الفرعي</td><td style="text-align:left">${Number(inv.subtotal).toFixed(2)} ج</td></tr>
      ${inv.couponDiscount && inv.couponDiscount > 0 ? `<tr><td>خصم (${esc(inv.couponCode ?? '')})</td><td style="text-align:left;color:green">-${Number(inv.couponDiscount).toFixed(2)} ج</td></tr>` : ''}
      ${inv.feeAmount > 0 ? `<tr><td>رسوم الدفع</td><td style="text-align:left">${Number(inv.feeAmount).toFixed(2)} ج</td></tr>` : ''}
      <tr class="total"><td>الإجمالي</td><td style="text-align:left">${Number(inv.totalAmount).toFixed(2)} ج</td></tr>
    </tbody></table>
    <div class="dashed"></div>
    <div class="center" style="margin-top:8px"><p>شكراً لتعاملكم معنا</p></div>
  </body></html>`
  openPrintWindow(html, 400, 640, 250)
}

// ─── A4 invoice ──────────────────────────────────────────────────────────────
export interface InvoiceForPrint {
  invoiceNumber: string
  createdAt: string
  status: string
  customer?: { fullName: string }
  paymentMethod?: { name: string }
  cashier?: { fullName: string }
  subtotal: number | string
  discountAmount: number | string
  taxTotal: number | string
  feeAmount: number | string
  totalAmount: number | string
  items?: { productName: string; quantity: number; unitPrice: number | string; totalPrice: number | string }[]
}

export function printInvoice(inv: InvoiceForPrint): void {
  const rows = (inv.items ?? []).map((item) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${esc(item.productName)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${Number(item.quantity)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:left">${fmt2(Number(item.unitPrice))}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:left">${fmt2(Number(item.totalPrice))}</td>
    </tr>`).join('')

  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
    <title>فاتورة ${inv.invoiceNumber}</title>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'IBM Plex Sans Arabic',Arial,sans-serif;font-size:13px;color:#111;background:#fff;padding:32px}
      h1{font-size:22px;font-weight:700;margin-bottom:4px}
      .meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:24px 0;padding:16px;background:#f9fafb;border-radius:8px}
      .meta-item label{font-size:11px;color:#6b7280;display:block;margin-bottom:2px}
      .meta-item p{font-weight:600}
      table{width:100%;border-collapse:collapse;margin-top:16px}
      th{background:#f3f4f6;padding:10px 12px;text-align:right;font-size:12px;color:#374151}
      th:not(:first-child){text-align:center}
      th:last-child,th:nth-child(3){text-align:left}
      .totals{margin-top:20px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-width:260px}
      .totals-row{display:flex;justify-content:space-between;width:260px;font-size:13px;color:#374151}
      .totals-row.total{font-size:16px;font-weight:700;border-top:2px solid #111;padding-top:8px;margin-top:4px}
      .footer{margin-top:40px;text-align:center;font-size:11px;color:#9ca3af}
      @media print{body{padding:16px}}
    </style></head><body>
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <h1>فاتورة ضريبية</h1>
        <p style="color:#6b7280;font-size:12px">حِسبة POS</p>
      </div>
      <div style="text-align:left">
        <p style="font-size:18px;font-weight:700;font-family:'IBM Plex Mono',monospace">${esc(inv.invoiceNumber)}</p>
        <p style="font-size:12px;color:#6b7280">${formatDateTime(inv.createdAt)}</p>
      </div>
    </div>
    <div class="meta">
      <div class="meta-item"><label>العميل</label><p>${esc(inv.customer?.fullName ?? 'نقدي')}</p></div>
      <div class="meta-item"><label>طريقة الدفع</label><p>${esc(inv.paymentMethod?.name ?? '—')}</p></div>
      <div class="meta-item"><label>الكاشير</label><p>${esc(inv.cashier?.fullName ?? '—')}</p></div>
      <div class="meta-item"><label>الحالة</label><p>${inv.status === 'completed' ? 'مكتملة' : esc(inv.status)}</p></div>
    </div>
    <table>
      <thead><tr>
        <th>الصنف</th><th style="text-align:center">الكمية</th><th style="text-align:left">سعر الوحدة</th><th style="text-align:left">الإجمالي</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div class="totals-row"><span>المجموع الفرعي</span><span>${fmt2(Number(inv.subtotal))}</span></div>
      ${Number(inv.discountAmount) > 0 ? `<div class="totals-row" style="color:#dc2626"><span>الخصم</span><span>- ${fmt2(Number(inv.discountAmount))}</span></div>` : ''}
      ${Number(inv.taxTotal) > 0 ? `<div class="totals-row"><span>الضريبة</span><span>${fmt2(Number(inv.taxTotal))}</span></div>` : ''}
      ${Number(inv.feeAmount) > 0 ? `<div class="totals-row"><span>رسوم الدفع</span><span>${fmt2(Number(inv.feeAmount))}</span></div>` : ''}
      <div class="totals-row total"><span>الإجمالي</span><span>${fmt2(Number(inv.totalAmount))} ج</span></div>
    </div>
    <div class="footer"><p>شكراً لتعاملكم معنا — تم الإنشاء بواسطة حِسبة</p></div>
  </body></html>`

  openPrintWindow(html, 800, 1000, 300)
}

// ─── Barcode labels (3-column A4 grid) ───────────────────────────────────────
export interface BarcodeLabel {
  name: string
  sku: string
  barcode: string
  price: number
}

export function printBarcodeLabels(labels: BarcodeLabel[], copies = 1): void {
  const repeated = labels.flatMap((l) => Array(copies).fill(l) as BarcodeLabel[])
  const cells = repeated.map((l) => `
    <div class="label">
      <p class="name">${esc(l.name)}</p>
      <div class="barcode">${esc(l.barcode || l.sku)}</div>
      <p class="sku">${esc(l.sku)} — ${Number(l.price).toFixed(2)} ج</p>
    </div>
  `).join('')
  const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>ملصقات الباركود</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Libre+Barcode+128+Text&display=swap" rel="stylesheet">
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'IBM Plex Sans Arabic',Arial,sans-serif;background:#fff;padding:8px}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
      .label{border:1px dashed #ccc;border-radius:4px;padding:6px 8px;text-align:center;page-break-inside:avoid}
      .name{font-size:10px;font-weight:bold;color:#111;margin-bottom:4px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
      .barcode{font-family:'Libre Barcode 128 Text',monospace;font-size:48px;line-height:1;color:#000;margin:2px 0}
      .sku{font-size:9px;color:#555;margin-top:3px}
      @media print{@page{margin:6mm;size:A4}body{padding:0}}
    </style></head><body>
    <div class="grid">${cells}</div>
  </body></html>`
  // SEC-01: no inline <script> in the printed document — the parent triggers
  // print/close via openPrintWindow so a strict script-src CSP holds. Barcode
  // fonts need a beat to load before printing, hence the longer close delay.
  openPrintWindow(html, 800, 600, 500)
}

// ─── Purchase order ──────────────────────────────────────────────────────────
// Reflects the actual Prisma model: `totalAmount` + per-item `subtotal`.
// `poRef` is derived from the row id (no dedicated PO number column).
export interface PurchaseOrderForPrint {
  id: string
  status: string
  createdAt: string
  totalAmount: number | string
  supplier?: { name: string }
  branch?: { name: string }
  createdBy?: { fullName: string }
  approvedBy?: { fullName: string }
  items?: { variant: { sku: string; product: { name: string } }; quantity: number; unitCost: number | string; subtotal: number | string }[]
}

export function printPurchaseOrder(po: PurchaseOrderForPrint, statusLabel: string): void {
  const poRef = po.id.slice(0, 8).toUpperCase()
  const rows = (po.items ?? []).map((item) =>
    `<tr><td>${esc(item.variant.product.name)}</td><td>${esc(item.variant.sku)}</td><td style="text-align:center">${Number(item.quantity)}</td><td style="text-align:left">${Number(item.unitCost).toFixed(2)} ج</td><td style="text-align:left">${Number(item.subtotal).toFixed(2)} ج</td></tr>`
  ).join('')
  const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>أمر شراء ${poRef}</title>
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
    <style>
    *{box-sizing:border-box;margin:0;padding:0}body{font-family:'IBM Plex Sans Arabic',Arial,sans-serif;font-size:13px;padding:24px;color:#000}
    h1{font-size:20px;margin-bottom:4px}h2{font-size:13px;color:#555;margin-bottom:16px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px}
    .grid div{font-size:12px}.grid div span{color:#777;display:block;font-size:11px}
    table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:right}
    th{background:#f5f5f5;font-weight:600}.total td{font-weight:bold;border-top:2px solid #999}
    .footer{margin-top:40px;display:flex;justify-content:space-between}
    @media print{@page{margin:15mm;size:A4}}
  </style></head><body>
    <h1>حِسبة — أمر شراء</h1>
    <h2>رقم الأمر: <strong>${esc(poRef)}</strong> | الحالة: ${esc(statusLabel)}</h2>
    <div class="grid">
      <div><span>المورد</span>${esc(po.supplier?.name ?? '—')}</div>
      <div><span>الفرع</span>${esc(po.branch?.name ?? '—')}</div>
      <div><span>أنشأه</span>${esc(po.createdBy?.fullName ?? '—')}</div>
      <div><span>تاريخ الإنشاء</span>${formatDate(po.createdAt)}</div>
      ${po.approvedBy ? `<div><span>وافق عليه</span>${esc(po.approvedBy.fullName)}</div>` : ''}
    </div>
    <table>
      <thead><tr><th>المنتج</th><th>SKU</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="total"><td colspan="4">الإجمالي الكلي</td><td style="text-align:left">${Number(po.totalAmount).toFixed(2)} ج</td></tr></tfoot>
    </table>
    <div class="footer">
      <div style="text-align:center;width:40%"><div style="border-top:1px solid #000;margin-top:40px;padding-top:8px">توقيع المستلم</div></div>
      <div style="text-align:center;width:40%"><div style="border-top:1px solid #000;margin-top:40px;padding-top:8px">توقيع المورد</div></div>
    </div>
  </body></html>`
  openPrintWindow(html, 800, 700, 300)
}

// ─── Work Order Receipt ───────────────────────────────────────────────────────
export interface WorkOrderReceiptData {
  ticketNumber: string
  invoiceNumber?: string
  createdAt: string
  customerName?: string
  paymentMethodName?: string
  status: string
  services: { name: string; quantity: number; unitPrice: number; lineTotal: number }[]
  estimatedTotal?: number
  finalTotal?: number
  paidAmount: number
  diagnosisNotes?: string
  workNotes?: string
}

export function printWorkOrderReceipt(wo: WorkOrderReceiptData): void {
  const rows = wo.services.map((s) =>
    `<tr>
      <td>${esc(s.name)}</td>
      <td style="text-align:center">${Number(s.quantity)}</td>
      <td style="text-align:left">${fmt2(s.unitPrice)}</td>
      <td style="text-align:left">${fmt2(s.lineTotal)}</td>
    </tr>`
  ).join('')

  const total = wo.finalTotal ?? wo.estimatedTotal ?? wo.paidAmount

  const html = `<!DOCTYPE html><html dir="rtl" lang="ar">
  <head><meta charset="UTF-8">
  <title>إيصال طلب عمل ${wo.ticketNumber}</title>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'IBM Plex Sans Arabic',Arial,sans-serif;font-size:13px;padding:32px;color:#111;max-width:600px;margin:auto}
    .header{border-bottom:2px solid #000;padding-bottom:12px;margin-bottom:16px}
    h1{font-size:18px;font-weight:700}
    h2{font-size:13px;font-weight:600;margin:16px 0 6px;color:#374151}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;margin-bottom:16px}
    .meta span{color:#6b7280}
    table{width:100%;border-collapse:collapse;margin-bottom:12px}
    th{background:#f3f4f6;padding:7px 8px;text-align:right;font-size:11px}
    td{padding:6px 8px;border-bottom:1px solid #e5e7eb}
    .total-row td{font-weight:700;background:#f9fafb;font-size:14px}
    .notes{background:#fafafa;border:1px solid #e5e7eb;border-radius:6px;padding:10px;font-size:12px;color:#374151;margin-top:12px}
    .paid{text-align:left;font-size:16px;font-weight:700;margin-top:16px}
    @media print{body{padding:16px}}
  </style></head>
  <body>
    <div class="header">
      <h1>إيصال خدمة — ${esc(wo.ticketNumber)}</h1>
      ${wo.invoiceNumber ? `<p style="font-size:12px;color:#6b7280">فاتورة رقم: ${esc(wo.invoiceNumber)}</p>` : ''}
      <p style="font-size:12px;color:#6b7280">التاريخ: ${formatDate(wo.createdAt)} — حِسبة Services</p>
    </div>

    <div class="meta">
      <div><span>العميل</span><br/>${esc(wo.customerName ?? 'عميل غير محدد')}</div>
      <div><span>طريقة الدفع</span><br/>${esc(wo.paymentMethodName ?? '—')}</div>
    </div>

    <h2>الخدمات المنجزة</h2>
    ${rows.length > 0 ? `
    <table>
      <thead><tr><th>الخدمة</th><th style="text-align:center">الكمية</th><th style="text-align:left">سعر الوحدة</th><th style="text-align:left">الإجمالي</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="total-row"><td colspan="3">الإجمالي</td><td style="text-align:left">${fmt2(total)} ج</td></tr></tfoot>
    </table>` : `<p style="color:#6b7280;font-size:12px">لا توجد خدمات مسجلة</p>`}

    ${wo.diagnosisNotes ? `<div class="notes"><strong>ملاحظات التشخيص:</strong> ${esc(wo.diagnosisNotes)}</div>` : ''}
    ${wo.workNotes ? `<div class="notes" style="margin-top:8px"><strong>ملاحظات العمل:</strong> ${esc(wo.workNotes)}</div>` : ''}

    <p class="paid">المبلغ المدفوع: ${fmt2(wo.paidAmount)} ج</p>

    <div style="margin-top:32px;display:flex;justify-content:space-between">
      <div style="width:45%;text-align:center"><div style="border-top:1px solid #000;margin-top:40px;padding-top:8px;font-size:11px">توقيع العميل</div></div>
      <div style="width:45%;text-align:center"><div style="border-top:1px solid #000;margin-top:40px;padding-top:8px;font-size:11px">توقيع الفني</div></div>
    </div>
  </body></html>`

  openPrintWindow(html, 650, 850, 300)
}
