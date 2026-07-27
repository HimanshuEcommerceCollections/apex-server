import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * fs-based loader for a service-area.v1.json path. NOT a static import (the file
 * lives under prisma/, outside src/rootDir); a future brand passes its own path.
 * At runtime the source of truth is the ServiceAreaZip table (seeded from this).
 */
const ServiceAreaFileSchema = z.object({
  version: z.string(),
  owner_brand: z.string(),
  region: z.string(),
  zips: z.array(
    z.object({
      zip: z.string().regex(/^\d{5}$/),
      city: z.string().optional(),
      county: z.string().optional(),
    }),
  ),
});

export type ServiceAreaFile = z.infer<typeof ServiceAreaFileSchema>;

export function loadServiceAreaFile(path: string): ServiceAreaFile {
  const raw = readFileSync(path, "utf-8");
  return ServiceAreaFileSchema.parse(JSON.parse(raw));
}
