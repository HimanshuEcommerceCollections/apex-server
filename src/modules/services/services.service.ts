import { ServiceStatus } from "../../enums";
import { ApiError } from "../../utils/api-error";
import { servicesRepository, type ServiceWithCategory, type ServiceWithDetail } from "./services.repository";
import type { ServiceDetail, ServiceListItem } from "./services.types";

/** DRAFT/INACTIVE services are hidden from the public catalog. */
const HIDDEN = new Set<ServiceStatus>([ServiceStatus.DRAFT, ServiceStatus.INACTIVE]);

export class ServicesService {
  async list(args: { status?: ServiceStatus; categorySlug?: string }): Promise<ServiceListItem[]> {
    const rows = await servicesRepository.findMany(args);
    return rows.map((r) => this.serializeListItem(r));
  }

  async getByIdOrSlug(idOrSlug: string): Promise<ServiceDetail> {
    const row = await servicesRepository.findByIdOrSlug(idOrSlug);
    if (!row || HIDDEN.has(row.status)) {
      throw ApiError.notFound("Service not found", { code: "SERVICE_NOT_FOUND", idOrSlug });
    }
    return this.serializeDetail(row);
  }

  private serializeListItem(r: ServiceWithCategory): ServiceListItem {
    // DERIVED: "up to X%" from the max active cadence discount — never stored.
    const maxPct = Math.max(0, ...r.recurring.map((x) => x.discountPercent));
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      summary: r.summary,
      pricingMode: r.pricingMode,
      // Wire name kept for every consumer; the value is now basePrice — the one
      // number that is both the payable minimum and the listed "from $X". A 0
      // base means the service lists no from-price.
      fromPrice: r.basePrice > 0 ? r.basePrice : null,
      currency: r.currency,
      badges: r.badges,
      isRecurringEligible: r.isRecurringEligible,
      typicalDuration: r.typicalDuration,
      recurringDiscount: maxPct > 0 ? `up to ${maxPct}%` : null,
      status: r.status,
      sortOrder: r.sortOrder,
      category: r.category ? { slug: r.category.slug, name: r.category.name } : null,
    };
  }

  private serializeDetail(r: ServiceWithDetail): ServiceDetail {
    const pctByCadence = new Map(r.recurring.map((x) => [x.cadenceId, x.discountPercent]));
    const UNIT: Record<string, string | null> = { PER_VISIT: "/visit", PER_MONTH: "/mo", FLAT: null };
    return {
      ...this.serializeListItem(r),
      categoryId: r.categoryId,
      description: r.description,
      pricingRef: r.pricingRef,
      basePrice: r.basePrice,
      claimsBlock: r.claimsBlock,
      recurringHeading: r.recurringHeading,
      // Admin-composed Plans on the legacy card wire shape, so the marketing
      // pages keep rendering untouched. `amount` is the plan's BINDING pre-tax
      // price (no longer decorative free text).
      recurringPlans: r.plans.map((p) => {
        const pct = pctByCadence.get(p.cadenceId) ?? 0;
        return {
          id: p.id,
          name: p.name,
          freq: p.cadence.label,
          amount: `$${Math.round(p.price / 100)}`,
          unit: UNIT[p.priceType] ?? null,
          disc: pct > 0 ? `Save ${pct}%` : null,
          best: p.featured,
          cta: `Choose ${p.name.toLowerCase()}`,
          bullets: p.bullets,
        };
      }),
    };
  }
}

export const servicesService = new ServicesService();
