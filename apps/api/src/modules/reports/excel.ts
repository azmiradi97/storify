import ExcelJS from 'exceljs'

// ─── Shared styles ────────────────────────────────────────────────────────────

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } }
  })
}

function autoWidth(sheet: ExcelJS.Worksheet) {
  sheet.columns.forEach((col) => {
    let max = 10
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = cell.value?.toString().length ?? 0
      if (len > max) max = len
    })
    col.width = Math.min(max + 4, 50)
  })
}

// ─── Sales ────────────────────────────────────────────────────────────────────

export async function buildSalesExcel(data: {
  summary: Record<string, number>
  invoices: Array<Record<string, unknown>>
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Hesba'

  // Summary sheet
  const summary = wb.addWorksheet('الملخص')
  summary.addRow(['المؤشر', 'القيمة'])
  styleHeader(summary.lastRow!)
  Object.entries(data.summary).forEach(([k, v]) => summary.addRow([k, v]))
  autoWidth(summary)

  // Invoices sheet
  const inv = wb.addWorksheet('الفواتير')
  inv.addRow(['رقم الفاتورة', 'التاريخ', 'الكاشير', 'العميل', 'طريقة الدفع', 'الإجمالي', 'رسوم الدفع', 'الفرع'])
  styleHeader(inv.lastRow!)

  for (const i of data.invoices as Array<{
    id: string
    createdAt: Date
    cashier?: { fullName: string }
    customer?: { fullName: string } | null
    paymentMethod?: { name: string }
    totalAmount: unknown
    feeAmount: unknown
    branch?: { name: string }
  }>) {
    inv.addRow([
      i.id.slice(0, 8),
      i.createdAt ? new Date(i.createdAt).toLocaleDateString('ar-EG-u-nu-latn') : '',
      i.cashier?.fullName ?? '',
      i.customer?.fullName ?? 'بدون عميل',
      i.paymentMethod?.name ?? '',
      Number(i.totalAmount),
      Number(i.feeAmount),
      i.branch?.name ?? '',
    ])
  }
  autoWidth(inv)

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

// ─── Stock ────────────────────────────────────────────────────────────────────

export async function buildStockExcel(items: Array<Record<string, unknown>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Hesba'

  const sheet = wb.addWorksheet('المخزون')
  sheet.addRow(['المنتج', 'SKU', 'الفرع', 'الكمية', 'الحد الأدنى', 'تحذير', 'سعر التكلفة', 'قيمة المخزون'])
  styleHeader(sheet.lastRow!)

  for (const item of items as Array<{
    product?: { name: string }
    sku?: string
    branch?: { name: string }
    quantity: number
    minQuantity: number
    isLowStock: boolean
    costPrice: number
    stockValue: number
  }>) {
    const row = sheet.addRow([
      item.product?.name ?? '',
      item.sku ?? '',
      item.branch?.name ?? '',
      item.quantity,
      item.minQuantity,
      item.isLowStock ? '⚠️ نقص' : '',
      item.costPrice,
      item.stockValue,
    ])
    if (item.isLowStock) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }
      })
    }
  }
  autoWidth(sheet)

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

// ─── Profit & Loss ────────────────────────────────────────────────────────────

export async function buildProfitLossExcel(data: Record<string, number | string>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Hesba'

  const sheet = wb.addWorksheet('الأرباح والخسائر')
  sheet.addRow(['البند', 'المبلغ (ج.م)'])
  styleHeader(sheet.lastRow!)

  const rows: [string, unknown][] = [
    ['الإيرادات الإجمالية', data.revenue],
    ['المرتجعات', data.refunds],
    ['صافي الإيرادات', data.netRevenue],
    ['تكلفة البضاعة المباعة (COGS)', data.cogs],
    ['إجمالي الربح', data.grossProfit],
    ['هامش الربح الإجمالي %', data.grossMarginPct],
    ['المصاريف التشغيلية', data.operatingExpenses],
    ['رسوم طرق الدفع', data.feeExpenses],
    ['إجمالي المصاريف', data.totalExpenses],
    ['صافي الربح', data.netProfit],
    ['هامش الربح الصافي %', data.netMarginPct],
  ]

  for (const [label, val] of rows) {
    sheet.addRow([label, val])
  }
  // Highlight net profit row
  const lastRow = sheet.lastRow!
  lastRow.font = { bold: true }

  autoWidth(sheet)

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}
