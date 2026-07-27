import type { Role } from "../enums";
import type { PaginationMeta } from "../utils/api-response";

/** The authenticated principal attached to `req.user` by `authenticate`. */
export interface AuthUser {
  id: string;
  role: Role;
  tokenVersion: number;
}

export interface ApiSuccess<T> {
  success: true;
  message: string;
  data: T;
  meta?: PaginationMeta;
}

export interface ApiFailure {
  success: false;
  message: string;
  errors?: { code: string; [k: string]: unknown };
  stack?: string;
}
