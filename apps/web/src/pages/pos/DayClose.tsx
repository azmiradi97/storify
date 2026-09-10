import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Printer, RefreshCw } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { Button, SkeletonTable } from '@/components/ui'
import { api } from '@/api/client'
import { formatMoney, formatDate } from '@/lib/format'

interface MethodRow {
  methodId: string | null
  methodName: string
  total: number
  count: number
}

interface DayCloseData {
  date: string
  pos: { byMethod: MethodRow[]; total: number; count: number }
  installments: { byMethod: MethodRow[]; total: number; count: number }
  services: { byMethod: MethodRow[]; total: number; count: number }
}

function BreakdownTable({ rows, total, count, label }: { rows: MethodRow[]; total: number; count: number; label: string }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-700 flex items-center justify-between">
        <h3 className="font-semibold text-gray-100">{label}</h3>
        <span className="text-xs text-gray-500">{count} معاملة</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-gray-500 text-center">لا توجد معاملات لهذا اليوم</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-750">
              <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium">طريقة الدفع</th>
              <th className="text-center px-4 py-2.5 text-xs text-gray-500 font-medium">عدد</th>
              <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.methodId ?? 'none'} className="border-t border-gray-700/60">
                <td className="px-4 py-3 text-gray-200">{r.methodName}</td>
                <td className="px-4 py-3 text-center font-numeric num num-strong">{r.count}</td>
                <td className="px-4 py-3 text-left font-numeric num num-primary">{formatMoney(r.total)} ج</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-600 bg-gray-750">
              <td className="px-4 py-3 font-semibold text-gray-100">الإجمالي</td>
              <td className="px-4 py-3 text-center font-mono text-gray-300">{count}</td>
              <td className="px-4 py-3 text-left font-mono font-bold text-brand-400">{formatMoney(total)} ج</td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  )
}

