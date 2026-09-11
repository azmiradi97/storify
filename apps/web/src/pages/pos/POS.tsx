import { useState, useRef, useCallback, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useHotkeys } from 'react-hotkeys-hook'
import { Search, X, Plus, Minus, ShoppingCart, UserPlus, Printer, Check, ScanLine, Tag, WifiOff, BookCheck, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { AppShell } from '@/components/layout/AppShell'
import { Button, Input, Badge, Money, Modal, Kbd } from '@/components/ui'
import { api } from '@/api/client'
import { cn } from '@/lib/cn'
import { printReceipt } from '@/lib/print'
import { formatNumber, formatMoney, formatDate } from '@/lib/format'
import { getApiErrorMessage, getApiErrorCode } from '@/lib/api-error'

interface Variant {
  id: string
  sku: string
  barcode?: string
  sellPrice: number
  costPrice: number
  attributes: Record<string, string>
  stock: number
  product: { id: string; name: string; has_variants: boolean }
}

interface CartItem {
  variantId: string
  productName: string
  sku: string
  attributes: Record<string, string>
  unitPrice: number
  quantity: number
  availableStock: number
}

interface PaymentMethod {
  id: string
  name: string
  type: string
  feeType: 'percent' | 'fixed' | 'both' | 'none'
  feePercentage: string | number
  feeFixed?: string | number
  feeBearer: 'merchant' | 'customer' | 'negotiable'
}

interface Customer {
  id: string
  fullName: string
  phone?: string
  creditBalance?: number
}

interface Currency {
  id: string
  code: string
  name: string
  symbol: string
  rateToBase: number
  isBase: boolean
}

interface AppliedCoupon {
  code: string
  discountType: 'percentage' | 'fixed'
  discountValue: number
  minAmount?: number | null
}

interface CompletedInvoice {
  id: string
  invoiceNumber: string
  totalAmount: number
  subtotal: number
  feeAmount: number
  couponCode?: string
  couponDiscount?: number
  customerName?: string
  paymentMethodName: string
  createdAt: string
  items: { productName: string; sku: string; quantity: number; unitPrice: number; lineTotal: number }[]
}

function calculateFee(total: number, pm: PaymentMethod): number {
  const pct = Number(pm.feePercentage)
  const fixed = Number(pm.feeFixed ?? 0)
  if (pm.feeType === 'none') return 0
  if (pm.feeType === 'percent') return total * (pct / 100)
  if (pm.feeType === 'fixed') return fixed
  if (pm.feeType === 'both') return total * (pct / 100) + fixed
  return 0
}

export default function POS() {
  const [cart, setCart] = useState<CartItem[]>([])
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Variant[]>([])
  const [searchIndex, setSearchIndex] = useState(-1)
  const [barcode, setBarcode] = useState('')
  const [selectedPM, setSelectedPM] = useState<PaymentMethod | null>(null)
  const [feeBearer, setFeeBearer] = useState<'merchant' | 'customer'>('merchant')
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [completedInvoice, setCompletedInvoice] = useState<CompletedInvoice | null>(null)
  const [couponInput, setCouponInput] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null)
  const [couponLoading, setCouponLoading] = useState(false)
  const [showEOD, setShowEOD] = useState(false)
  const [actualCash, setActualCash] = useState('')
  const [useCredit, setUseCredit] = useState(false)
  const [creditAmount, setCreditAmount] = useState('')
  const [splitPM, setSplitPM] = useState<PaymentMethod | null>(null)
  const [splitAmount, setSplitAmount] = useState('')
  const [selectedCurrency, setSelectedCurrency] = useState<Currency | null>(null)
  const [pmSectionOpen, setPmSectionOpen] = useState(true)
  const [splitSectionOpen, setSplitSectionOpen] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [offlineQueue, setOfflineQueue] = useState<unknown[]>(() => {
    try { return JSON.parse(localStorage.getItem('pos_offline_queue') ?? '[]') } catch { return [] }
  })
  const searchRef = useRef<HTMLInputElement>(null)
  const barcodeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const goOnline = async () => {
      setIsOnline(true)
      const queue: unknown[] = JSON.parse(localStorage.getItem('pos_offline_queue') ?? '[]')
      if (queue.length === 0) return
      toast.loading(`جاري إرسال ${queue.length} فاتورة معلقة...`, { id: 'sync' })
      let sent = 0
      const remaining: unknown[] = []
      for (const payload of queue) {
        try {
          await api.post('/invoices', payload)
          sent++
        } catch { remaining.push(payload) }
      }
      localStorage.setItem('pos_offline_queue', JSON.stringify(remaining))
      setOfflineQueue(remaining)
      toast.dismiss('sync')
      if (sent > 0) toast.success(`تم إرسال ${sent} فاتورة كانت معلقة`)
      if (remaining.length > 0) toast.error(`فشل إرسال ${remaining.length} فاتورة`)
    }
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline) }
  }, [])

  const { data: paymentMethods = [] } = useQuery<PaymentMethod[]>({
    queryKey: ['payment-methods'],
    queryFn: async () => (await api.get<{ data: PaymentMethod[] }>('/payment-methods')).data.data,
  })

  const { data: currencies = [] } = useQuery<Currency[]>({
    queryKey: ['currencies'],
    queryFn: async () => (await api.get<{ data: Currency[] }>('/currencies')).data.data,
  })

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ['customers-search', customerSearch],
    queryFn: async () =>
      (await api.get<{ data: Customer[] }>('/customers', { params: { search: customerSearch, limit: 10 } })).data.data,
    enabled: customerSearch.length > 1,
  })

  const todayDate = new Date().toISOString().slice(0, 10)

  interface DashboardToday { revenue: number; invoiceCount: number; feeExpenses: number }
  interface SalesByPM { paymentMethodName: string; totalRevenue: number; invoiceCount: number }
  interface ApiSalesByPM { paymentMethod: { id: string; name?: string }; totalRevenue: number; count: number }

  const { data: eodDashboard } = useQuery<DashboardToday>({
    queryKey: ['eod-dashboard'],
    queryFn: async () => (await api.get<{ data: { today: DashboardToday } }>('/reports/dashboard')).data.data.today,
    enabled: showEOD,
    refetchOnMount: true,
  })

  const { data: eodByPM } = useQuery<SalesByPM[]>({
    queryKey: ['eod-by-pm', todayDate],
    queryFn: async () => {
      const res = await api.get<{ data: { byPaymentMethod: ApiSalesByPM[] } }>('/reports/sales', {
        params: { from: todayDate, to: todayDate, groupBy: 'day' },
      })
      return (res.data.data.byPaymentMethod ?? []).map((r) => ({
        paymentMethodName: r.paymentMethod.name ?? r.paymentMethod.id,
        totalRevenue: r.totalRevenue,
        invoiceCount: r.count,
      }))
    },
    enabled: showEOD,
    refetchOnMount: true,
  })

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setSearchResults([]); return }
    try {
      const res = await api.get<{ data: Variant[] }>('/products/search', { params: { q, limit: 8 } })
      setSearchResults(res.data.data)
    } catch {
      setSearchResults([])
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => doSearch(search), 250)
    return () => clearTimeout(t)
  }, [search, doSearch])

  useEffect(() => { setSearchIndex(-1) }, [searchResults])

  useEffect(() => { searchRef.current?.focus() }, [])

  const handleBarcodeEnter = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !barcode.trim()) return
    const code = barcode.trim()
    setBarcode('')
    try {
      const res = await api.get<{ data: Variant }>(`/products/barcode/${encodeURIComponent(code)}`)
      addToCart(res.data.data)
    } catch {
      toast.error('لم يتم العثور على المنتج بهذا الباركود')
      barcodeRef.current?.focus()
    }
  }

  const addToCart = (variant: Variant) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.variantId === variant.id)
      if (existing) {
        if (existing.quantity >= existing.availableStock) {
          toast.error('الكمية المتاحة غير كافية')
          return prev
        }
        return prev.map((i) =>
          i.variantId === variant.id ? { ...i, quantity: i.quantity + 1 } : i,
        )
      }
      return [
        ...prev,
        {
          variantId: variant.id,
          productName: variant.product.name,
          sku: variant.sku,
          attributes: variant.attributes,
          unitPrice: Number(variant.sellPrice),
          quantity: 1,
          availableStock: variant.stock,
        },
      ]
    })
    setSearch('')
    setSearchResults([])
    searchRef.current?.focus()
  }

  const updateQty = (variantId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) =>
          i.variantId === variantId
            ? { ...i, quantity: Math.max(0, Math.min(i.quantity + delta, i.availableStock)) }
            : i,
        )
        .filter((i) => i.quantity > 0),
    )
  }

  const removeItem = (variantId: string) => setCart((prev) => prev.filter((i) => i.variantId !== variantId))

  const subtotal = cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0)

  const couponDiscount = appliedCoupon
    ? appliedCoupon.discountType === 'percentage'
      ? Math.min(subtotal * (appliedCoupon.discountValue / 100), subtotal)
      : Math.min(appliedCoupon.discountValue, subtotal)
    : 0
  const discountedSubtotal = subtotal - couponDiscount

  const fee = selectedPM ? calculateFee(discountedSubtotal, selectedPM) : 0
  const total = feeBearer === 'customer' ? discountedSubtotal + fee : discountedSubtotal

  const appliedCredit = useCredit && customer?.creditBalance && Number(creditAmount) > 0
    ? Math.min(Number(creditAmount), customer.creditBalance, total)
    : 0

  const validateCoupon = async () => {
    if (!couponInput.trim()) return
    setCouponLoading(true)
    try {
      const res = await api.get<{ data: AppliedCoupon }>('/coupons/validate', { params: { code: couponInput.trim().toUpperCase() } })
      const c = res.data.data
      if (c.minAmount && discountedSubtotal < Number(c.minAmount)) {
        toast.error(`الحد الأدنى للطلب ${formatNumber(Number(c.minAmount), { maximumFractionDigits: 0 })} ج`)
      } else {
        setAppliedCoupon({ ...c, discountValue: Number(c.discountValue) })
        toast.success('تم تطبيق الكوبون')
        setCouponInput('')
      }
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'كوبون غير صالح'))
    } finally {
      setCouponLoading(false)
    }
  }

  const splitAmountNum = splitPM && Number(splitAmount) > 0 ? Math.min(Number(splitAmount), Math.max(0, total - appliedCredit)) : 0

  const { mutate: submitSale, isPending } = useMutation({
    mutationFn: async () => {
      if (!selectedPM) throw new Error('اختر طريقة الدفع')
      if (cart.length === 0) throw new Error('السلة فارغة')
      const payload = {
        paymentMethodId: selectedPM.id,
        customerId: customer?.id,
        currencyId: selectedCurrency?.id,
        feeBearer,
        couponCode: appliedCoupon?.code,
        creditAmount: appliedCredit > 0 ? appliedCredit : undefined,
        splitPaymentMethodId: splitAmountNum > 0 ? splitPM?.id : undefined,
        splitPaymentAmount: splitAmountNum > 0 ? splitAmountNum : undefined,
        items: cart.map((i) => ({ variantId: i.variantId, quantity: i.quantity, unitPrice: i.unitPrice })),
      }
      if (!navigator.onLine) {
        try {
          const queue = JSON.parse(localStorage.getItem('pos_offline_queue') ?? '[]')
          queue.push(payload)
          localStorage.setItem('pos_offline_queue', JSON.stringify(queue))
          setOfflineQueue(queue)
        } catch {
          // localStorage unavailable (private browsing quota exceeded) — queue lost but sale proceeds
        }
        return { id: 'offline', invoiceNumber: `OFFLINE-${Date.now()}`, totalAmount: 0, feeAmount: 0 }
      }
      const res = await api.post<{ data: { id: string; invoiceNumber: string; totalAmount: number; feeAmount: number } }>('/invoices', payload)
      return res.data.data
    },
    onSuccess: (apiInvoice) => {
      const invoiceRecord: CompletedInvoice = {
        id: apiInvoice.id,
        invoiceNumber: apiInvoice.invoiceNumber,
        totalAmount: Number(apiInvoice.totalAmount),
        subtotal: Number(subtotal),
        feeAmount: feeBearer === 'customer' ? Number(fee) : 0,
        couponCode: appliedCoupon?.code,
        couponDiscount: couponDiscount > 0 ? couponDiscount : undefined,
        customerName: customer?.fullName,
        paymentMethodName: selectedPM!.name,
        createdAt: new Date().toISOString(),
        items: cart.map((i) => ({
          productName: i.productName,
          sku: i.sku,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          lineTotal: i.unitPrice * i.quantity,
        })),
      }
      setCompletedInvoice(invoiceRecord)
      setCart([])
      setCustomer(null)
      setSelectedPM(null)
      setAppliedCoupon(null)
      setCouponInput('')
      setUseCredit(false)
      setCreditAmount('')
      setSplitPM(null)
      setSplitAmount('')
      setSelectedCurrency(null)
      toast.success(`تم إنشاء الفاتورة ${apiInvoice.invoiceNumber}`)
    },
    onError: (e: unknown) => {
      if (getApiErrorCode(e) === 'insufficient_stock') {
        toast.error('المخزون غير كافٍ لأحد المنتجات')
      } else {
        toast.error(getApiErrorMessage(e, 'فشل إنشاء الفاتورة'))
      }
    },
  })

  // ─── Keyboard shortcuts ──────────────────────────────────────────────────────
  // enableOnFormTags lets these fire even while typing in another input — so the
  // cashier can hop back to search/barcode without breaking flow.
  useHotkeys('mod+k', (e) => { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select() }, { enableOnFormTags: true })
  useHotkeys('mod+b', (e) => { e.preventDefault(); barcodeRef.current?.focus(); barcodeRef.current?.select() }, { enableOnFormTags: true })
  useHotkeys(
    'mod+enter',
    (e) => {
      e.preventDefault()
      if (cart.length === 0 || !selectedPM || isPending) return
      submitSale()
    },
    { enableOnFormTags: true },
    [cart.length, selectedPM, isPending],
  )

  return (
    <AppShell title="نقطة البيع">
      {/* Offline banner */}
      {(!isOnline || offlineQueue.length > 0) && (
        <div className={cn(
          'flex items-center gap-2 px-4 py-2 rounded-md mb-4 text-sm',
          !isOnline ? 'bg-danger-500/10 border border-danger-500/30 text-danger-600' : 'bg-warning-500/10 border border-warning-500/30 text-warning-600',
        )}>
          <WifiOff className="w-4 h-4 shrink-0" />
          {!isOnline
            ? `أنت غير متصل بالإنترنت — الفواتير ستُحفظ محلياً (${offlineQueue.length} في الانتظار)`
            : `${offlineQueue.length} فاتورة معلقة — سيتم إرسالها تلقائياً`}
        </div>
      )}
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:h-[calc(100dvh-8rem)]">
        {/* LEFT: Search + Cart */}
        <div className="flex-1 flex flex-col gap-4 min-w-0 min-h-0">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
            <Input
              ref={searchRef}
              placeholder="ابحث عن منتج بالاسم أو SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              startIcon={<Search className="w-4 h-4" />}
              endIcon={<Kbd>Ctrl K</Kbd>}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={searchResults.length > 0}
              aria-controls={searchResults.length > 0 ? 'pos-search-listbox' : undefined}
              aria-activedescendant={searchIndex >= 0 ? `pos-result-${searchIndex}` : undefined}
              onKeyDown={(e) => {
                if (searchResults.length === 0) return
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSearchIndex((i) => Math.min(i + 1, searchResults.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSearchIndex((i) => Math.max(i - 1, 0))
                } else if (e.key === 'Enter' && searchIndex >= 0) {
                  e.preventDefault()
                  addToCart(searchResults[searchIndex])
                  setSearch('')
                  setSearchResults([])
                } else if (e.key === 'Escape') {
                  setSearch('')
                  setSearchResults([])
                }
              }}
            />
            {searchResults.length > 0 && (
              <div
                id="pos-search-listbox"
                role="listbox"
                aria-label="نتائج البحث"
                className="absolute z-50 top-full mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg shadow-lg overflow-hidden"
              >
                {searchResults.map((v, idx) => (
                  <button
                    key={v.id}
                    id={`pos-result-${idx}`}
                    role="option"
                    aria-selected={idx === searchIndex}
                    onClick={() => { addToCart(v); setSearch(''); setSearchResults([]) }}
                    className={cn(
                      'w-full text-right px-4 py-3 flex items-center justify-between border-b border-gray-700/50 last:border-0 transition-colors',
                      idx === searchIndex ? 'bg-gray-700' : 'hover:bg-gray-700',
                    )}
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-100">{v.product.name}</p>
                      <p className="text-xs text-gray-500">{v.sku}</p>
                    </div>
                    <div className="text-left">
                      <Money value={v.sellPrice} size="sm" />
                      <p className={cn('text-xs', v.stock === 0 ? 'text-danger-500' : v.stock <= 5 ? 'text-warning-500' : 'text-success-500')}>
                        {v.stock} متاح
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            </div>
            <div className="w-full sm:w-52">
              <Input
                ref={barcodeRef}
                placeholder="باركود..."
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={handleBarcodeEnter}
                startIcon={<ScanLine className="w-4 h-4" />}
                endIcon={<Kbd>Ctrl B</Kbd>}
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto bg-white rounded-xl border border-gray-700 shadow-sm min-h-[240px] lg:min-h-0">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 py-12">
                <div className="w-16 h-16 rounded-2xl bg-brand-500/10 flex items-center justify-center">
                  <ShoppingCart className="w-8 h-8 text-brand-500/60" />
                </div>
                <div className="flex flex-col gap-1 text-center">
                  <p className="text-sm font-medium text-gray-300">السلة فارغة</p>
                  <p className="text-xs text-gray-500">ابحث عن منتج أو امسح الباركود للبدء</p>
                </div>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-750 border-b border-gray-700">
                  <tr>
                    <th className="text-right px-4 py-3 text-xs text-gray-500 uppercase">المنتج</th>
                    <th className="text-center px-4 py-3 text-xs text-gray-500 uppercase w-32">الكمية</th>
                    <th className="text-left px-4 py-3 text-xs text-gray-500 uppercase">الإجمالي</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {cart.map((item) => (
                    <tr key={item.variantId} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-100">{item.productName}</p>
                        <p className="text-xs text-gray-500">{item.sku}</p>
                        {item.quantity >= item.availableStock && (
                          <Badge variant="danger" dot className="mt-1">الحد الأقصى</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => updateQty(item.variantId, -1)}
                            className="w-11 h-11 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center"
                            aria-label="تقليل الكمية"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <span className="w-8 text-center font-mono">{item.quantity}</span>
                          <button
                            onClick={() => updateQty(item.variantId, 1)}
                            className="w-11 h-11 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center disabled:opacity-40"
                            disabled={item.quantity >= item.availableStock}
                            aria-label="زيادة الكمية"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Money value={item.unitPrice * item.quantity} />
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => removeItem(item.variantId)}
                          className="w-11 h-11 flex items-center justify-center rounded-md text-gray-500 hover:text-danger-500 hover:bg-gray-700 transition-colors"
                          aria-label="إزالة من السلة"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* RIGHT: Totals + Payment */}
        <div className="w-full lg:w-80 lg:flex-shrink-0 flex flex-col gap-4 min-h-0 lg:overflow-y-auto lg:pb-2">
          <div className="bg-white rounded-xl border border-gray-700 shadow-sm p-4">
            {customer ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-100">{customer.fullName}</p>
                    {customer.phone && <p className="text-xs text-gray-500">{customer.phone}</p>}
                  </div>
                  <button onClick={() => { setCustomer(null); setUseCredit(false); setCreditAmount('') }} className="text-gray-500 hover:text-danger-500">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {(customer.creditBalance ?? 0) > 0 && (
                  <div className="flex items-center gap-2 bg-success-500/10 border border-success-500/30 rounded-md px-3 py-2">
                    <div className="flex-1">
                      <p className="text-xs text-success-600">رصيد متاح: {formatMoney(Number(customer.creditBalance))} ج</p>
                      {useCredit && (
                        <input
                          type="number"
                          value={creditAmount}
                          onChange={(e) => setCreditAmount(e.target.value)}
                          placeholder="المبلغ المستخدم..."
                          max={Math.min(Number(customer.creditBalance), total)}
                          min={0}
                          step={0.01}
                          className="mt-1 w-full bg-gray-800 border border-success-500/50 rounded px-2 py-1 text-xs text-gray-100 font-mono focus:outline-none"
                          dir="ltr"
                        />
                      )}
                    </div>
                    <button
                      onClick={() => { setUseCredit(!useCredit); setCreditAmount('') }}
                      className={cn('text-xs px-2 py-1 rounded border transition-all', useCredit ? 'border-success-500 text-success-600 bg-success-500/10' : 'border-gray-600 text-gray-400')}
                    >
                      {useCredit ? 'إلغاء' : 'استخدام'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => setShowCustomerModal(true)}
                className="w-full flex items-center gap-2 text-gray-400 hover:text-brand-400 transition-colors text-sm"
              >
                <UserPlus className="w-4 h-4" />
                إضافة عميل (اختياري)
              </button>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-700 shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setPmSectionOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-750 transition-colors"
            >
              <span className="text-xs uppercase text-gray-400 font-semibold tracking-wide">
                طريقة الدفع
                {selectedPM && <span className="mr-2 text-brand-400 normal-case font-normal">({selectedPM.name})</span>}
              </span>
              <ChevronDown className={cn('w-4 h-4 text-gray-500 transition-transform duration-200', pmSectionOpen && 'rotate-180')} />
            </button>
            {pmSectionOpen && (
              <div className="px-4 pb-4 flex flex-col gap-3 border-t border-gray-700">
                <div className="flex flex-col gap-2 pt-3 max-h-52 overflow-y-auto">
                  {paymentMethods.map((pm) => {
                    const pmFee = calculateFee(subtotal, pm)
                    return (
                      <button
                        key={pm.id}
                        onClick={() => {
                          setSelectedPM(pm)
                          setFeeBearer(pm.feeBearer === 'customer' ? 'customer' : 'merchant')
                        }}
                        className={cn(
                          'flex items-center justify-between rounded-md px-3 py-2 text-sm border transition-all',
                          selectedPM?.id === pm.id
                            ? 'bg-brand-500/12 border-brand-500 text-brand-400'
                            : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500 hover:bg-gray-750',
                        )}
                      >
                        <span>{pm.name}</span>
                        {pmFee > 0 && (
                          <span className="text-xs text-warning-500 num">{formatMoney(pmFee)} رسوم</span>
                        )}
                      </button>
                    )
                  })}
                </div>
                {selectedPM && fee > 0 && selectedPM.feeBearer === 'negotiable' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setFeeBearer('merchant')}
                      className={cn(
                        'flex-1 py-1 rounded text-xs border transition-all',
                        feeBearer === 'merchant'
                          ? 'border-brand-500 text-brand-400 bg-brand-500/10'
                          : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-500',
                      )}
                    >
                      التاجر يتحمل
                    </button>
                    <button
                      onClick={() => setFeeBearer('customer')}
                      className={cn(
                        'flex-1 py-1 rounded text-xs border transition-all',
                        feeBearer === 'customer'
                          ? 'border-warning-500 text-warning-600 bg-warning-500/10'
                          : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-500',
                      )}
                    >
                      العميل يتحمل
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Currency selector — only shown when multiple currencies exist */}
          {currencies.length > 1 && (
            <div className="bg-white rounded-xl border border-gray-700 shadow-sm p-3">
              <p className="text-xs uppercase text-gray-500 font-medium mb-2">العملة</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setSelectedCurrency(null)}
                  className={cn(
                    'px-2.5 py-1 rounded text-xs border transition-all',
                    !selectedCurrency ? 'border-brand-500 text-brand-400 bg-brand-500/12' : 'border-gray-700 text-gray-400 hover:border-gray-500',
                  )}
                >
                  افتراضي
                </button>
                {currencies.filter((c) => !c.isBase).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCurrency(selectedCurrency?.id === c.id ? null : c)}
                    className={cn(
                      'px-2.5 py-1 rounded text-xs border transition-all font-mono',
                      selectedCurrency?.id === c.id ? 'border-brand-500 text-brand-400 bg-brand-500/12' : 'border-gray-700 text-gray-400 hover:border-gray-500',
                    )}
                  >
                    {c.code} ({c.symbol})
                  </button>
                ))}
              </div>
              {selectedCurrency && (
                <p className="text-xs text-gray-500 mt-1.5">
                  سعر الصرف: 1 {selectedCurrency.code} = {formatNumber(Number(selectedCurrency.rateToBase), { maximumFractionDigits: 4 })} (أساسي)
                </p>
              )}
            </div>
          )}

          {/* Split payment */}
          {selectedPM && (
            <div className="bg-white rounded-xl border border-gray-700 shadow-sm overflow-hidden">
              <button
                type="button"
                onClick={() => setSplitSectionOpen((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-750 transition-colors"
              >
                <span className="text-xs uppercase text-gray-400 font-semibold tracking-wide">
                  دفع منقسم
                  {splitPM && <span className="mr-2 text-brand-400 normal-case font-normal">({splitPM.name})</span>}
                  {!splitPM && <span className="mr-2 text-gray-500 normal-case font-normal">(اختياري)</span>}
                </span>
                <ChevronDown className={cn('w-4 h-4 text-gray-500 transition-transform duration-200', splitSectionOpen && 'rotate-180')} />
              </button>
              {splitSectionOpen && (
                <div className="px-4 pb-4 flex flex-col gap-2 border-t border-gray-700/60 pt-3">
                  <div className="flex flex-col gap-1.5 max-h-44 overflow-y-auto">
                    {paymentMethods.filter((pm) => pm.id !== selectedPM.id).map((pm) => (
                      <button
                        key={pm.id}
                        onClick={() => { setSplitPM(splitPM?.id === pm.id ? null : pm); setSplitAmount('') }}
                        className={cn(
                          'flex items-center justify-between rounded-md px-3 py-1.5 text-xs border transition-all',
                          splitPM?.id === pm.id
                            ? 'bg-brand-500/12 border-brand-500 text-brand-400'
                            : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:bg-gray-750',
                        )}
                      >
                        <span>{pm.name}</span>
                      </button>
                    ))}
                  </div>
                  {splitPM && (
                    <div className="flex flex-col gap-1">
                      <input
                        type="number"
                        value={splitAmount}
                        onChange={(e) => setSplitAmount(e.target.value)}
                        placeholder={`مبلغ ${splitPM.name}...`}
                        min={0}
                        max={Math.max(0, total - appliedCredit)}
                        step={0.01}
                        className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-brand-500 font-mono"
                        dir="ltr"
                      />
                      {splitAmountNum > 0 && (
                        <p className="text-xs text-gray-500">
                          {selectedPM.name}: {formatMoney(Math.max(0, total - appliedCredit) - splitAmountNum)} ج
                          {' + '}{splitPM.name}: {formatMoney(splitAmountNum)} ج
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Coupon input */}
          <div className="bg-white rounded-xl border border-gray-700 shadow-sm p-3">
            {appliedCoupon ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4 text-success-600" />
                  <span className="text-sm font-mono text-success-600">{appliedCoupon.code}</span>
                  <span className="text-xs text-success-500">
                    -{appliedCoupon.discountType === 'percentage' ? `${appliedCoupon.discountValue}%` : `${appliedCoupon.discountValue} ج`}
                  </span>
                </div>
                <button onClick={() => setAppliedCoupon(null)} className="text-gray-500 hover:text-danger-500">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && validateCoupon()}
                  placeholder="كود الخصم..."
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-brand-500 font-mono"
                />
                <button
                  onClick={validateCoupon}
                  disabled={!couponInput.trim() || couponLoading}
                  className="px-3 py-1.5 rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm disabled:opacity-40 transition-colors"
                >
                  {couponLoading ? '...' : 'تطبيق'}
                </button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-700 shadow-sm p-4 flex flex-col gap-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">المجموع الفرعي</span>
              <Money value={subtotal} />
            </div>
            {couponDiscount > 0 && (
              <div className="flex justify-between text-sm text-success-600">
                <span>خصم الكوبون ({appliedCoupon?.code})</span>
                <span className="font-mono">-{formatMoney(couponDiscount)} ج</span>
              </div>
            )}
            {fee > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">
                  رسوم {selectedPM?.name}
                  {feeBearer === 'merchant' && (
                    <span className="text-xs text-gray-500 mr-1">(يتحملها التاجر)</span>
                  )}
                </span>
                <span
                  className={cn(
                    'num font-mono',
                    feeBearer === 'customer' ? 'text-warning-500' : 'text-gray-500',
                  )}
                >
                  {formatMoney(fee)} ج
                </span>
              </div>
            )}
            {appliedCredit > 0 && (
              <div className="flex justify-between text-sm text-success-600">
                <span>رصيد العميل المستخدم</span>
                <span className="font-mono">-{formatMoney(appliedCredit)} ج</span>
              </div>
            )}
            <div className="border-t border-gray-700 pt-3 flex justify-between font-semibold">
              <span className="text-gray-200">الإجمالي</span>
              <Money value={Math.max(0, total - appliedCredit)} size="lg" />
            </div>
          </div>

          <Button
            size="lg"
            className="w-full"
            onClick={() => submitSale()}
            loading={isPending}
            disabled={cart.length === 0 || !selectedPM}
          >
            إتمام البيع
            <Kbd className="mr-2">Ctrl ⏎</Kbd>
          </Button>

          <button
            onClick={() => { setShowEOD(true); setActualCash('') }}
            className="w-full flex items-center justify-center gap-2 text-xs text-gray-500 hover:text-gray-300 py-2 border border-gray-700 rounded-md hover:border-gray-600 transition-colors"
          >
            <BookCheck className="w-3.5 h-3.5" />
            إغلاق اليوم
          </button>
        </div>
      </div>

      {/* Customer search modal */}
      <Modal open={showCustomerModal} onClose={() => setShowCustomerModal(false)} title="اختر عميلاً">
        <div className="flex flex-col gap-4">
          <Input
            placeholder="ابحث بالاسم أو الهاتف..."
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            startIcon={<Search className="w-4 h-4" />}
          />
          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
            {customers.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setCustomer(c)
                  setShowCustomerModal(false)
                  setCustomerSearch('')
                }}
                className="text-right px-3 py-2 rounded hover:bg-gray-700 text-sm text-gray-200"
              >
                {c.fullName}
                {c.phone && <span className="text-gray-500 mr-2 num">{c.phone}</span>}
              </button>
            ))}
          </div>
        </div>
      </Modal>

      {/* End-of-day modal */}
      <Modal open={showEOD} onClose={() => setShowEOD(false)} title="إغلاق اليوم — ملخص النقدية">
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-750 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 mb-1">إجمالي المبيعات</p>
              <p className="text-lg font-mono font-bold text-gray-100">{formatNumber(eodDashboard?.revenue ?? 0, { maximumFractionDigits: 0 })} ج</p>
            </div>
            <div className="bg-gray-750 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 mb-1">عدد الفواتير</p>
              <p className="text-lg font-mono font-bold text-gray-100">{eodDashboard?.invoiceCount ?? 0}</p>
            </div>
            <div className="bg-gray-750 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 mb-1">رسوم الدفع</p>
              <p className="text-lg font-mono font-bold text-warning-600">{formatNumber(eodDashboard?.feeExpenses ?? 0, { maximumFractionDigits: 2 })} ج</p>
            </div>
          </div>

          {eodByPM && eodByPM.length > 0 && (
            <div className="bg-gray-750 rounded-lg p-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">تفصيل طرق الدفع</p>
              <div className="flex flex-col gap-1">
                {eodByPM.map((pm) => (
                  <div key={pm.paymentMethodName} className="flex items-center justify-between text-sm py-1 border-b border-gray-700 last:border-0">
                    <span className="text-gray-300">{pm.paymentMethodName}</span>
                    <div className="text-left">
                      <span className="font-mono text-gray-100">{formatNumber(pm.totalRevenue, { maximumFractionDigits: 2 })} ج</span>
                      <span className="text-gray-500 text-xs mr-2">× {pm.invoiceCount}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-gray-750 rounded-lg p-4">
            <label className="block text-xs text-gray-500 uppercase tracking-wide mb-2">جرد الدرج النقدي الفعلي (ج)</label>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={actualCash}
              onChange={(e) => {
                // Clamp to a sensible range so the discrepancy badge doesn't
                // show nonsense when someone fat-fingers an extra zero.
                const v = e.target.value
                if (v === '' || (parseFloat(v) >= 0 && parseFloat(v) < 1_000_000_000)) {
                  setActualCash(v)
                }
              }}
              placeholder="0.00"
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-lg font-mono text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-brand-500 text-left"
              dir="ltr"
            />
            {actualCash !== '' && eodDashboard && (() => {
              const cashPM = eodByPM?.find((pm) => pm.paymentMethodName.toLowerCase().includes('نقد') || pm.paymentMethodName.toLowerCase().includes('cash'))
              const expectedCash = cashPM?.totalRevenue ?? eodDashboard.revenue
              const actual = parseFloat(actualCash) || 0
              const diff = actual - expectedCash
              return (
                <div className={cn('mt-3 flex items-center justify-between text-sm font-semibold rounded-md px-3 py-2', diff === 0 ? 'bg-success-500/10 text-success-600' : diff > 0 ? 'bg-warning-500/10 text-warning-600' : 'bg-danger-500/10 text-danger-600')}>
                  <span>{diff === 0 ? 'مطابق تماماً' : diff > 0 ? 'فائض' : 'عجز'}</span>
                  <span className="font-mono">{diff >= 0 ? '+' : ''}{formatMoney(Math.abs(diff))} ج</span>
                </div>
              )
            })()}
          </div>

          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                const win = window.open('', '_blank', 'width=500,height=600')
                if (!win) return
                const pmRows = (eodByPM ?? []).map((pm) =>
                  `<tr><td>${pm.paymentMethodName}</td><td>${pm.invoiceCount}</td><td>${formatMoney(pm.totalRevenue)} ج</td></tr>`
                ).join('')
                win.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>إغلاق اليوم</title>
                  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600&family=IBM+Plex+Mono:wght@400&display=swap" rel="stylesheet">
                  <style>
                  *{box-sizing:border-box;margin:0;padding:0}body{font-family:'IBM Plex Sans Arabic',Arial,sans-serif;font-size:13px;padding:16px}
                  h2{text-align:center;margin-bottom:12px}table{width:100%;border-collapse:collapse;margin:8px 0}
                  th,td{border:1px solid #ccc;padding:6px 8px;text-align:right}th{background:#f5f5f5}
                  .total{font-weight:bold;font-size:15px}.section{margin-bottom:16px}
                </style></head><body>
                  <h2>ملخص إغلاق يوم ${formatDate(new Date())}</h2>
                  <div class="section"><table><thead><tr><th>البيان</th><th>القيمة</th></tr></thead><tbody>
                    <tr><td>إجمالي المبيعات</td><td class="total">${formatMoney(eodDashboard?.revenue ?? 0)} ج</td></tr>
                    <tr><td>عدد الفواتير</td><td>${eodDashboard?.invoiceCount ?? 0}</td></tr>
                    <tr><td>رسوم الدفع (على التاجر)</td><td>${formatMoney(eodDashboard?.feeExpenses ?? 0)} ج</td></tr>
                    ${actualCash ? `<tr><td>الجرد الفعلي للدرج</td><td>${formatMoney(parseFloat(actualCash))} ج</td></tr>` : ''}
                  </tbody></table></div>
                  ${pmRows ? `<div class="section"><p><strong>تفصيل طرق الدفع:</strong></p><table><thead><tr><th>الطريقة</th><th>العدد</th><th>الإجمالي</th></tr></thead><tbody>${pmRows}</tbody></table></div>` : ''}
                  <div style="margin-top:40px;border-top:1px dashed #999;padding-top:12px;display:flex;justify-content:space-between">
                    <span>توقيع الكاشير: ________________</span>
                    <span>توقيع المدير: ________________</span>
                  </div>
                </body></html>`)
                win.document.close()
                setTimeout(() => { win.print(); win.close() }, 250)
              }}
            >
              <Printer className="w-4 h-4" />
              طباعة الملخص
            </Button>
            <Button className="flex-1" onClick={() => setShowEOD(false)}>تم</Button>
          </div>
        </div>
      </Modal>

      {/* Completion modal */}
      <Modal open={!!completedInvoice} onClose={() => setCompletedInvoice(null)} title="تم إنشاء الفاتورة">
        {completedInvoice && (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-success-500/20 flex items-center justify-center shrink-0">
                <Check className="w-6 h-6 text-success-500" />
              </div>
              <div>
                <p className="font-semibold text-gray-100">{completedInvoice.invoiceNumber}</p>
                <Money value={completedInvoice.totalAmount} size="lg" />
                {completedInvoice.customerName && (
                  <p className="text-xs text-gray-500 mt-0.5">{completedInvoice.customerName}</p>
                )}
              </div>
            </div>

            <div className="bg-gray-800 rounded-md p-3 flex flex-col gap-1 max-h-40 overflow-y-auto">
              {completedInvoice.items.map((item, i) => (
                <div key={i} className="flex justify-between text-sm py-1 border-b border-gray-700 last:border-0">
                  <div>
                    <span className="text-gray-200">{item.productName}</span>
                    <span className="text-gray-500 mr-1 text-xs">× {item.quantity}</span>
                  </div>
                  <span className="font-mono text-gray-300">{formatMoney(item.lineTotal)} ج</span>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between text-gray-400">
                <span>المجموع الفرعي</span><span>{formatMoney(completedInvoice.subtotal)} ج</span>
              </div>
              {completedInvoice.couponDiscount && completedInvoice.couponDiscount > 0 && (
                <div className="flex justify-between text-success-600">
                  <span>خصم ({completedInvoice.couponCode})</span>
                  <span>-{formatMoney(completedInvoice.couponDiscount)} ج</span>
                </div>
              )}
              {completedInvoice.feeAmount > 0 && (
                <div className="flex justify-between text-warning-600">
                  <span>رسوم الدفع (على العميل)</span><span>{formatMoney(completedInvoice.feeAmount)} ج</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-gray-100 border-t border-gray-700 pt-2 mt-1">
                <span>الإجمالي</span><Money value={completedInvoice.totalAmount} />
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => printReceipt(completedInvoice)}>
                <Printer className="w-4 h-4" />
                طباعة الإيصال
              </Button>
              <Button className="flex-1" onClick={() => setCompletedInvoice(null)}>
                بيع جديد
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  )
}
