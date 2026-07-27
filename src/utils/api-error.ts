import { HttpStatus, type HttpStatusValue } from "../constants/http-status";

/**
 * Operational error carrying an HTTP status and an optional `details` payload.
 *
 * Apex convention (docs/architecture/05, Deviation D-6): EVERY factory takes
 * `(message, details?)` so `errors.code` can be present on every operational
 * 4xx. The global error handler serializes `details` under the JSON key `errors`.
 */
export class ApiError extends Error {
  readonly statusCode: HttpStatusValue;
  readonly details?: Record<string, unknown>;
  readonly isOperational = true;

  constructor(statusCode: HttpStatusValue, message: string, details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.name = "ApiError";
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message: string, details?: Record<string, unknown>) {
    return new ApiError(HttpStatus.BAD_REQUEST, message, details);
  }
  static unauthorized(message: string, details?: Record<string, unknown>) {
    return new ApiError(HttpStatus.UNAUTHORIZED, message, details);
  }
  static forbidden(message: string, details?: Record<string, unknown>) {
    return new ApiError(HttpStatus.FORBIDDEN, message, details);
  }
  static notFound(message: string, details?: Record<string, unknown>) {
    return new ApiError(HttpStatus.NOT_FOUND, message, details);
  }
  static conflict(message: string, details?: Record<string, unknown>) {
    return new ApiError(HttpStatus.CONFLICT, message, details);
  }
  static unprocessable(message: string, details?: Record<string, unknown>) {
    return new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, message, details);
  }
  static tooManyRequests(message: string, details?: Record<string, unknown>) {
    return new ApiError(HttpStatus.TOO_MANY_REQUESTS, message, details);
  }
  static internal(message: string, details?: Record<string, unknown>) {
    return new ApiError(HttpStatus.INTERNAL_SERVER_ERROR, message, details);
  }
  static serviceUnavailable(message: string, details?: Record<string, unknown>) {
    return new ApiError(HttpStatus.SERVICE_UNAVAILABLE, message, details);
  }
  static notImplemented(message: string, details?: Record<string, unknown>) {
    return new ApiError(HttpStatus.NOT_IMPLEMENTED, message, details);
  }
}
