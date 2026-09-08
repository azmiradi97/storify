import { masterDb } from '../../config/database'
import { getTenantDb } from '../../config/database'
import { runTenantMigrations } from '@hesba/database'
import { hashPassword } from '../../shared/utils/password'
import { startTrial } from '../billing/billing.service'
import type { RegisterTenantInput } from './tenant.schema'

// ─── System roles ─────────────────────────────────────────────────────────────

const SYSTEM_ROLES: Array<{ slug: string; name: string; permissions: Record<string, string[]> }> = [
  {
    slug: 'super_admin',
    name: 'Super Admin',
    permissions: {
      invoices: ['create', 'read', 'update', 'delete', 'refund'],
      products: ['create', 'read', 'update', 'delete'],
      stock: ['read', 'adjust', 'transfer'],
      customers: ['create', 'read', 'update', 'delete'],
      installments: ['create', 'read', 'update', 'approve', 'reject'],
      suppliers: ['create', 'read', 'update', 'delete'],
      purchase_orders: ['create', 'read', 'update', 'approve', 'receive'],
      expenses: ['create', 'read', 'update', 'approve', 'delete'],
      services: ['create', 'read', 'update', 'delete'],
      work_orders: ['create', 'read', 'update', 'delete'],
      reports: ['read', 'export'],
      users: ['create', 'read', 'update', 'delete'],
      settings: ['read', 'update'],
      billing: ['read', 'update'],
    },
  },
  {
    slug: 'branch_manager',
    name: 'Branch Manager',
    permissions: {
      invoices: ['create', 'read', 'update', 'refund'],
      products: ['read', 'update'],
      stock: ['read', 'adjust', 'transfer'],
      customers: ['create', 'read', 'update'],
      installments: ['create', 'read', 'update', 'approve'],
      suppliers: ['read'],
      purchase_orders: ['create', 'read', 'update', 'receive'],
      expenses: ['create', 'read', 'update', 'approve'],
      services: ['read', 'update'],
      work_orders: ['create', 'read', 'update'],
      reports: ['read', 'export'],
      users: ['read'],
      settings: ['read'],
    },
  },
  {
    slug: 'cashier',
    name: 'Cashier',
    permissions: {
      invoices: ['create', 'read'],
      products: ['read'],
      stock: ['read'],
      customers: ['create', 'read', 'update'],
      installments: ['read'],
      services: ['read'],
      work_orders: ['create', 'read', 'update'],
      reports: ['read'],
    },
  },
  {
    slug: 'inventory_keeper',
    name: 'Inventory Keeper',
    permissions: {
      products: ['read', 'update'],
      stock: ['read', 'adjust', 'transfer'],
      suppliers: ['read'],
      purchase_orders: ['read', 'receive'],
      reports: ['read'],
    },
  },
  {
    slug: 'accountant',
    name: 'Accountant',
    permissions: {
      invoices: ['read'],
      expenses: ['create', 'read', 'update'],
      suppliers: ['read'],
      purchase_orders: ['read'],
      installments: ['read'],
      reports: ['read', 'export'],
      billing: ['read'],
    },
  },
]

// ─── Seed helpers ─────────────────────────────────────────────────────────────

async function seedTenantDefaults(
  schemaName: string,
  ownerName: string,
  ownerEmail: string,
  ownerPassword: string,
): Promise<void> {
  const db = getTenantDb(schemaName)

  // 1. Create all 5 system roles
  const roleMap: Record<string, string> = {}
  for (const r of SYSTEM_ROLES) {
    const role = await db.role.create({
      data: {
        slug: r.slug,
        name: r.name,
        permissions: r.permissions,
        isSystem: true,
      },
    })
    roleMap[r.slug] = role.id
  }

  // 2. Create main branch
  const branch = await db.branch.create({
    data: { name: 'الفرع الرئيسي', isMain: true, isActive: true },
  })

  // 3. Create super_admin user
  const passwordHash = await hashPassword(ownerPassword)
  await db.user.create({
    data: {
      // Normalized so the owner can log in regardless of the casing they typed
      // at signup (login lookups lowercase too).
      email: ownerEmail.trim().toLowerCase(),
      passwordHash,
      fullName: ownerName,
      roleId: roleMap['super_admin']!,
      branchId: branch.id,
      isActive: true,
    },
  })

  // 4. EGP base currency
  await db.currency.create({
    data: {
      code: 'EGP',
      name: 'Egyptian Pound',
      rateToBase: 1,
      isBase: true,
    },
  })

  // 5. Tax rates
  await db.taxRate.createMany({
    data: [
      { name: 'معفى', rate: 0, isDefault: true, isActive: true },
      { name: 'ضريبة القيمة المضافة 14%', rate: 14, isDefault: false, isActive: true },
    ],
  })

  // 6. Expense categories
  await db.expenseCategory.createMany({
    data: [
      { name: 'إيجار' },
      { name: 'رواتب' },
      { name: 'مرافق' },
      { name: 'تسويق' },
      { name: 'صيانة' },
      { name: 'أخرى' },
    ],
  })

  // 7. Payment methods
  await db.paymentMethod.createMany({
    data: [
      { name: 'نقدي',        type: 'cash',          feeType: 'none',    feePercentage: 0,    feeFixed: 0, isActive: true },
      { name: 'فيزا / ماستر', type: 'card',          feeType: 'percent', feePercentage: 1.75, feeFixed: 0, isActive: true },
      { name: 'فلوسة',       type: 'ewallet',       feeType: 'fixed',   feePercentage: 0,    feeFixed: 2, isActive: true },
      { name: 'InstaPay',    type: 'ewallet',       feeType: 'none',    feePercentage: 0,    feeFixed: 0, isActive: true },
      { name: 'فاليو',       type: 'bnpl',          feeType: 'percent', feePercentage: 3,    feeFixed: 0, isActive: true },
      { name: 'تحويل بنكي',  type: 'bank_transfer', feeType: 'fixed',   feePercentage: 0,    feeFixed: 5, isActive: true },
    ],
  })

  // 8. Tenant settings (single row)
  // ETA on by default: VAT-registered businesses must submit e-invoices to
  // ETA per Egyptian law. The store owner can opt out from Settings → Taxes
  // if VAT-exempt. Credentials are blank until they complete ETA enrollment.
  await db.tenantSetting.create({
    data: {
      language: 'ar',
      timezone: 'Africa/Cairo',
      currencyDefault: 'EGP',
      etaEnabled: true,
    },
  })
}

