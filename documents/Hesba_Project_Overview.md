# حِسبة (Hesba) — التوثيق الشامل للمشروع

> **النطاق:** hesbaapp.com · **آخر تحديث:** 2026-10-08
> **المصدر:** الوثيقة دي مكتوبة من الكود الفعلي (مش من الخطط القديمة). أي اختلاف بينها وبين الوثائق القديمة في `documents/Markdown/` موضّح في القسم 14.

---

## 1. الملخص التنفيذي

**حِسبة** نظام **SaaS سحابي متعدد المستأجرين (Multi-tenant)** لإدارة المحلات التجارية والمخازن، معمول للسوق المصري والعربي. واجهته عربي بالكامل (RTL)، وبيشتغل من المتصفح من غير أي تثبيت.

بيغطي دورة البيع كلها: المنتجات والمخزون ← نقطة البيع (POS) ← التقسيط الداخلي ← العملاء والموردين والمشتريات ← المصروفات ← الخدمات وأوامر الشغل ← التقارير والأرباح ← **الفاتورة الإلكترونية لمصلحة الضرائب (ETA)**.

كل محل (Tenant) ليه **PostgreSQL schema معزولة خاصة بيه**، والمنصة نفسها بتتحصّل اشتراكها من المحلات عن طريق **Paymob**.

| البند | القيمة |
|---|---|
| نوع المنتج | B2B SaaS — اشتراك شهري/سنوي |
| السوق | مصر أولاً (EGP، ETA، Paymob، فاليو، فلوسة، InstaPay) |
| اللغة | عربي (RTL)، كل الأرقام بالأرقام اللاتينية (`ar-EG-u-nu-latn`) |
| بداية التطوير | 2026-05-10 |
| حجم العمل | ~205 commit، 31 Pull Request |
| حجم الكود | API ≈ 14,600 سطر TS · Web ≈ 19,600 سطر TSX · ~890 سطر SQL migrations |
| الاختبارات | 61 unit test (Vitest) |

---

## 2. المشكلة والحل (Business)

### المشكلة
- أغلب المحلات شغالة بـ Excel أو دفاتر ورق.
- مفيش متابعة لحظية للمبيعات والأرباح الحقيقية.
- التقسيط الداخلي بيتدار يدوي ومن غير ضوابط (موافقة، جدول أقساط، تذكير).
- رسوم طرق الدفع (فيزا، فلوسة، فاليو...) بتاكل من الربح من غير ما تتسجّل ← "خسائر صامتة".
- إلزام الفاتورة الإلكترونية من مصلحة الضرائب (ETA) صعب على المحلات الصغيرة.
- متابعة أكتر من فرع من مكان واحد صعبة، والأنظمة الموجودة غالية أو مش مناسبة للسوق المحلي.

### الحل — حِسبة
- نظام سحابي بالعربي، شغال من أي متصفح.
- POS سريع بيدعم الباركود، الدفع المقسّم (Split payment)، الكوبونات، نقاط الولاء، رصيد العميل.
- تقسيط داخلي كامل: عقد ← موافقة مدير ← جدول أقساط ← تحصيل ← تذكير بالإيميل تلقائي.
- حساب رسوم كل طريقة دفع وتسجيلها تلقائياً كمصروف لو المحل هو اللي بيتحملها.
- ربط مباشر بمنظومة الفاتورة الإلكترونية (ETA) مع توقيع رقمي وإعادة محاولة تلقائية.
- تقارير لحظية: لوحة تحكم، مبيعات، أرباح وخسائر، رسوم، تقفيل يومية، تصدير Excel.

### السوق المستهدف
| الشريحة | الحجم | الأولوية |
|---|---|---|
| محلات تجزئة (ملابس، إلكترونيات، أحذية، موبايلات) | 1–5 فروع | عالية |
| سوبرماركت وبقالة | 1–3 فروع | عالية |
| سلاسل متعددة الفروع | 5–50 فرع | عالية |
| صيدليات | 1–10 فروع | متوسطة |
| مراكز صيانة وخدمات (ورش، صيانة أجهزة، مواعيد) | — | عبر وحدة الخدمات (Enterprise) |

تقديرات السوق (من وثيقة البزنس): أكتر من 3 مليون محل مسجّل في مصر، أقل من 15% بيستخدموا نظام رقمي متكامل، والسوق المتاح المباشر حوالي 200,000 محل.

---

## 3. نموذج الإيراد والباقات

### 3.1 الباقات (من `packages/database/src/seeds/master.seed.ts`)

