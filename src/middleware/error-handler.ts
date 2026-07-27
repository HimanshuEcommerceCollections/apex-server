import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { ApiError } from "../utils/api-error";
import { HttpStatus } from "../constants/http-status";
import { isProd } from "../config/env";
import { logger } from "../utils/logger";

/**
 * Global error translator, registered LAST. Produces the failure envelope
 * `{ success: false, message, errors?, stack? }` (stack only when not prod).
 * Translation table (Elevate parity): ApiError -> its status; ZodError -> 422;
 * Prisma P2002 -> 409, P2025 -> 404, other known Prisma -> 400; else -> 500.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
  let message = "Internal server error";
  let errors: Record<string, unknown> | undefined;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
    errors = err.details;
  } else if (err instanceof ZodError) {
    statusCode = HttpStatus.UNPROCESSABLE_ENTITY;
    message = "Validation failed";
    errors = {
      code: "VALIDATION_FAILED",
      issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      statusCode = HttpStatus.CONFLICT;
      message = "Resource already exists";
      errors = { code: "ALREADY_EXISTS" };
    } else if (err.code === "P2025") {
      statusCode = HttpStatus.NOT_FOUND;
      message = "Record not found";
      errors = { code: "NOT_FOUND" };
    } else {
      statusCode = HttpStatus.BAD_REQUEST;
      message = "Invalid database request";
      errors = { code: "DB_REQUEST_ERROR" };
    }
  } else if (err instanceof Error) {
    message = err.message || message;
  }

  if (statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} ->`, err);
  }

  const body: Record<string, unknown> = { success: false, message };
  if (errors) body.errors = errors;
  if (!isProd && err instanceof Error && err.stack) body.stack = err.stack;

  res.status(statusCode).json(body);
}
