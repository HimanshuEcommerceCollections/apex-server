import { ConfigInputType, ServiceStatus } from "../../../enums";
import { ApiError } from "../../../utils/api-error";
import { validateSelections, type ConfigInput, type GroupDescriptor, type PricingModeName } from "../../../shared";
import { pricingService, type PricePreview } from "../../pricing";
import { serviceConfigRepository, type ServiceWithConfig } from "./service-config.repository";
import type { ConfigGroupView, ServiceConfigResponse } from "./service-config.types";

const HIDDEN = new Set<ServiceStatus>([ServiceStatus.DRAFT, ServiceStatus.INACTIVE]);
// QUANTITY is optionless now — it carries its own unitLabel/unitPrice strategy.
const OPTION_BEARING = new Set<ConfigInputType>([
  ConfigInputType.SELECT,
  ConfigInputType.MULTISELECT,
]);

export interface PricePreviewInputDto {
  selections: Record<string, string | number | boolean | string[]>;
  quantity?: number;
}

export class ServiceConfigService {
  /** GET /services/:idOrSlug/config — the full configurator payload (one round trip). */
  async getConfig(idOrSlug: string): Promise<ServiceConfigResponse> {
    const service = await this.loadOr404(idOrSlug);
    // A group is served only if ACTIVE (repo-filtered) AND — for option-bearing
    // input types — has >= 1 ACTIVE option. TOGGLE/TEXTAREA are optionless by design.
    const groups = service.configGroups.filter(
      (g) => !OPTION_BEARING.has(g.inputType) || g.options.length > 0,
    );
    return this.serialize(service, groups);
  }

  /** POST /services/:idOrSlug/config/price — validate selections then live-price. */
  async price(idOrSlug: string, input: PricePreviewInputDto): Promise<PricePreview> {
    const service = await this.loadOr404(idOrSlug);

    const descriptors: GroupDescriptor[] = service.configGroups.map((g) => ({
      key: g.key,
      inputType: g.inputType as ConfigInput,
      isRequired: g.isRequired,
      selectMin: g.selectMin,
      selectMax: g.selectMax,
      optionKeys: g.options.map((o) => o.key),
    }));

    const violations = validateSelections({
      selections: input.selections,
      groups: descriptors,
      pricingMode: service.pricingMode as PricingModeName,
      strict: false, // live preview — user may still be configuring
    });
    if (violations.length) {
      throw ApiError.unprocessable("Invalid selections", {
        code: violations[0].code,
        violations,
      });
    }

    return pricingService.preview(idOrSlug, {
      selections: input.selections,
      quantity: input.quantity,
    });
  }

  private async loadOr404(idOrSlug: string): Promise<ServiceWithConfig> {
    const service = await serviceConfigRepository.findServiceWithConfig(idOrSlug);
    if (!service || HIDDEN.has(service.status)) {
      throw ApiError.notFound("Service not found", { code: "SERVICE_NOT_FOUND", idOrSlug });
    }
    return service;
  }

  private serialize(service: ServiceWithConfig, groups: ServiceWithConfig["configGroups"]): ServiceConfigResponse {
    const configGroups: ConfigGroupView[] = groups.map((g) => ({
      id: g.id,
      serviceId: g.serviceId,
      key: g.key,
      label: g.label,
      description: g.description,
      inputType: g.inputType,
      uiHint: g.uiHint,
      applies: g.applies,
      isRequired: g.isRequired,
      priceDelta: g.priceDelta,
      selectMin: g.selectMin,
      selectMax: g.selectMax,
      quantityMin: g.quantityMin,
      quantityMax: g.quantityMax,
      unitLabel: g.unitLabel,
      unitPrice: g.unitPrice,
      sortOrder: g.sortOrder,
      status: g.status,
      options: g.options.map((o) => ({
        id: o.id,
        key: o.key,
        label: o.label,
        sublabel: o.sublabel,
        priceDelta: o.priceDelta,
        sortOrder: o.sortOrder,
        status: o.status,
      })),
    }));

    return {
      id: service.id,
      categoryId: service.categoryId,
      name: service.name,
      slug: service.slug,
      summary: service.summary,
      description: service.description,
      pricingMode: service.pricingMode,
      pricingRef: service.pricingRef,
      basePrice: service.basePrice,
      // Wire name kept; sourced from basePrice (0 base = no from-price listed).
      fromPrice: service.basePrice > 0 ? service.basePrice : null,
      currency: service.currency,
      badges: service.badges,
      claimsBlock: service.claimsBlock,
      isRecurringEligible: service.isRecurringEligible,
      sortOrder: service.sortOrder,
      status: service.status,
      taxRateBps: service.taxRateBps,
      configGroups,
      // The /book frequency section, cadence-sorted. Picking one applies its %
      // to the configured pre-tax total — the system's only discount mechanism.
      recurring: [...service.recurring]
        .sort((a, b) => a.cadence.sortOrder - b.cadence.sortOrder)
        .map((r) => ({
          cadenceId: r.cadenceId,
          key: r.cadence.key,
          label: r.cadence.label,
          discountPercent: r.discountPercent,
        })),
    };
  }
}

export const serviceConfigService = new ServiceConfigService();