| | **Starter** | **Professional** | **Enterprise** |
|---|---|---|---|
| السعر الشهري | 199 ج.م | 499 ج.م | 999 ج.م |
| السعر السنوي | 1,990 ج.م | 4,990 ج.م | 9,990 ج.م |
| الوصف | للمتاجر الصغيرة | للمتاجر المتوسطة والنامية | للمتاجر الكبيرة — بلا حدود |
| المنتجات | 100 | 1,000 | غير محدود |
| الفواتير / شهر | 300 | 3,000 | غير محدود |
| المستخدمين | 3 | 10 (عمود `maxUsers`) | غير محدود |
| الفروع | 1 | 5 | غير محدود |
| مساحة التخزين | 512 MB | 5 GB | 100 GB |
| عقود التقسيط / شهر | 15 | 100 | غير محدود |
| تعدد العملات | ✗ | ✓ | ✓ |
| الموردين والمشتريات | ✗ | ✓ | ✓ |
| المصروفات | ✗ | ✓ | ✓ |
| التقارير المتقدمة | ✗ | ✓ | ✓ |
| الخدمات وأوامر الشغل | ✗ | ✗ | ✓ |
| API access | ✗ | ✗ | ✓ |
| الأوف لاين | ✗ | ✗ | ✓ (لسه مش متنفذ — شوف القسم 13) |

- **السنوي = 10 أضعاف الشهري** (يعني شهرين مجاناً).
- **فترة تجريبية 14 يوم** من غير كارت، بتبدأ تلقائياً مع التسجيل (`TRIALING`).
- التقسيط متاح في **كل الباقات** لكن بحد شهري، عشان يبقى حافز للترقية بدل ما يبقى قفل كامل.
- القيمة `-1` في `max_branches` أو `999999` في الأعمدة = غير محدود. القيمة `0` في حدود الكمية = من غير حد (توافق قديم).

### 3.2 فرض الحدود (Enforcement)
- **الميزات (Capability):** `requireFeature(feature)` في الـ API و`<FeatureGate>` في الواجهة ← `403 feature_not_available`.
- **الكميات (Quantity):** `requireUnderLimit('products' | 'users' | 'invoices' | 'branches')` بيعدّ من الداتابيز في كل طلب ← `402 plan_limit_reached`. الفواتير بتتحسب على الشهر الحالي بس.
- **حالة الاشتراك:** لو `SUSPENDED` أو `CANCELLED` كل المسارات بترجع `402 subscription_inactive` ماعدا `/api/auth/*` و `/api/billing/*` (عشان صاحب المحل يقدر يدخل ويدفع).

### 3.3 دورة حياة الاشتراك (Paymob)
```
التسجيل → TRIALING (14 يوم)
   │  تذكير بالإيميل قبل الانتهاء بـ 3 أيام ثم بيوم (trial-expiry job)
   ▼
الدفع عبر Paymob iframe → Webhook (HMAC) → ACTIVE
   │  تجديد تلقائي (renewal job)
   ▼
فشل الدفع: عدد المحاولات الفاشلة
   3  → PAST_DUE
   7  → SUSPENDED   (النظام يقفل ماعدا الدفع)
   14 → CANCELLED
```
- الـ dunning بيعيد المحاولة كل **3 أيام** على الأقل.
- الإلغاء الافتراضي **في نهاية الفترة** (`cancelAtPeriodEnd`)، وفيه استئناف (`/billing/resume`).
- كل محاولة دفع بتتسجّل في `payment_attempts`، والـ webhook **idempotent** (unique على `providerTransactionId`).

---

## 4. وحدات المنتج (Product Modules)

