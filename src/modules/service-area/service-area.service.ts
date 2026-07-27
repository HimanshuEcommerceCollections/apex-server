import { coverageRepository } from "./service-area.repository";
import { zipCodesService } from "../zip-codes";
import { servicesRepository } from "../services";
import { areasService } from "../areas";
import { CoverageEffect } from "../../enums";
import { ApiError } from "../../utils/api-error";
import type { AvailabilityResult, CoverageView, ZipOverrideInput } from "./service-area.types";

async function resolveServiceId(idOrSlug: string): Promise<string> {
  const svc = await servicesRepository.findByIdOrSlug(idOrSlug);
  if (!svc) throw ApiError.notFound("Service not found", { code: "SERVICE_NOT_FOUND", idOrSlug });
  return svc.id;
}

export class AvailabilityService {
  /** General zip gate (no service): is this ZIP in an active area at all? */
  async validateZip(zip: string): Promise<AvailabilityResult> {
    const z = await zipCodesService.findServiceableByCode(zip);
    if (!z) return { zip, eligible: false, area: null, reason: "We don't currently serve this ZIP code." };
    return { zip, eligible: true, area: { name: z.area.name, slug: z.area.slug }, reason: null };
  }

  /**
   * Per-service availability (grant + override, most-specific-wins — docs 08 §6).
   * 1) ZIP must be active in an active area; 2) a ZIP override wins; 3) else the area grant.
   */
  async isServiceAvailable(serviceIdOrSlug: string, zip: string): Promise<AvailabilityResult> {
    const serviceId = await resolveServiceId(serviceIdOrSlug);
    const z = await zipCodesService.findServiceableByCode(zip);
    if (!z) return { zip, eligible: false, area: null, reason: "We don't currently serve this ZIP code." };

    const area = { name: z.area.name, slug: z.area.slug };

    const override = await coverageRepository.findZipOverride(serviceId, z.id);
    if (override) {
      const eligible = override.effect === CoverageEffect.INCLUDE;
      return { zip, eligible, area, reason: eligible ? null : "This service isn't offered at your ZIP code." };
    }

    const grant = await coverageRepository.findServiceAreaGrant(serviceId, z.areaId);
    return {
      zip,
      eligible: Boolean(grant),
      area,
      reason: grant ? null : "This service isn't offered in your area yet.",
    };
  }
}

export class CoverageService {
  async getCoverage(serviceIdOrSlug: string): Promise<CoverageView> {
    const serviceId = await resolveServiceId(serviceIdOrSlug);
    const [grants, overrides] = await Promise.all([
      coverageRepository.findServiceAreas(serviceId),
      coverageRepository.findZipCoverage(serviceId),
    ]);
    return {
      serviceId,
      grantedAreaIds: grants.map((g) => g.areaId),
      overrides: overrides.map((o) => ({ zipCodeId: o.zipCodeId, effect: o.effect })),
    };
  }

  async setCoverage(
    serviceIdOrSlug: string,
    input: { areaIds: string[]; zipOverrides: ZipOverrideInput[] },
  ): Promise<CoverageView> {
    const serviceId = await resolveServiceId(serviceIdOrSlug);
    // Validate every referenced area exists (friendly error before the FK would fire).
    await Promise.all(input.areaIds.map((id) => areasService.getOrThrow(id)));
    const areaIds = [...new Set(input.areaIds)];
    const overrides = dedupeOverrides(input.zipOverrides);
    await coverageRepository.replaceCoverage(serviceId, areaIds, overrides);
    return this.getCoverage(serviceId);
  }
}

function dedupeOverrides(list: ZipOverrideInput[]): ZipOverrideInput[] {
  const map = new Map<string, ZipOverrideInput>();
  for (const o of list) map.set(o.zipCodeId, o); // last write wins per ZIP
  return [...map.values()];
}

export const availabilityService = new AvailabilityService();
export const coverageService = new CoverageService();
