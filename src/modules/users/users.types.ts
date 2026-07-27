import type { z } from "zod";
import type { Role, UserStatus } from "../../enums";
import type { updateMeSchema } from "./users.validation";

export type UpdateMeDto = z.infer<typeof updateMeSchema>;

/** Public-facing user profile (camelCase app resource; never exposes secrets). */
export interface UserProfile {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  status: UserStatus;
  emailVerified: boolean;
  mfaEnabled: boolean;
  createdAt: string;
}

export interface CreateUserInput {
  email: string;
  name: string;
  phone?: string;
  passwordHash?: string | null;
  role?: Role;
  status?: import("../../enums").UserStatus;
}
