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
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      summary: r.summary,
      pricingMode: r.pricingMode,
      fromPrice: r.fromPrice,
      currency: r.currency,
      badges: r.badges,
      isRecurringEligible: r.isRecurringEligible,
      typicalDuration: r.typicalDuration,
      recurringDiscount: r.recurringDiscount,
      status: r.status,
      sortOrder: r.sortOrder,
      category: r.category ? { slug: r.category.slug, name: r.category.name } : null,
    };
  }

  private serializeDetail(r: ServiceWithDetail): ServiceDetail {
    return {
      ...this.serializeListItem(r),
      categoryId: r.categoryId,
      description: r.description,
      pricingRef: r.pricingRef,
      basePrice: r.basePrice,
      claimsBlock: r.claimsBlock,
      recurringHeading: r.recurringHeading,
      recurringPlans: r.recurringPlans.map((p) => ({
        id: p.id,
        name: p.name,
        freq: p.freq,
        amount: p.amount,
        unit: p.unit,
        disc: p.disc,
        best: p.best,
        cta: p.cta,
      })),
    };
  }
}

export const servicesService = new ServicesService();
