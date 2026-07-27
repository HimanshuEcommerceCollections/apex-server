import { z } from "zod";

/** PATCH /me — customers/staff may edit their own name/phone (never role/email/status). */
export const updateMeSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().trim().min(3).max(30).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" });

// --- admin: staff management (07 §4, capability user:manage) ---

/** Staff roles an admin may invite/assign (never CUSTOMER or PROFESSIONAL here). */
export const staffRoleSchema = z.enum(["COORDINATOR", "ADMIN"]);

export const inviteStaffSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(120),
  role: staffRoleSchema,
  phone: z.string().trim().min(3).max(30).optional(),
});

export const updateStaffSchema = z
  .object({
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
    role: staffRoleSchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" });

export const staffIdParamSchema = z.object({ id: z.string().uuid() });

export const listStaffQuerySchema = z.object({
  role: staffRoleSchema.optional(),
});
