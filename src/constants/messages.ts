/** Reusable response message strings. */
export const Messages = {
  SUCCESS: "Success",
  CREATED: "Created",
  NOT_FOUND: "Resource not found",
  VALIDATION_FAILED: "Validation failed",
  UNAUTHENTICATED: "Authentication required",
  FORBIDDEN: "You do not have permission to perform this action",
  RATE_LIMITED: "Too many requests, please try again later",
  DB_UNAVAILABLE: "Database unavailable",
} as const;