| الوحدة | أهم الإمكانيات |
|---|---|
| **المنتجات** | تصنيفات، متغيّرات (Variants: مقاس/لون…) بـ SKU وباركود، صور (Cloudflare R2)، نسب ضريبة، خصومات منتج بمدة، استيراد Excel، بحث بالباركود |
| **المخزون** | رصيد لكل متغيّر لكل فرع، تسوية (Adjust)، حد أدنى وتنبيه نفاد، سجل حركة كامل، تحويل بين الفروع بموافقة |
| **نقطة البيع (POS)** | بحث/باركود، اختصارات كيبورد، كاش/كارت/محافظ/BNPL، **دفع مقسّم على طريقتين**، كوبونات، نقاط ولاء، رصيد العميل، حساب رسوم الدفع، طباعة إيصال، إرسال الإيصال بالإيميل |
| **تقفيل اليومية (Day Close)** | ملخص اليوم حسب طريقة الدفع والكاشير |
| **الفواتير والمرتجعات** | قائمة/تفاصيل، مرتجع جزئي أو كلي مع إرجاع للمخزون، إلغاء فاتورة، ترقيم تسلسلي `INV-YYYYMMDD-000001` |
| **التقسيط الداخلي** | عقد بمقدّم وعدد أقساط وفائدة وضامن وتوقيع، موافقة/رفض المدير، جدول أقساط، تسجيل التحصيل، تذكير تلقائي بالإيميل، تثبيت سعر الصرف |
| **التمويل الخارجي** | فاليو/Sympl: البيع يتسجّل فوري + شركة التمويل + رقم مرجعي + نسبة العمولة |
| **العملاء** | بيانات كاملة، مستندات (بطاقة…) بروابط تحميل موقّعة، رصيد دائن (Credit) بسجل حركة، كشف حساب، نقاط ولاء، استيراد Excel |
| **الموردين** | بيانات، حركات (مديونية/سداد)، كشف حساب |
| **أوامر الشراء (PO)** | مسودة ← إرسال ← اعتماد ← استلام جزئي/كامل ← سداد. الاستلام بيحدّث المخزون و**متوسط التكلفة المرجّح** |
| **المصروفات** | تصنيفات، اعتماد/رفض، ميزانيات شهرية لكل تصنيف، قوالب مصروفات متكررة |
| **الخدمات وأوامر الشغل** | كتالوج خدمات، تذكرة شغل (جهاز/عربية/موعد/أخرى)، مراحل: `received → scheduled → diagnosed → quoted → approved → in_progress → ready → delivered / cancelled` مع سجل للحالات، تحويل لفاتورة |
| **الكوبونات** | نسبة/مبلغ، حد استخدام، تاريخ صلاحية، تحقق لحظي |
| **طرق الدفع والرسوم** | لكل محل طرقه الخاصة: نوع الرسوم (`none/percentage/fixed/both`) ومين بيتحملها (`customer/merchant/negotiable`) |
| **التقارير** | Dashboard، المبيعات، المخزون، التقسيط، الرسوم، الأكثر مبيعاً، الأرباح والخسائر، المرتجعات، تقفيل اليومية — تصدير Excel |
| **الفاتورة الإلكترونية (ETA)** | إعداد بيانات المُصدِر، حفظ الـ credentials مشفّرة، اختبار الاتصال، إرسال تلقائي في الخلفية، QR، إعادة إرسال، سجل المحاولات |
| **المستخدمين والأدوار** | 5 أدوار نظام + أدوار مخصصة، صلاحيات دقيقة، سجل تدقيق (Audit log) |
| **الإعدادات** | الضريبة، المنطقة الزمنية، العملة، الولاء، قالب الطباعة، هدف المبيعات اليومي، الفروع، الاشتراك والفوترة |
| **لوحة مالك المنصة (/admin)** | المحلات (تعليق/تغيير باقة)، الباقات، الاشتراكات (مد التجربة/إلغاء/إعادة تفعيل)، الإيرادات، المسؤولين، سجل التدقيق، تشغيل الـ migrations |

---

## 5. الأدوار والصلاحيات

الصلاحيات مخزّنة JSON بشكل `{ resource: [actions] }` جوه كل دور، وبتتحط في الـ JWT. الـ `super_admin` بيعدّي أي فحص.

| المورد | Super Admin | Branch Manager | Cashier | Inventory Keeper | Accountant |
|---|---|---|---|---|---|
| invoices | CRUD + refund | create/read/update/refund | create/read | — | read |
| products | CRUD | read/update | read | read/update | — |
| stock | read/adjust/transfer | read/adjust/transfer | read | read/adjust/transfer | — |
| customers | CRUD | create/read/update | create/read/update | — | — |
| installments | + approve/reject | create/read/update/approve | read | — | read |
| suppliers | CRUD | read | — | read | read |
| purchase_orders | + approve/receive | create/read/update/receive | — | read/receive | read |
| expenses | + approve/delete | create/read/update/approve | — | — | create/read/update |
| services / work_orders | CRUD | read/update · create/read/update | read · create/read/update | — | — |
| reports | read/export | read/export | read | read | read/export |
| users | CRUD | read | — | — | — |
| settings | read/update | read | — | — | — |
| billing | read/update | — | — | — | read |

**قاعدة "مينفعش تدّي اللي مش معاك" (SEC-02):** أي مستخدم يقدر ينشئ/يعدّل/يسند دور بس لو صلاحياته جزء من صلاحيات المستخدم نفسه ← غير كده `403 permission_escalation`.

على مستوى المنصة فيه دورين منفصلين: `OWNER` (بيدير المسؤولين، واحد بس، بيتعمله seed من env) و`ADMIN`.

---

## 6. منطق البزنس والحسابات (Business Logic)

كل الفلوس بتتحسب بـ **`decimal.js`** وبتتخزن `NUMERIC(15,4)` — مفيش floating point في أي حساب مالي.

