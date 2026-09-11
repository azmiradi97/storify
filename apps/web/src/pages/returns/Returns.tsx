import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, RotateCcw } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { Table, Badge, Money, SkeletonTable, Pagination, Drawer, DateRangePicker, BulkActionBar, Button, Select } from '@/components/ui'
import { api } from '@/api/client'
import type { PaginationMeta } from '@/types/api'
import { useSelection } from '@/hooks/useSelection'
import { exportRowsToExcel } from '@/lib/export'
import { formatDate, formatDateTime } from '@/lib/format'

interface ReturnItem {
  id: string
  quantity: number
  variant: { sku: string; product: { name: string } }
}

interface Return {
  id: string
  returnType: 'refund' | 'credit'
  amount: number
  reason?: string
  createdAt: string
  invoice: { invoiceNumber: string; customer?: { fullName: string } }
  processedBy: { fullName: string }
  items: ReturnItem[]
}


const LIMIT = 20

const typeMap = {
  refund: { label: 'استرداد نقدي', variant: 'danger' as const },
  credit: { label: 'رصيد عميل', variant: 'success' as const },
}

function ReturnDetailDrawer({ ret }: { ret: Return }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div><span className="text-gray-500">فاتورة</span><p className="num-code">{ret.invoice.invoiceNumber}</p></div>
        <div><span className="text-gray-500">العميل</span><p className="text-gray-100">{ret.invoice.customer?.fullName ?? 'نقدي'}</p></div>
        <div><span className="text-gray-500">النوع</span><p><Badge variant={typeMap[ret.returnType].variant}>{typeMap[ret.returnType].label}</Badge></p></div>
        <div><span className="text-gray-500">بواسطة</span><p className="text-gray-100">{ret.processedBy.fullName}</p></div>
        <div><span className="text-gray-500">التاريخ</span><p className="font-numeric num num-strong text-xs">{formatDateTime(ret.createdAt)}</p></div>
        <div><span className="text-gray-500">المبلغ المسترد</span><p><Money value={ret.amount} size="lg" /></p></div>
      </div>

      {ret.reason && (
        <div>
          <p className="text-xs text-gray-500 mb-1">سبب الإرجاع</p>
          <p className="text-sm text-gray-300 bg-gray-800 rounded-md px-3 py-2">{ret.reason}</p>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-gray-300 mb-3">الأصناف المرتجعة</h4>
        <div className="flex flex-col divide-y divide-gray-700">
          {ret.items.map((item) => (
            <div key={item.id} className="py-2.5 flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-100">{item.variant.product.name}</p>
                <p className="text-xs num-code">{item.variant.sku}</p>
              </div>
              <span className="font-numeric num num-strong text-sm">× {item.quantity}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Returns() {
  const [page, setPage] = useState(1)
  const [typeFilter, setTypeFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [detail, setDetail] = useState<Return | null>(null)

  const { data, isLoading } = useQuery<{ data: Return[]; meta: PaginationMeta }>({
    queryKey: ['returns', page, typeFilter, from, to],
    queryFn: async () =>
      (await api.get<{ data: Return[]; meta: PaginationMeta }>('/invoices/returns', {
        params: {
          page, limit: LIMIT,
          ...(typeFilter ? { returnType: typeFilter } : {}),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        },
      })).data,
  })

  const returns = data?.data ?? []
  const meta = data?.meta

  const selection = useSelection(returns.map((r) => r.id))

  const bulkExport = async () => {
    const selected = returns.filter((r) => selection.isSelected(r.id))
    await exportRowsToExcel(
      selected,
      [
        { header: 'الفاتورة', accessor: (r) => r.invoice.invoiceNumber, width: 18 },
        { header: 'العميل', accessor: (r) => r.invoice.customer?.fullName ?? 'نقدي', width: 24 },
        { header: 'النوع', accessor: (r) => typeMap[r.returnType].label, width: 14 },
        { header: 'عدد الأصناف', accessor: (r) => r.items.length, width: 12 },
        { header: 'المبلغ', accessor: 'amount', width: 14 },
        { header: 'الموظف', accessor: (r) => r.processedBy.fullName, width: 18 },
        { header: 'السبب', accessor: (r) => r.reason ?? '', width: 30 },
        { header: 'التاريخ', accessor: (r) => formatDateTime(r.createdAt), width: 22 },
      ],
      `returns-${selected.length}.xlsx`,
      'المرتجعات',
    )
  }

  return (
    <AppShell title="المرتجعات">
      <div className="flex flex-col gap-6">
        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <Select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}
          >
            <option value="">كل الأنواع</option>
            <option value="refund">استرداد نقدي</option>
            <option value="credit">رصيد عميل</option>
          </Select>
          <DateRangePicker
            value={{ from, to }}
            onChange={(v) => { setFrom(v.from); setTo(v.to); setPage(1) }}
          />
        </div>

        {isLoading ? <SkeletonTable rows={8} cols={6} /> : (
          <>
            <Table
              selection={{
                isSelected: (r) => selection.isSelected(r.id),
                onToggle: (r) => selection.toggle(r.id),
                onToggleAll: selection.toggleAllVisible,
                allSelected: selection.allVisibleSelected,
                someSelected: selection.someVisibleSelected,
              }}
              columns={[
                { key: 'invoice', header: 'الفاتورة', render: (r) => (
                  <button className="font-mono text-brand-400 hover:underline" onClick={() => setDetail(r)}>
                    {r.invoice.invoiceNumber}
                  </button>
                )},
                { key: 'customer', header: 'العميل', render: (r) => r.invoice.customer?.fullName ?? <span className="text-gray-500">نقدي</span> },
                { key: 'returnType', header: 'النوع', render: (r) => <Badge variant={typeMap[r.returnType].variant}>{typeMap[r.returnType].label}</Badge> },
                { key: 'items', header: 'الأصناف', render: (r) => <span className="font-numeric num num-strong">{r.items.length} صنف</span> },
                { key: 'amount', header: 'المبلغ', render: (r) => <Money value={r.amount} /> },
                { key: 'processedBy', header: 'الموظف', render: (r) => <span className="text-gray-500 text-sm">{r.processedBy.fullName}</span> },
                { key: 'createdAt', header: 'التاريخ', render: (r) => <span className="text-gray-500 text-xs">{formatDate(r.createdAt)}</span> },
              ]}
              data={returns} keyExtractor={(r) => r.id} emptyMessage="لا توجد مرتجعات" emptyIcon={<RotateCcw className="w-8 h-8" />} emptyDescription="لم تُسجَّل أي مرتجعات في هذه الفترة"
            />
            {meta && <Pagination page={meta.page} pages={meta.pages} total={meta.total} limit={meta.limit} onPage={setPage} />}
          </>
        )}
      </div>

      <Drawer open={!!detail} onClose={() => setDetail(null)} title={`مرتجع فاتورة ${detail?.invoice.invoiceNumber ?? ''}`} width="w-[480px]">
        {detail && <ReturnDetailDrawer ret={detail} />}
      </Drawer>
      <BulkActionBar count={selection.count} onClear={selection.clear}>
        <Button variant="outline" size="sm" onClick={bulkExport}>
          <Download className="w-4 h-4" />تصدير
        </Button>
      </BulkActionBar>
    </AppShell>
  )
}
