// Routeless internal module (consumed by services/config preview and bookings recompute).
export { pricingService, assertPriceIntegrity } from "./pricing.service";
export { computePrice } from "./engine/compute-price";
export { buildPricingTable } from "./build-pricing-table";
export * from "./engine/types";
export type { PricePreview, PricePreviewInput } from "./pricing.types";