export default function DayClose() {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)

  const { data, isLoading, refetch } = useQuery<DayCloseData>({
    queryKey: ['day-close', date],
    queryFn: async () => (await api.get<{ data: DayCloseData }>('/reports/day-close', { params: { date } })).data.data,
  })

  const grandTotal =
    (data?.pos.total ?? 0) + (data?.installments.total ?? 0) + (data?.services.total ?? 0)
  const hasServices = (data?.services.count ?? 0) > 0

  const print = () => {
    const posRows = (data?.pos.byMethod ?? []).map((r) => `
      <tr><td>${r.methodName}</td><td style="text-align:center">${r.count}</td><td style="text-align:left">${formatMoney(r.total)} ج</td></tr>`).join('')
    const instRows = (data?.installments.byMethod ?? []).map((r) => `
      <tr><td>${r.methodName}</td><td style="text-align:center">${r.count}</td><td style="text-align:left">${formatMoney(r.total)} ج</td></tr>`).join('')
    const svcRows = (data?.services.byMethod ?? []).map((r) => `
      <tr><td>${r.methodName}</td><td style="text-align:center">${r.count}</td><td style="text-align:left">${formatMoney(r.total)} ج</td></tr>`).join('')
    const servicesSection = hasServices ? `
      <h2>الخدمات المحصلة (${data?.services.count ?? 0} طلب)</h2>
      <table><thead><tr><th>طريقة الدفع</th><th style="text-align:center">عدد</th><th style="text-align:left">الإجمالي</th></tr></thead>
      <tbody>${svcRows}</tbody>
      <tfoot><tr class="total-row"><td>الإجمالي</td><td style="text-align:center">${data?.services.count ?? 0}</td><td style="text-align:left">${formatMoney(data?.services.total ?? 0)} ج</td></tr></tfoot>
      </table>` : ''

    const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
      <title>إغلاق يوم ${date}</title>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        *{box-sizing:border-box;margin:0;padding:0}body{font-family:'IBM Plex Sans Arabic',Arial,sans-serif;font-size:13px;padding:32px;color:#111}
        h1{font-size:18px;font-weight:700;margin-bottom:4px}
        h2{font-size:14px;font-weight:600;margin:20px 0 8px}
        table{width:100%;border-collapse:collapse;margin-bottom:16px}
        th{background:#f3f4f6;padding:7px 10px;font-size:12px;text-align:right}
        td{padding:7px 10px;border-bottom:1px solid #e5e7eb}
        .total-row{font-weight:700;background:#f9fafb}
        .grand{font-size:16px;font-weight:700;margin-top:16px;text-align:left}
        @media print{body{padding:16px}}
      </style></head><body>
      <h1>تقرير إغلاق اليوم</h1>
      <p style="color:#6b7280;font-size:12px">تاريخ: ${formatDate(date)} — حِسبة POS</p>
      <h2>نقطة البيع (${data?.pos.count ?? 0} معاملة)</h2>
      <table><thead><tr><th>طريقة الدفع</th><th style="text-align:center">عدد</th><th style="text-align:left">الإجمالي</th></tr></thead>
      <tbody>${posRows}</tbody>
      <tfoot><tr class="total-row"><td>الإجمالي</td><td style="text-align:center">${data?.pos.count ?? 0}</td><td style="text-align:left">${formatMoney(data?.pos.total ?? 0)} ج</td></tr></tfoot>
      </table>
      <h2>الأقساط المحصلة (${data?.installments.count ?? 0} دفعة)</h2>
      <table><thead><tr><th>طريقة الدفع</th><th style="text-align:center">عدد</th><th style="text-align:left">الإجمالي</th></tr></thead>
      <tbody>${instRows}</tbody>
      <tfoot><tr class="total-row"><td>الإجمالي</td><td style="text-align:center">${data?.installments.count ?? 0}</td><td style="text-align:left">${formatMoney(data?.installments.total ?? 0)} ج</td></tr></tfoot>
      </table>
      ${servicesSection}
      <p class="grand">الإجمالي الكلي: ${formatMoney(grandTotal)} ج</p>
    </body></html>`

    const win = window.open('', '_blank', 'width=700,height=900')
    if (!win) return
    win.document.write(html)
    win.document.close()
    setTimeout(() => { win.print(); setTimeout(() => win.close(), 500) }, 300)
  }

  return (
    <AppShell title="إغلاق اليوم">
      <div className="flex flex-col gap-6 max-w-3xl mx-auto">
        {/* Header controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1">
            <label className="text-xs text-gray-500 block mb-1">التاريخ</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-brand-500"
            />
          </div>
          <div className="flex gap-2 mt-5">
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4" />تحديث
            </Button>
            <Button onClick={print} disabled={!data}>
              <Printer className="w-4 h-4" />طباعة
            </Button>
          </div>
        </div>

        {isLoading ? (
          <SkeletonTable rows={5} cols={3} />
        ) : (
          <>
            <BreakdownTable
              label="نقطة البيع — الفواتير المكتملة"
              rows={data?.pos.byMethod ?? []}
              total={data?.pos.total ?? 0}
              count={data?.pos.count ?? 0}
            />
            <BreakdownTable
              label="الأقساط — الدفعات المحصلة"
              rows={data?.installments.byMethod ?? []}
              total={data?.installments.total ?? 0}
              count={data?.installments.count ?? 0}
            />
            {/* Services table only renders when there's something to show — keeps
                the page clean for tenants without the services feature. */}
            {hasServices && (
              <BreakdownTable
                label="الخدمات — طلبات العمل المدفوعة"
                rows={data?.services.byMethod ?? []}
                total={data?.services.total ?? 0}
                count={data?.services.count ?? 0}
              />
            )}

            {/* Grand total */}
            <div className="bg-brand-500/10 border border-brand-500/30 rounded-xl px-5 py-4 flex items-center justify-between">
              <span className="text-gray-300 font-semibold">الإجمالي الكلي لليوم</span>
              <span className="text-2xl font-bold font-mono text-brand-400">{formatMoney(grandTotal)} ج</span>
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}
