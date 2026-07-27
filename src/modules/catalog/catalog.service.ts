import { catalogRepository, type PricingUpdate, type ServiceForEdit } from "./catalog.repository";
import { auditService } from "../audit";
import { ApiError } from "../../utils/api-error";
import { pingClientRevalidate } from "./catalog.revalidate";
import type { ServiceEditView } from "./catalog.types";

interface RuleEffect {
  kind: string;
  calc: string;
  value: number;
}

export class CatalogService {
  async getForEdit(idOrSlug: string): Promise<ServiceEditView> {
    const svc = await catalogRepository.findServiceForEdit(idOrSlug);
    if (!svc) throw ApiError.notFound("Service not found", { code: "SERVICE_NOT_FOUND" });
    return this.serialize(svc);
  }

  async updatePricing(
    idOrSlug: string,
    dto: PricingUpdate,
    actorUserId: string,
    ip?: string,
  ): Promise<ServiceEditView> {
    const svc = await catalogRepository.findServiceForEdit(idOrSlug);
    if (!svc) throw ApiError.notFound("Service not found", { code: "SERVICE_NOT_FOUND" });

    // Ownership + shape validation (only this service's rows may be touched).
    const optionIds = new Set(svc.configGroups.flatMap((g) => g.options.map((o) => o.id)));
    for (const o of dto.options ?? []) {
      if (!optionIds.has(o.id)) {
        throw ApiError.badRequest("Option does not belong to this service", { code: "UNKNOWN_OPTION_ID", id: o.id });
      }
    }
    const ruleEffects = new Map<string, Record<string, unknown>>();
    const ruleById = new Map(svc.pricingRules.map((r) => [r.id, r]));
    for (const r of dto.rules ?? []) {
      const rule = ruleById.get(r.id);
      if (!rule) throw ApiError.badRequest("Rule does not belong to this service", { code: "UNKNOWN_RULE_ID", id: r.id });
      const effect = rule.effect as unknown as RuleEffect;
      if (effect.calc === "percent" && r.value > 100) {
        throw ApiError.unprocessable("Percent value must be 0-100", { code: "PERCENT_RANGE", id: r.id });
      }
      ruleEffects.set(r.id, effect as unknown as Record<string, unknown>);
    }

    const before = this.snapshot(svc);
    await catalogRepository.updatePricing(svc.id, dto, ruleEffects);
    const updated = await catalogRepository.findServiceForEdit(svc.id);
    const after = updated ? this.snapshot(updated) : null;

    await auditService.record({
      actorUserId,
      action: "catalog.pricing.update",
      entityType: "Service",
      entityId: svc.id,
      before,
      after,
      ip: ip ?? null,
    });

    // Bust the marketing client's ISR cache for this service (fire-and-forget).
    void pingClientRevalidate(["catalog", `service:${svc.slug}`]);

    return this.serialize(updated!);
  }

  private snapshot(svc: ServiceForEdit) {
    return {
      basePrice: svc.basePrice,
      fromPrice: svc.fromPrice,
      options: svc.configGroups.flatMap((g) => g.options.map((o) => ({ id: o.id, priceDelta: o.priceDelta }))),
      rules: svc.pricingRules.map((r) => ({ id: r.id, effect: r.effect })),
    };
  }

  private serialize(svc: ServiceForEdit): ServiceEditView {
    return {
      id: svc.id,
      slug: svc.slug,
      name: svc.name,
      pricingMode: svc.pricingMode,
      basePrice: svc.basePrice,
      fromPrice: svc.fromPrice,
      currency: svc.currency,
      groups: svc.configGroups.map((g) => ({
        key: g.key,
        label: g.label,
        inputType: g.inputType,
        status: g.status,
        options: g.options.map((o) => ({
          id: o.id,
          key: o.key,
          label: o.label,
          priceDelta: o.priceDelta,
          status: o.status,
        })),
      })),
      rules: svc.pricingRules.map((r) => {
        const e = r.effect as unknown as RuleEffect;
        return { id: r.id, key: r.key, label: r.label, kind: e.kind, calc: e.calc, value: e.value };
      }),
    };
  }
}

export const catalogService = new CatalogService();
