import { z } from "zod";

export const intentParamSchema = z.object({ reference: z.string().min(1) });
export const paymentIdParamSchema = z.object({ id: z.string().uuid() });
export const refundBodySchema = z.object({
  amount: z.coerce.number().int().positive().optional(), // cents; omit for full remaining
});