### 6.1 إنشاء فاتورة (POS) — بالترتيب
1. التحقق من طريقة الدفع والعملة والكوبون.
2. تحميل المتغيّرات والضرائب وخصومات المنتجات (استعلام واحد، بدون N+1).
3. الإجمالي = المجموع − خصم المنتج − الكوبون (بحد أقصى المجموع) + الضريبة.
4. خصم رصيد العميل (Credit) ثم **نقاط الولاء**.
5. حساب رسوم طريقة الدفع.
6. **Transaction ذرّية:** خصم المخزون بشرط (race-safe)، زيادة استخدام الكوبون بـ UPDATE مشروط، خصم النقاط بشرط، تسجيل مصروف الرسوم لو على المحل، تسجيل التمويل الخارجي، رقم فاتورة من `sequence`، منح نقاط الولاء، حفظ `cost_at_sale` لكل بند.
7. لو ETA مفعّل ← الفاتورة تدخل طابور الإرسال في الخلفية.

### 6.2 رسوم الدفع
| النوع | المعادلة |
|---|---|
| `none` | 0 |
| `percentage` | الإجمالي × النسبة ÷ 100 |
| `fixed` | المبلغ الثابت |
| `both` | (الإجمالي × النسبة ÷ 100) + الثابت |

لو `feeBearer = customer` الرسوم بتتضاف على الإجمالي. لو `merchant` بتتسجّل في `payment_fee_expenses` وبتنزل من الربح.

**طرق الدفع الافتراضية لكل محل جديد:** نقدي (0) · فيزا/ماستر (1.75%) · فلوسة (2 ج ثابت) · InstaPay (0) · فاليو (3%) · تحويل بنكي (5 ج ثابت).

### 6.3 نقاط الولاء
- أقل استبدال **100 نقطة**.
- أقصى خصم بالنقاط **50% من الفاتورة**، ومش أكتر من المتبقي.
- لو الحد اتطبّق بيتخصم بس عدد النقاط اللي قيمتها اتستخدمت فعلاً (تقريب لتحت).
- قيمة النقطة ونقاط لكل وحدة عملة بيتظبطوا من الإعدادات.

### 6.4 التقسيط الداخلي
```
الأصل (Principal)   = الإجمالي − المقدّم
الفائدة              = الأصل × نسبة الفائدة ÷ 100       (فائدة ثابتة Flat على العقد كله)
القسط الشهري         = (الأصل + الفائدة) ÷ عدد الأقساط   (مقرّب)
إجمالي العقد         = المقدّم + الأصل + الفائدة
```
- **القسط الأخير بيمتص فرق التقريب** عشان مجموع الأقساط + المقدّم = إجمالي العقد بالظبط.
- المقدّم مينفعش يزيد عن الإجمالي.
- دورة الحالة: `pending_approval` ← (المدير يوافق) الفاتورة تبقى `completed` ويتولد جدول الأقساط ← أو `rejected`.
- سعر الصرف بيتثبّت وقت العقد (`exchangeRateAtContract`).
- عدد العقود الشهرية محكوم بالباقة.

### 6.5 تكلفة المخزون (COGS)
- عند استلام أمر شراء: **متوسط مرجّح متحرك**
  `التكلفة الجديدة = (الكمية الحالية × التكلفة الحالية + الكمية المستلمة × تكلفة الشراء) ÷ الكمية الكلية`
- تكلفة كل بند بتتجمّد وقت البيع (`cost_at_sale`) عشان تقرير الأرباح ميتغيرش لو السعر اتعدّل بعدين.

### 6.6 المرتجعات والإلغاء
- مرتجع تراكمي بحد أقصى الكمية المباعة لكل متغيّر.
- فاتورة عليها مرتجع مينفعش تتلغي، والإلغاء بيرجّع استخدام الكوبون.

---

## 7. المعمارية التقنية (Architecture)

### 7.1 الصورة العامة
```
                ┌──────────────────────────────┐
  المتصفح ─────►│ Caddy (TLS + wildcard)       │  hesbaapp.com, *.hesbaapp.com
                └──────────────┬───────────────┘
                               ▼
                ┌──────────────────────────────┐
                │ Node 20 — Fastify API :3000  │  ← بيخدم الـ React build كـ static كمان
                │  • REST /api/*               │
                │  • BullMQ workers (5)        │
                └───────┬──────────────┬───────┘
                        ▼              ▼
          ┌────────────────────┐  ┌──────────┐      خدمات خارجية:
          │ PostgreSQL 16       │  │ Redis 7  │      • Paymob (اشتراكات)
          │  public = master    │  │ cache,   │      • ETA (الفاتورة الإلكترونية)
          │  tenant_<sub> × N   │  │ sessions,│      • Cloudflare R2 (ملفات)
          └────────────────────┘  │ queues   │      • Resend (إيميل)
                                  └──────────┘      • Google Analytics، Sentry (اختياري)
```

