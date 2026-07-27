/**
 * Static, read-only map from a service slug to its icon/cover asset paths.
 *
 * MVP has no admin uploads (multer dropped, docs/architecture/01 decision #8), so
 * this is a const module rather than Elevate's mutable JSON registry. Serving the
 * actual bytes is the client/CDN's job; this only records the canonical paths.
 */
export interface ServiceAssets {
  icon: string;
  cover: string;
}

export const SERVICE_ASSETS: Record<string, ServiceAssets> = {
  cleaning: { icon: "/assets/cleaning/images/icon.svg", cover: "/assets/cleaning/images/hero-big.webp" },
  "lawn-care": { icon: "/assets/lawn-care/images/icon.svg", cover: "/assets/lawn-care/images/hero-big.webp" },
};

export function getServiceAssets(slug: string): ServiceAssets | null {
  return SERVICE_ASSETS[slug] ?? null;
}
