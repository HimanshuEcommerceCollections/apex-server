import { prisma } from "../../db/client";
import type { Prisma } from "@prisma/client";

export class WaitlistRepository {
  findByEmailZip(email: string, zip: string) {
    return prisma.waitlistSignup.findUnique({ where: { email_zip: { email, zip } } });
  }
  create(data: Prisma.WaitlistSignupUncheckedCreateInput) {
    return prisma.waitlistSignup.create({ data });
  }
}

export const waitlistRepository = new WaitlistRepository();
