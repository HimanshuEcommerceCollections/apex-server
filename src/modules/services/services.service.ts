import { CadenceInterval, ServiceStatus } from "../../enums";
import { ApiError } from "../../utils/api-error";
import { servicesRepository, type ServiceWithCategory, type ServiceWithDetail } from "./services.repository";
import type { ServiceDetail, ServiceListItem } from "./services.types";

/** DRAFT/INACTIVE services are hidden from the public catalog. */
const HIDDEN = new Set<ServiceStatus>([ServiceStatus.DRAFT, ServiceStatus.INACTIVE]);

/** "Every week", "Every 2 weeks", "Every 3 months" — the card's sub-line. */
function cadencePhrase(interval: CadenceInterval, count: number): string {
  if (interval === CadenceInterval.NONE) return "Single visit";
  const unit = interval === CadenceInterval.WEEK ? "week" : "month";
  return count === 1 ? `Every ${unit}` : `Every ${count} ${unit}s`;
}

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
    // The deepest discount is the one worth highlighting.
    const best = r.recurring.reduce((max, x) => Math.max(max, x.discountPercent), 0);
    return {
      ...this.serializeListItem(r),
      categoryId: r.categoryId,
      description: r.description,
      pricingRef: r.pricingRef,
      basePrice: r.basePrice,
      claimsBlock: r.claimsBlock,
      recurringHeading: r.recurringHeading,
      /**
       * The payment frequencies this service offers. One list, two consumers:
       * the display-only "Recurring plans" cards and the estimator's Frequency
       * control. `amount` is the base price with the cadence's discount applied
       * — an illustration of the saving, not a binding quote (the configured
       * total is), so it is null when the service lists no from-price.
       */
      recurringOptions: r.recurring.map((x) => ({
        cadenceId: x.cadenceId,
        key: x.cadence.key,
        label: x.cadence.label,
        freq: cadencePhrase(x.cadence.interval, x.cadence.intervalCount),
        discountPercent: x.discountPercent,
        disc: x.discountPercent > 0 ? `Save ${x.discountPercent}%` : null,
        amount:
          r.basePrice > 0
            ? `$${Math.round((r.basePrice * (100 - x.discountPercent)) / 100 / 100)}`
            : null,
        unit: r.basePrice > 0 ? "/visit" : null,
        isSubscription: x.cadence.interval !== CadenceInterval.NONE,
        best: x.discountPercent > 0 && x.discountPercent === best,
      })),
    };
  }
}

export const servicesService = new ServicesService();
