import { describe, it, expect } from 'vitest'
import { permissionsWithinActor } from '../permissions'

// HESBA-SEC-02 regression: a user must not be able to grant (via a role they
// create/edit/assign) any permission they don't already hold. Locks in the
// guard used by create-role / update-role / create-user in auth.routes.ts.
describe('permissionsWithinActor (HESBA-SEC-02)', () => {
  const actor = { invoices: ['read', 'create'], products: ['read'] }

  it('allows an exact-match permission set', () => {
    expect(permissionsWithinActor({ invoices: ['read', 'create'], products: ['read'] }, actor)).toBe(true)
  })

  it('allows a strict subset', () => {
    expect(permissionsWithinActor({ invoices: ['read'] }, actor)).toBe(true)
  })

  it('rejects an action the actor does not hold on a resource it has', () => {
    expect(permissionsWithinActor({ invoices: ['read', 'delete'] }, actor)).toBe(false)
  })

  it('rejects a resource the actor lacks entirely (e.g. minting super-admin perms)', () => {
    expect(permissionsWithinActor({ users: ['create'] }, actor)).toBe(false)
  })

  it('treats an empty target as always within (no escalation)', () => {
    expect(permissionsWithinActor({}, actor)).toBe(true)
    expect(permissionsWithinActor({}, {})).toBe(true)
  })

  it('rejects any non-empty target when the actor holds nothing', () => {
    expect(permissionsWithinActor({ invoices: ['read'] }, {})).toBe(false)
  })

  it('ignores empty action arrays in the target', () => {
    expect(permissionsWithinActor({ reports: [] }, actor)).toBe(true)
  })
})
