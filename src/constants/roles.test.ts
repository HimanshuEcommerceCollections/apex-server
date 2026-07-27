import { describe, expect, it } from "vitest";
import { Role } from "../enums";
import { ROLE_PERMISSIONS, roleHasPermissions } from "./roles";

describe("RBAC capability map (07 §2)", () => {
  it("customers hold no capabilities (pure ownership scope)", () => {
    expect(ROLE_PERMISSIONS[Role.CUSTOMER]).toHaveLength(0);
  });

  it("catalog editing is admin-only", () => {
    expect(roleHasPermissions(Role.COORDINATOR, ["catalog:publish"])).toBe(false);
    expect(roleHasPermissions(Role.ADMIN, ["catalog:publish"])).toBe(true);
  });

  it("coordinators can refund, assign, manage crews & payroll", () => {
    expect(
      roleHasPermissions(Role.COORDINATOR, [
        "payment:refund",
        "booking:assign",
        "crew:manage",
        "payout:manage",
      ]),
    ).toBe(true);
  });

  it("admin is a superset of coordinator", () => {
    const coord = ROLE_PERMISSIONS[Role.COORDINATOR];
    expect(roleHasPermissions(Role.ADMIN, coord)).toBe(true);
  });

  it("professionals only see/fulfil assigned jobs, never pricing/catalog", () => {
    expect(roleHasPermissions(Role.PROFESSIONAL, ["booking:read:assigned", "booking:fulfil"])).toBe(
      true,
    );
    expect(roleHasPermissions(Role.PROFESSIONAL, ["booking:read:any"])).toBe(false);
    expect(roleHasPermissions(Role.PROFESSIONAL, ["payment:refund"])).toBe(false);
  });
});