### 7.2 Monorepo (pnpm workspaces)
```
apps/
  api/        @hesba/api       Fastify + TypeScript
  web/        @hesba/web       React + Vite
packages/
  database/   @hesba/database  Prisma (schema للـ master + schema للـ tenant) + SQL migrations
  shared/     @hesba/shared    (غير مستخدم حالياً)
documents/    وثائق البزنس والتصميم
Dockerfile · docker-compose.yml (dev) · docker-compose.prod.yml · Caddyfile · railway.json
.github/workflows/ci.yml
```

### 7.3 الـ Stack

| الطبقة | التقنية |
|---|---|
| Runtime | Node.js 20 (CI على 22)، pnpm 10.33 |
| Backend | Fastify 4، TypeScript 5، Zod، fastify-plugin |
| أمان HTTP | @fastify/helmet (CSP مفعّل)، @fastify/cors، @fastify/rate-limit (Redis)، @fastify/jwt، @fastify/cookie |
| ORM / DB | Prisma 5 (عميلين: master و tenant)، PostgreSQL 16 |
| Cache / Queue | Redis 7 + ioredis، BullMQ 5 |
| حسابات مالية | decimal.js |
| ملفات | Cloudflare R2 عبر AWS SDK v3 (S3) + Presigned URLs |
| إيميل | Resend |
| Excel | exceljs (API)، xlsx (Web) |
| Frontend | React 18، Vite 5، React Router 6، TailwindCSS 3 |
| State | TanStack Query 5 (server state)، Zustand 5 (auth) |
| Forms | react-hook-form + zod |
| UI | lucide-react، recharts، react-day-picker، react-hot-toast، react-hotkeys-hook |
| Tests | Vitest (+ coverage-v8) |
| Lint | ESLint 8 + typescript-eslint + jsx-a11y + react-hooks |
| Infra | Docker multi-stage، tini، Caddy 2 (on-demand TLS)، GitHub Actions |
| Monitoring | Pino logs (مع إخفاء الـ credentials)، Sentry اختياري (`SENTRY_DSN`)، `/health` |

### 7.4 تعدد المستأجرين (Multi-tenancy) — Schema-per-tenant
- **داتابيز واحدة**: الـ `public` schema فيها جداول المنصة (master)، وكل محل ليه schema اسمها `tenant_<subdomain>` (الشرطة بتتحول `_`).
- **تحديد المحل:** من الـ subdomain (`store1.hesbaapp.com`) أو من header اسمه `X-Tenant-Subdomain` (على الدومين الرئيسي وفي الـ dev).
- بيانات المحل بتتخزن مؤقتاً في Redis لمدة **5 دقايق**، وحالة الاشتراك **30 ثانية**.
- **Pool لعملاء Prisma:** LRU بحد 50 محل، 5 connections لكل محل، تنتهي بعد 30 دقيقة خمول. (بعد ~15 محل نشط في نفس الوقت محتاجين PgBouncer.)
- **ربط التوكن بالمحل (HESBA-SEC-01):** `tenantId` و`schemaName` اللي في الـ JWT لازم يطابقوا المحل اللي اتحدد من الطلب ← غير كده `403 tenant_mismatch`.

### 7.5 تسجيل محل جديد (Provisioning)
`POST /api/tenants/register`:
1. التأكد إن الـ subdomain متاح.
2. إنشاء سجل `tenants` بحالة `PROVISIONING`.
3. إنشاء الـ schema وتشغيل كل الـ SQL migrations بتاعة المحل.
4. Seed: 5 أدوار، "الفرع الرئيسي"، المستخدم المالك (super_admin)، عملة EGP، ضرائب (معفى / 14%)، 6 تصنيفات مصروفات، 6 طرق دفع، إعدادات (`ar`، `Africa/Cairo`، ETA مفعّل).
5. بدء فترة تجريبية 14 يوم ← الحالة `ACTIVE`.
6. لو حصل خطأ ← rollback وحذف السجل.

### 7.6 الـ Migrations
- **Master:** Prisma Migrate (8 migrations) — بتتطبّق مع كل تشغيل (`prisma migrate deploy`).
- **Tenant:** ملفات SQL مرقّمة في `packages/database/migrations/tenant/` (17 ملف: `001_init` … `017_cost_at_sale`). كل محل عنده `schemaVersion` في الـ master.
  - بتشتغل تلقائياً في الخلفية مع كل boot، وكمان من زرار في لوحة الأدمن.
  - كل ملف في **transaction واحدة**، تحت **advisory lock** عشان مايشتغلوش مرتين في نفس الوقت.
  - النتيجة بتظهر في `/health` (ولو كله فشل ← `503`).
- فيه **اختبار تطابق** بين جداول SQL وموديلات Prisma بيشتغل في الـ CI.

### 7.7 نموذج البيانات
**Master (6 موديلات):** `Plan` · `Tenant` · `Subscription` · `PaymentAttempt` · `PlatformAdmin` · `PlatformAuditLog`

