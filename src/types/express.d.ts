import type { AuthUser } from "./common.types";

// Augment Express Request with the authenticated principal (set by `authenticate`).
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
