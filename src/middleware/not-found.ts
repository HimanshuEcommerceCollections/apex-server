import type { Request, Response } from "express";
import { HttpStatus } from "../constants/http-status";

/** 404 fallback, registered after all routes and before the error handler. */
export function notFound(req: Request, res: Response): void {
  res.status(HttpStatus.NOT_FOUND).json({
    success: false,
    message: `Not found: ${req.method} ${req.originalUrl}`,
    errors: { code: "NOT_FOUND" },
  });
}