**Tenant (46 موديل) مقسّمة:**
| المجموعة | الجداول |
|---|---|
| المستخدمين والإعدادات | branches, roles, users, password_reset_tokens, tenant_settings, audit_logs |
| المنتجات والمخزون | categories, tax_rates, products, product_variants, stock, stock_movements, stock_transfers, stock_transfer_items, product_discounts |
| المبيعات | customers, customer_documents, coupons, invoices, invoice_items, payment_methods, payment_fee_expenses, returns, return_items, currencies |
| التقسيط | installment_contracts, installment_payments, external_financing |
| المشتريات | suppliers, supplier_transactions, purchase_orders, purchase_order_items, purchase_receipts, purchase_payments |
| المصروفات | expense_categories, expense_budgets, expense_templates, expenses |
| الخدمات | service_categories, services, work_orders, work_order_services, work_order_status_history |
| النظام | eta_submissions, offline_queue, print_templates |

مفاتيح الـ tenant من نوع UUID (`gen_random_uuid()`)، ومفاتيح الـ master من نوع cuid. فيه CHECK constraints تمنع القيم السالبة (أسعار، مخزون، مبالغ).

### 7.8 الـ API
- **حوالي 180 endpoint**، كلها تحت `/api`، وشكل الرد موحّد: `{ success, data }` أو `{ success: false, error: { code, message } }` (الرسائل بالعربي).
- مقسّمة في `apps/api/src/modules/`:
  `auth` · `tenants` · `products` · `stock` · `payment-methods` · `customers` · `invoices` · `installments` · `suppliers` · `purchase-orders` · `expenses` · `services` (+ work orders) · `coupons` · `reports` · `eta` · `billing` · `admin`
- مسارات عامة: `/health`، `/api/plans`، `/api/tenants/register`، `/api/billing/paymob/webhook`، `/internal/check-tenant` (لـ Caddy).
- الـ preHandlers: `authenticate` ← `requirePermission(resource, action)` ← `requireFeature(...)` ← `requireUnderLimit(...)`.
- في الـ production أي خطأ 5xx بيرجع رسالة عامة من غير stack trace.

### 7.9 الـ Background Jobs (BullMQ)
| الـ Job | التوقيت | الوظيفة |
|---|---|---|
| trial-expiry | يومياً 06:00 | تذكير قبل انتهاء التجربة (3 أيام / يوم) + إنهاء التجارب + تنفيذ الإلغاءات المجدولة |
| renewal | يومياً 07:00 | تجديد الاشتراكات المستحقة |
| dunning | يومياً 08:00 | إعادة محاولة الدفع الفاشل (فاصل 3 أيام على الأقل) |
| installment-reminders | يومياً 09:00 | إيميل للعملاء بالأقساط القريبة والمتأخرة (idempotent عن طريق الـ audit log) |
| eta-submissions | فوري (Queue) | إرسال الفاتورة لـ ETA — 5 محاولات بفواصل 30ث، 2د، 10د، 1س، 6س |

كل الـ workers بيقفلوا بشكل نظيف مع `SIGTERM` (مهلة 25 ثانية).

### 7.10 الفاتورة الإلكترونية (ETA)
- إعدادات المُصدِر (الرقم الضريبي، كود النشاط، كود الفرع، الاسم، العنوان) لازم تطابق التسجيل على `invoicing.eta.gov.eg`.
- `clientId` و`clientSecret` وشهادة التوقيع **مشفّرين AES-256-GCM** بمفتاح `APP_ENCRYPTION_KEY`، write-only، ومش بيرجعوا للواجهة أبداً.
- بيئتين: preprod و production. وفيه اختبار اتصال OAuth قبل أول فاتورة.
- الخطوات: بناء الـ payload ← canonical serialization ← hash ← توقيع PEM ← إرسال ← تخزين `etaUuid` / `etaLongId` / QR / الحالة.
- كل محاولة بتتسجّل في `eta_submissions`، وفيه إعادة إرسال يدوية.

### 7.11 الواجهة (Frontend)
- SPA بـ React، و`AppShell` فيه Sidebar و TopBar وبانرات الاشتراك والاستخدام.
- **الحماية:** `AuthGuard` و `RoleGuard(resource, action)` و `FeatureGate(feature)`، ولوحة الأدمن ليها guards منفصلة.
- **الصفحات:** Landing، التسجيل/الدخول/نسيت كلمة السر، Onboarding، Dashboard، POS، تقفيل اليومية، المنتجات، المخزون، العملاء، الفواتير، المرتجعات، التقسيط، الموردين، أوامر الشراء، المصروفات، الخدمات، أوامر الشغل، التقارير، الإعدادات، و 8 صفحات للوحة الأدمن.
- **HTTP:** axios مع `withCredentials`، بيضيف `X-Tenant-Subdomain`، ولو جه 401 بيعمل refresh تلقائي بطابور (والطلبات المعلّقة بترفض لو الـ refresh فشل).
- **التصميم:** ثيم فاتح، أخضر أساسي `#1FA971`، لون مميز كهرماني `#FFC53D`، خط **Cairo** (و IBM Plex Sans Arabic كبديل)، tokens في Tailwind، ومكتبة مكوّنات داخلية (Button, Modal, Drawer, Table, Money, DateRangePicker…).
- طباعة A4/A5/إيصال حراري عن طريق `lib/print.ts` (كل القيم بتتعمل لها escape ضد XSS)، وتصدير Excel، و Google Analytics 4 اختياري (`VITE_GA_MEASUREMENT_ID`).

