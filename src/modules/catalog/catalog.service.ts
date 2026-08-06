import type { Prisma } from "@prisma/client";
import { ConfigStatus } from "../../enums";
import {
  catalogRepository,
  type PricingUpdate,
  type ServiceForEdit,
} from "./catalog.repository";
import { auditService } from "../audit";
import { ApiError } from "../../utils/api-error";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { getStripe, brandMetadata } from "../payments/stripe.client";
import { pingClientRevalidate } from "./catalog.revalidate";
import type { CadenceView, PlanView, ServiceEditView } from "./catalog.types";

/** Actor context threaded through every admin write for the audit log. */
export interface Actor {
  userId: string;
  ip?: string;
}

/** slugified key from a label; uniqueness within `taken` via -2, -3, … */
function keyFrom(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "item";
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export class CatalogService {
  // ── Edit view ────────────────────────────────────────────────────────────

  async getForEdit(idOrSlug: string): Promise<ServiceEditView> {
    const svc = await catalogRepository.findServiceForEdit(idOrSlug);
    if (!svc) throw ApiError.notFound("Service not found", { code: "SERVICE_NOT_FOUND" });
    return this.serialize(svc);
  }

  async updatePricing(idOrSlug: string, dto: PricingUpdate, actor: Actor): Promise<ServiceEditView> {
    const svc = await this.loadOr404(idOrSlug);

    // Ownership: only this service's option rows may be touched.
    const optionIds = new Set(svc.configGroups.flatMap((g) => g.options.map((o) => o.id)));
    for (const o of dto.options ?? []) {
      if (!optionIds.has(o.id)) {
        throw ApiError.badRequest("Option does not belong to this service", { code: "UNKNOWN_OPTION_ID", id: o.id });
      }
    }

    const before = this.snapshot(svc);
    await catalogRepository.updatePricing(svc.id, dto);
    const updated = (await catalogRepository.findServiceForEdit(svc.id))!;

    await this.audit(actor, "catalog.pricing.update", svc.id, before, this.snapshot(updated));
    this.revalidate(svc.slug);
    return this.serialize(updated);
  }

  // ── Configurations ───────────────────────────────────────────────────────

  async createGroup(
    idOrSlug: string,
    dto: {
      label: string;
      description?: string | null;
      inputType: "SELECT" | "MULTISELECT" | "QUANTITY";
      isRequired?: boolean;
      selectMin?: number | null;
      selectMax?: number | null;
      quantityMin?: number | null;
      quantityMax?: number | null;
      unitLabel?: string | null;
      unitPrice?: number | null;
    },
    actor: Actor,
  ): Promise<ServiceEditView> {
    const svc = await this.loadOr404(idOrSlug);
    const taken = new Set((await catalogRepository.groupKeys(svc.id)).map((k) => k.key));
    const created = await catalogRepository.createGroup({
      serviceId: svc.id,
      key: keyFrom(dto.label, taken),
      label: dto.label,
      description: dto.description ?? null,
      inputType: dto.inputType,
      isRequired: dto.isRequired ?? false,
      selectMin: dto.selectMin ?? null,
      selectMax: dto.selectMax ?? null,
      quantityMin: dto.quantityMin ?? null,
      quantityMax: dto.quantityMax ?? null,
      unitLabel: dto.inputType === "QUANTITY" ? (dto.unitLabel ?? null) : null,
      unitPrice: dto.inputType === "QUANTITY" ? (dto.unitPrice ?? null) : null,
      sortOrder: await catalogRepository.nextGroupSort(svc.id),
    });

    await this.audit(actor, "catalog.group.create", svc.id, null, { groupId: created.id, label: created.label });
    this.revalidate(svc.slug);
    return this.getForEdit(svc.id);
  }

  async patchGroup(
    idOrSlug: string,
    groupId: string,
    dto: Prisma.ServiceConfigGroupUncheckedUpdateInput,
    actor: Actor,
  ): Promise<ServiceEditView> {
    const svc = await this.loadOr404(idOrSlug);
    const group = await catalogRepository.findGroup(groupId);
    if (!group || group.serviceId !== svc.id) {
      throw ApiError.notFound("Configuration not found on this service", { code: "GROUP_NOT_FOUND" });
    }

    const before = { label: group.label, status: group.status, isRequired: group.isRequired };
    const updated = await catalogRepository.updateGroup(groupId, dto);

    await this.audit(actor, "catalog.group.update", svc.id, before, {
      label: updated.label,
      status: updated.status,
      isRequired: updated.isRequired,
    });
    this.revalidate(svc.slug);
    return this.getForEdit(svc.id);
  }

  async createOption(
    idOrSlug: string,
    groupId: string,
    dto: { label: string; sublabel?: string | null; priceDelta: number },
    actor: Actor,
  ): Promise<ServiceEditView> {
    const svc = await this.loadOr404(idOrSlug);
    const group = await catalogRepository.findGroup(groupId);
    if (!group || group.serviceId !== svc.id) {
      throw ApiError.notFound("Configuration not found on this service", { code: "GROUP_NOT_FOUND" });
    }
    if (group.inputType === "QUANTITY" || group.inputType === "TEXTAREA") {
      throw ApiError.badRequest("This configuration type does not take options", { code: "GROUP_NOT_OPTION_BEARING" });
    }

    const taken = new Set((await catalogRepository.optionKeys(groupId)).map((k) => k.key));
    const created = await catalogRepository.createOption({
      groupId,
      key: keyFrom(dto.label, taken),
      label: dto.label,
      sublabel: dto.sublabel ?? null,
      priceDelta: dto.priceDelta,
      sortOrder: await catalogRepository.nextOptionSort(groupId),
    });

    await this.audit(actor, "catalog.option.create", svc.id, null, { optionId: created.id, label: created.label });
    this.revalidate(svc.slug);
    return this.getForEdit(svc.id);
  }

  async patchOption(
    idOrSlug: string,
    optionId: string,
    dto: Prisma.ServiceConfigOptionUncheckedUpdateInput,
    actor: Actor,
  ): Promise<ServiceEditView> {
    const svc = await this.loadOr404(idOrSlug);
    const option = await catalogRepository.findOption(optionId);
    if (!option || option.group.serviceId !== svc.id) {
      throw ApiError.notFound("Option not found on this service", { code: "OPTION_NOT_FOUND" });
    }

    const before = { label: option.label, priceDelta: option.priceDelta, status: option.status };
    const updated = await catalogRepository.updateOption(optionId, dto);

    await this.audit(actor, "catalog.option.update", svc.id, before, {
      label: updated.label,
      priceDelta: updated.priceDelta,
      status: updated.status,
    });
    this.revalidate(svc.slug);
    return this.getForEdit(svc.id);
  }

  // ── Recurring (per-service grid) ─────────────────────────────────────────

  async putRecurring(
    idOrSlug: string,
    rows: { cadenceId: string; discountPercent: number; isActive: boolean }[],
    actor: Actor,
  ): Promise<ServiceEditView> {
    const svc = await this.loadOr404(idOrSlug);
    const known = new Set((await catalogRepository.listCadences()).map((c) => c.id));
    for (const r of rows) {
      if (!known.has(r.cadenceId)) {
        throw ApiError.badRequest("Unknown cadence", { code: "UNKNOWN_CADENCE_ID", id: r.cadenceId });
      }
    }

    const before = svc.recurring.map((r) => ({ cadenceId: r.cadenceId, pct: r.discountPercent, on: r.isActive }));
    await catalogRepository.putRecurring(svc.id, rows);

    await this.audit(actor, "catalog.recurring.update", svc.id, before, rows);
    this.revalidate(svc.slug);
    return this.getForEdit(svc.id);
  }

  // ── Global cadences ──────────────────────────────────────────────────────

  async listCadences(): Promise<CadenceView[]> {
    return (await catalogRepository.listCadences()).map((c) => this.serializeCadence(c));
  }

  async createCadence(
    dto: { label: string; interval: "NONE" | "WEEK" | "MONTH"; intervalCount: number },
    actor: Actor,
  ): Promise<CadenceView> {
    const taken = new Set((await catalogRepository.cadenceKeys()).map((k) => k.key));
    const existing = await catalogRepository.listCadences();
    const created = await catalogRepository.createCadence({
      key: keyFrom(dto.label, taken),
      label: dto.label,
      interval: dto.interval,
      intervalCount: dto.intervalCount,
      sortOrder: existing.length,
    });
    await this.audit(actor, "catalog.cadence.create", created.id, null, { label: created.label });
    return this.serializeCadence(created);
  }

  async patchCadence(id: string, dto: Prisma.RecurringCadenceUncheckedUpdateInput, actor: Actor): Promise<CadenceView> {
    const cadence = await catalogRepository.findCadence(id);
    if (!cadence) throw ApiError.notFound("Cadence not found", { code: "CADENCE_NOT_FOUND" });
    // Every booking points at the one-time cadence, so deactivating it would
    // break booking creation outright. Relabelling it is fine.
    if (cadence.isSystem && dto.status && dto.status !== ConfigStatus.ACTIVE) {
      throw ApiError.badRequest("The one-time frequency can't be deactivated — every booking depends on it", {
        code: "CADENCE_IS_SYSTEM",
      });
    }
    const before = { label: cadence.label, status: cadence.status };
    const updated = await catalogRepository.updateCadence(id, dto);
    await this.audit(actor, "catalog.cadence.update", id, before, { label: updated.label, status: updated.status });
    return this.serializeCadence(updated);
  }

  // ── Plans ────────────────────────────────────────────────────────────────

  async listPlans(): Promise<PlanView[]> {
    return (await catalogRepository.listPlans()).map((p) => this.serializePlan(p));
  }

  async createPlan(
    dto: {
      serviceId: string;
      cadenceId: string;
      name: string;
      bullets: string[];
      price: number;
      priceType: "PER_VISIT" | "PER_MONTH" | "FLAT";
      featured?: boolean;
      sortOrder?: number;
    },
    actor: Actor,
  ): Promise<PlanView> {
    const svc = await catalogRepository.findServiceForEdit(dto.serviceId);
    if (!svc) throw ApiError.notFound("Service not found", { code: "SERVICE_NOT_FOUND" });
    const cadence = await catalogRepository.findCadence(dto.cadenceId);
    if (!cadence) throw ApiError.notFound("Cadence not found", { code: "CADENCE_NOT_FOUND" });
    if (cadence.interval === "NONE") {
      throw ApiError.badRequest("Plans are recurring — pick a recurring cadence", {
        code: "PLAN_CADENCE_NOT_RECURRING",
      });
    }

    const created = await catalogRepository.createPlan({
      serviceId: dto.serviceId,
      cadenceId: dto.cadenceId,
      name: dto.name,
      bullets: dto.bullets,
      price: dto.price,
      priceType: dto.priceType,
      featured: dto.featured ?? false,
      sortOrder: dto.sortOrder ?? 0,
    });
    const wired = await this.ensureStripeWiring(created.id);

    await this.audit(actor, "catalog.plan.create", created.id, null, { name: created.name, price: created.price });
    this.revalidate(svc.slug);
    return this.serializePlan(wired ?? created);
  }

  async patchPlan(id: string, dto: Prisma.ServicePlanUncheckedUpdateInput, actor: Actor): Promise<PlanView> {
    const plan = await catalogRepository.findPlan(id);
    if (!plan) throw ApiError.notFound("Plan not found", { code: "PLAN_NOT_FOUND" });
    if (typeof dto.cadenceId === "string") {
      const cadence = await catalogRepository.findCadence(dto.cadenceId);
      if (!cadence) throw ApiError.notFound("Cadence not found", { code: "CADENCE_NOT_FOUND" });
      if (cadence.interval === "NONE") {
        throw ApiError.badRequest("Plans are recurring — pick a recurring cadence", {
          code: "PLAN_CADENCE_NOT_RECURRING",
        });
      }
      // The $0 anchor price encodes the billing interval: a cadence change
      // invalidates it (a fresh one is provisioned below).
      if (dto.cadenceId !== plan.cadenceId) dto.stripePriceId = null;
    }

    const before = { name: plan.name, price: plan.price, status: plan.status };
    let updated = await catalogRepository.updatePlan(id, dto);
    updated = (await this.ensureStripeWiring(id)) ?? updated;

    await this.audit(actor, "catalog.plan.update", id, before, {
      name: updated.name,
      price: updated.price,
      status: updated.status,
    });
    this.revalidate(updated.service.slug);
    return this.serializePlan(updated);
  }

  /**
   * Provision the plan's Stripe objects when missing: a product plus a $0
   * ANCHOR price carrying the billing interval — the real amount is added per
   * cycle as an invoice item (plan.price + tax), so plan price edits never
   * need a Stripe round-trip. No-ops gracefully when Stripe isn't configured
   * (the plan stays display-only until subscribe, which guards on
   * stripePriceId).
   */
  private async ensureStripeWiring(planId: string) {
    if (!env.STRIPE_SECRET_KEY) return null;
    const plan = await catalogRepository.listPlans().then((all) => all.find((p) => p.id === planId));
    if (!plan || plan.status !== "ACTIVE" || plan.stripePriceId) return null;

    const cadence = await catalogRepository.findCadence(plan.cadenceId);
    if (!cadence || cadence.interval === "NONE") return null;

    try {
      const stripe = getStripe();
      let productId = plan.stripeProductId;
      if (!productId) {
        const product = await stripe.products.create({
          name: `${plan.service.name} — ${plan.name}`,
          metadata: { ...brandMetadata(), planId: plan.id },
        });
        productId = product.id;
      }
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: 0, // $0 cadence anchor; the binding amount bills per cycle as an invoice item
        currency: "usd",
        recurring: {
          interval: cadence.interval.toLowerCase() as "week" | "month",
          interval_count: cadence.intervalCount,
        },
        metadata: brandMetadata(),
      });
      return await catalogRepository.updatePlan(plan.id, { stripeProductId: productId, stripePriceId: price.id });
    } catch (err) {
      // Never block plan management on Stripe availability; subscribe stays gated.
      logger.error(`[catalog] Stripe wiring failed for plan ${planId}: ${String(err)}`);
      return null;
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async loadOr404(idOrSlug: string): Promise<ServiceForEdit> {
    const svc = await catalogRepository.findServiceForEdit(idOrSlug);
    if (!svc) throw ApiError.notFound("Service not found", { code: "SERVICE_NOT_FOUND" });
    return svc;
  }

  private audit(actor: Actor, action: string, entityId: string, before: unknown, after: unknown) {
    return auditService.record({
      actorUserId: actor.userId,
      action,
      entityType: "Service",
      entityId,
      before,
      after,
      ip: actor.ip ?? null,
    });
  }

  private revalidate(slug: string) {
    // Bust the marketing client's ISR cache for this service (fire-and-forget).
    void pingClientRevalidate(["catalog", `service:${slug}`]);
  }

  private snapshot(svc: ServiceForEdit) {
    return {
      pricingMode: svc.pricingMode,
      basePrice: svc.basePrice,
      taxRateBps: svc.taxRateBps,
      options: svc.configGroups.flatMap((g) => g.options.map((o) => ({ id: o.id, priceDelta: o.priceDelta }))),
    };
  }

  private async serialize(svc: ServiceForEdit): Promise<ServiceEditView> {
    // Full grid: every ACTIVE global cadence, joined with this service's rows.
    const cadences = await catalogRepository.activeCadences();
    const bySvc = new Map(svc.recurring.map((r) => [r.cadenceId, r]));
    return {
      id: svc.id,
      slug: svc.slug,
      name: svc.name,
      pricingMode: svc.pricingMode,
      basePrice: svc.basePrice,
      taxRateBps: svc.taxRateBps,
      currency: svc.currency,
      typicalDuration: svc.typicalDuration,
      groups: svc.configGroups.map((g) => ({
        id: g.id,
        key: g.key,
        label: g.label,
        description: g.description,
        inputType: g.inputType,
        isRequired: g.isRequired,
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
      })),
      recurring: cadences.map((c) => ({
        cadenceId: c.id,
        key: c.key,
        label: c.label,
        discountPercent: bySvc.get(c.id)?.discountPercent ?? 0,
        isActive: bySvc.get(c.id)?.isActive ?? false,
      })),
    };
  }

  private serializeCadence(c: Awaited<ReturnType<typeof catalogRepository.listCadences>>[number]): CadenceView {
    return {
      id: c.id,
      key: c.key,
      label: c.label,
      interval: c.interval,
      intervalCount: c.intervalCount,
      sortOrder: c.sortOrder,
      status: c.status,
    };
  }

  private serializePlan(p: Awaited<ReturnType<typeof catalogRepository.listPlans>>[number]): PlanView {
    return {
      id: p.id,
      serviceId: p.serviceId,
      serviceName: p.service.name,
      serviceSlug: p.service.slug,
      cadenceId: p.cadenceId,
      cadenceLabel: p.cadence.label,
      name: p.name,
      bullets: p.bullets,
      price: p.price,
      priceType: p.priceType,
      featured: p.featured,
      sortOrder: p.sortOrder,
      status: p.status,
    };
  }
}

export const catalogService = new CatalogService();
