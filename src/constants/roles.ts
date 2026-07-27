import { Role } from "../enums";

/**
 * Capability-based RBAC (docs/architecture/07 §2). We model CAPABILITIES, not
 * bare roles: customers and professionals hold ownership-scoped capabilities
 * (resolved at the service layer against their own / assigned rows); staff hold
 * `:any`-scoped capabilities. Adding a role or permission is a one-line edit
 * here — no per-route rewrites.
 */
export type Permission =
  // staff booking ops
  | "booking:read:any"
  | "booking:transition"
  | "booking:assign"
  // dispatch + payroll
  | "crew:manage"
  | "payout:manage"
  // professional (ownership-scoped)
  | "booking:read:assigned"
  | "booking:fulfil"
  // quotes (per-booking final price — operational)
  | "quote:read"
  | "quote:manage"
  // money
  | "payment:refund"
  // demo inbox
  | "demo-inbox:read"
  // geography: areas, ZIP codes, and per-service coverage (08)
  | "geo:manage"
  // catalog (ADMIN only — decision #8)
  | "catalog:draft:write"
  | "catalog:publish"
  | "catalog:schema:write"
  // memberships / pros / users (ADMIN only, except pro triage)
  | "membership:manage"
  | "pro:manage"
  | "user:manage";

const COORDINATOR: Permission[] = [
  "booking:read:any",
  "booking:transition",
  "booking:assign",
  "crew:manage",
  "payout:manage",
  "quote:read",
  "quote:manage",
  "payment:refund",
  "pro:manage",
  "demo-inbox:read",
  "geo:manage",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.CUSTOMER]: [], // pure ownership scope
  [Role.PROFESSIONAL]: ["booking:read:assigned", "booking:fulfil"],
  [Role.COORDINATOR]: COORDINATOR,
  [Role.ADMIN]: [
    ...COORDINATOR,
    "catalog:draft:write",
    "catalog:publish",
    "catalog:schema:write",
    "membership:manage",
    "user:manage",
  ],
};

/** Does `role` grant every one of `required`? */
export function roleHasPermissions(role: Role, required: Permission[]): boolean {
  const granted = ROLE_PERMISSIONS[role] ?? [];
  return required.every((p) => granted.includes(p));
}

/** Roles that may sign in to the staff/admin surface. */
export const STAFF_ROLES: Role[] = [Role.COORDINATOR, Role.ADMIN];
/** Roles that require TOTP MFA before staff go-live (07 §3). */
export const MFA_REQUIRED_ROLES: Role[] = [Role.COORDINATOR, Role.ADMIN];