---

## 8. الأمان (Security)

| المجال | التنفيذ |
|---|---|
| كلمات المرور | bcrypt بـ cost 12، وأقل طول 12 حرف (للتسجيل والتغيير والاستعادة) |
| Access token | JWT صالح 15 دقيقة، **في الذاكرة بس** في الواجهة (مش في localStorage) |
| Refresh token | 32 byte عشوائي (opaque) متخزن في Redis لمدة 7 أيام، في cookie `HttpOnly` + `SameSite=Lax` مشتركة بين الـ subdomains، وبيتغيّر مع كل refresh، وبيتلغي فعلياً عند الخروج |
| استعادة كلمة السر | توكن متخزن sha256، يستخدم مرة واحدة، بمدة صلاحية، وبيلغي كل الجلسات. ومحمي بـ rate limit |
| عزل المحلات | schema لكل محل + ربط التوكن بالمحل (SEC-01) |
| تصعيد الصلاحيات | فحص إن الصلاحيات جزء من صلاحيات المستخدم (SEC-02) |
| أسرار ETA | AES-256-GCM |
| Webhook الدفع | تحقق HMAC + idempotency |
| HTTP | Helmet + CSP (`script-src 'self'` + GA)، CORS مقصور على الدومين ونطاقاته، rate limit على مسارات الـ auth |
| Logs | إخفاء `authorization` و `cookie` و `set-cookie` |
| المدخلات | Zod على كل طلب، والإيميلات بتتحول lowercase |
| الحاوية | مستخدم غير root، tini، و image الـ production فيها dependencies الـ prod بس |
| التدقيق | `audit_logs` لكل محل + `platform_audit_logs` للمنصة |

تم عمل مراجعة أمنية وفنية من 7 مراحل (يونيو 2026) وجولة إصلاحات تانية (سبتمبر 2026)، ومفيش ثغرات حرجة أو عالية مفتوحة حالياً.

---

## 9. البنية التحتية والنشر (DevOps)

### 9.1 Production
- **Image واحدة** (Dockerfile multi-stage على `node:20-alpine`): بتبني الواجهة والـ API، والـ API بيخدم `apps/web/dist`.
- خطوات التشغيل: `prisma migrate deploy` ← seed الباقات (idempotent) ← `node dist/index.js` ← migrations المحلات في الخلفية.
- `docker-compose.prod.yml`: ‏`postgres:16-alpine` + `redis:7-alpine` (بكلمة سر) + `app` + `caddy:2-alpine` (80/443). البورتات الداخلية على شبكة `internal` بس.
- **Caddy:** شهادة لـ `hesbaapp.com`، تحويل `www` للدومين الرئيسي، و `*.hesbaapp.com` بـ **on-demand TLS** بيسأل `/internal/check-tenant`.
- السيرفر الحالي VPS (والداتابيز متاحة على `127.0.0.1` بس — الوصول ليها عن طريق SSH tunnel). وفيه كمان `railway.json` كخيار نشر بديل (healthcheck `/health`).

### 9.2 CI (GitHub Actions)
عند push على `main` و `claude/*` وعند فتح PR على `main`: **Type-check** (API + Web) · **Lint** (لازم ينجح) · **Test** (Vitest) · **Build** — على Node 22.

### 9.3 التشغيل المحلي
```bash
docker compose up -d
```
```bash
pnpm db:generate && pnpm db:migrate && pnpm db:seed
```
```bash
pnpm dev:api
```
```bash
pnpm dev:web
```
الـ API على `:3000` والواجهة على `:5173` (Vite بيعمل proxy لـ `/api`).

