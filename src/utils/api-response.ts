import type { Response } from "express";
import { HttpStatus, type HttpStatusValue } from "../constants/http-status";
import { Messages } from "../constants/messages";

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Standard success envelope (Elevate parity):
 * `{ success, message, data, meta? }`. `meta` is only emitted when supplied.
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  message: string = Messages.SUCCESS,
  statusCode: HttpStatusValue = HttpStatus.OK,
  meta?: PaginationMeta,
): void {
  const body: Record<string, unknown> = { success: true, message, data };
  if (meta) body.meta = meta;
  res.status(statusCode).json(body);
}