// ─── Provision ────────────────────────────────────────────────────────────────

export async function provisionTenant(data: RegisterTenantInput) {
  const schemaName = `tenant_${data.subdomain.replace(/-/g, '_')}`

  // 1. Check subdomain availability
  const existing = await masterDb.tenant.findUnique({ where: { subdomain: data.subdomain } })
  if (existing) {
    const err = new Error('subdomain_taken') as Error & { statusCode: number }
    err.statusCode = 409
    throw err
  }

  // 1b. Check email availability (Tenant.email is @unique in schema)
  const existingByEmail = await masterDb.tenant.findUnique({ where: { email: data.ownerEmail } })
  if (existingByEmail) {
    const err = new Error('email_taken') as Error & { statusCode: number }
    err.statusCode = 409
    throw err
  }

  // 2. Resolve plan
  const plan = await masterDb.plan.findUnique({ where: { slug: data.planSlug } })
  if (!plan) {
    const err = new Error('plan_not_found') as Error & { statusCode: number }
    err.statusCode = 400
    throw err
  }

  // 3. Create tenant row (status: PROVISIONING)
  // Wrapped in try/catch as defense-in-depth: pre-checks above can race with
  // a concurrent registration, so Prisma may still throw P2002 here.
  let tenant
  try {
    tenant = await masterDb.tenant.create({
      data: {
        name: data.name,
        subdomain: data.subdomain,
        schemaName,
        schemaVersion: 0,
        email: data.ownerEmail,
        ownerName: data.ownerName,
        ownerEmail: data.ownerEmail,
        planId: plan.id,
        status: 'PROVISIONING',
      },
    })
  } catch (createErr: unknown) {
    const e = createErr as { code?: string; meta?: { target?: string[] } }
    if (e.code === 'P2002') {
      const target = e.meta?.target ?? []
      const code = target.includes('email')
        ? 'email_taken'
        : target.includes('subdomain') || target.includes('schema_name')
          ? 'subdomain_taken'
          : 'tenant_conflict'
      const err = new Error(code) as Error & { statusCode: number }
      err.statusCode = 409
      throw err
    }
    throw createErr
  }

  try {
    // 4. Create PostgreSQL schema
    await masterDb.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`)

    // 5. Run tenant migrations (001_init + 002_full_schema)
    await runTenantMigrations(schemaName, tenant.id)

    // 6. Seed roles, branch, user, currency, tax rates, expense categories, payment methods, settings
    await seedTenantDefaults(schemaName, data.ownerName, data.ownerEmail, data.ownerPassword)

    // 7. Activate tenant
    await masterDb.tenant.update({
      where: { id: tenant.id },
      data: { status: 'ACTIVE' },
    })

    // 8. Start 14-day trial — without this, the tenant has no Subscription row,
    // the trial-expiry job has nothing to act on, and the in-app banner sees
    // null and stays hidden. Inside the same try/catch so a billing-row
    // failure rolls back the half-provisioned tenant.
    await startTrial(tenant.id, plan.id)
  } catch (err) {
    // Roll back master row on provisioning failure
    await masterDb.tenant.delete({ where: { id: tenant.id } }).catch(() => {})
    await masterDb.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => {})
    throw err
  }

  return {
    id: tenant.id,
    subdomain: tenant.subdomain,
    schemaName: tenant.schemaName,
  }
}