### 9.4 متغيرات البيئة
| المجموعة | المتغيرات |
|---|---|
| Database / Cache | `DATABASE_MASTER_URL`, `REDIS_URL` |
| Auth | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN` (15m), `JWT_REFRESH_EXPIRES_IN` (7d) |
| App | `NODE_ENV`, `API_PORT`/`PORT`, `API_HOST`, `FRONTEND_URL`, `APP_BASE_DOMAIN` |
| Storage | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` |
| Paymob | `PAYMOB_API_KEY`, `PAYMOB_HMAC_SECRET`, `PAYMOB_INTEGRATION_ID_CARD`, `PAYMOB_INTEGRATION_ID_WALLET`, `PAYMOB_IFRAME_ID`, `PAYMOB_BASE_URL` |
| ETA | `ETA_PREPROD_BASE_URL`, `ETA_PROD_BASE_URL`, `APP_ENCRYPTION_KEY` |
| Platform owner | `OWNER_EMAIL`, `OWNER_PASSWORD`, `OWNER_NAME` |
| اختياري | `SENTRY_DSN`, `VITE_GA_MEASUREMENT_ID` |

---

## 10. الجودة والاختبارات
- **61 unit test** بتغطي: حسابات الأقساط، الرسوم، الولاء، متوسط التكلفة، Decimal، التشفير، الصلاحيات (SEC-02)، ربط التوكن بالمحل (SEC-01)، Paymob webhook، وتطابق schema الـ SQL مع Prisma.
- ESLint بيشتغل في الـ CI ولازم ينجح. فيه 55 تحذير (a11y/style) متبقيين — مفيش أخطاء.

---

## 11. مسار التطوير (Timeline)
| الفترة | الإنجاز |
|---|---|
| مايو 2026 | هيكل الـ monorepo، master schema، provisioning، الـ auth، الـ tenant schema، الـ APIs الأساسية، الواجهة، Paymob، ETA، لوحة الأدمن |
| يونيو 2026 | مراجعة من 7 مراحل + إصلاحات أمنية (SEC-01/02، rate limits، non-root، الـ migrations الذرّية، CHECK constraints) |
| سبتمبر 2026 | إصلاحات محاسبية (المرتجعات، `cost_at_sale`، متوسط التكلفة، الولاء)، تفعيل CSP، سياسة كلمات السر، **تحديث الهوية البصرية** (فاتح/أخضر/Cairo)، إعادة تسمية Storify ← حِسبة، تحسينات الـ POS (الدفع المقسّم، اللوحة الثابتة) |

---

## 12. خارطة الطريق (Roadmap)
| المرحلة | المحتوى | الحالة |
|---|---|---|
| 1 — الأساس | Multi-tenant، Auth، POS، التقسيط، العملاء | ✅ |
| 2 — التطوير | الموردين، المصروفات، تعدد العملات، تقارير متقدمة، ETA، الخدمات | ✅ أغلبها |
| 3 — التوسع | أوف لاين (PWA)، تطبيق موبايل، ميزات AI، Public API | ⏳ |

---

## 13. قيود معروفة وأعمال مؤجلة
- **الأوف لاين** معلن في Enterprise بس **مش متنفذ** (جدول `offline_queue` موجود بس).
- **API access** معلن في Enterprise ومفيش Public API.
- **عدم تطابق في Professional:** عمود `maxUsers = 10` (وده اللي بيتطبّق فعلاً) لكن `features.max_users = 15`. لازم نوحّدهم.
- **ETA-01 (PR #2 مفتوح):** توافق الخصومات في payload الـ ETA — محتاج يتجرب على preprod قبل الدمج.
- مؤجّل معمارياً: دفتر أستاذ عام (GL)، الاعتراف بإيراد فوائد التقسيط، read replica، pipeline تحليلات من السيرفر، تقسيم المكوّنات الكبيرة (مثلاً `Settings.tsx` حوالي 2,600 سطر)، integration tests.
- تشغيلي: PgBouncer لما المحلات تزيد، جعل R2 bucket خاص، Sentry محتاج `@sentry/node` + DSN.
- الـ subdomains لكل محل لسه مش متفعّلة في الـ DNS عملياً — المحل بيتحدد بالـ header من الدومين الرئيسي.
- الحزمة `@hesba/shared` غير مستخدمة.

---

## 14. اختلافات عن الوثائق القديمة (`documents/Markdown/`)
| الوثيقة القديمة بتقول | الكود الفعلي |
|---|---|
| تشفير كلمات السر SHA-256 + salt | **bcrypt cost 12** |
| الواجهة على Vercel، Redis على Upstash، الـ API على Railway | **Image واحدة** فيها API + الواجهة، و Postgres/Redis self-hosted، و Caddy على VPS (Railway خيار بديل) |
| التقسيط مش متاح في Starter | **متاح في كل الباقات** بحد شهري (15 / 100 / غير محدود) |
| Professional = 15 مستخدم | الحد المطبّق **10** (شوف القسم 13) |
| Tenant schema حوالي 25 جدول | **46 جدول** |
| WebSockets | مش مستخدمة |
| مفيش ETA ولا Paymob ولا خدمات ولا ولاء | **كلهم متنفذين** |

---

*حِسبة — وثيقة نظرة عامة على المشروع · © 2026*
