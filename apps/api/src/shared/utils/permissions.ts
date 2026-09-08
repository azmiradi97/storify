// HESBA-SEC-02 — "you can't grant what you don't hold".
//
// A user may only create, edit, or assign a role whose permission set is a
// subset of their own. Without this, anyone with `users:update` could escalate
// their own role (or mint a super_admin via `users:create`) to full control.
// super_admin is the tenant root role and bypasses this check at the call site.
export function permissionsWithinActor(
  target: Record<string, string[]>,
  actor: Record<string, string[]>,
): boolean {
  for (const [resource, actions] of Object.entries(target)) {
    const allowed = actor[resource] ?? []
    for (const action of actions) {
      if (!allowed.includes(action)) return false
    }
  }
  return true
}
