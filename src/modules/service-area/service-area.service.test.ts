import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findByIdOrSlug: vi.fn(),
  findServiceableByCode: vi.fn(),
  findZipOverride: vi.fn(),
  findServiceAreaGrant: vi.fn(),
  findServiceAreas: vi.fn(),
  findZipCoverage: vi.fn(),
  replaceCoverage: vi.fn(),
  getOrThrow: vi.fn(),
}));

vi.mock("../services", () => ({ servicesRepository: { findByIdOrSlug: m.findByIdOrSlug } }));
vi.mock("../zip-codes", () => ({ zipCodesService: { findServiceableByCode: m.findServiceableByCode } }));
vi.mock("../areas", () => ({ areasService: { getOrThrow: m.getOrThrow } }));
vi.mock("./service-area.repository", () => ({
  coverageRepository: {
    findZipOverride: m.findZipOverride,
    findServiceAreaGrant: m.findServiceAreaGrant,
    findServiceAreas: m.findServiceAreas,
    findZipCoverage: m.findZipCoverage,
    replaceCoverage: m.replaceCoverage,
  },
}));

import { availabilityService, coverageService } from "./service-area.service";

const dallasZip = (id: string) => ({ id, areaId: "dallas", area: { name: "Dallas", slug: "dallas" } });

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.findByIdOrSlug.mockResolvedValue({ id: "svc1" });
  m.findZipOverride.mockResolvedValue(null);
  m.findServiceAreaGrant.mockResolvedValue(null);
});

describe("isServiceAvailable — grant + override resolution (docs 08)", () => {
  it("unknown/inactive ZIP is not serviceable", async () => {
    m.findServiceableByCode.mockResolvedValue(null);
    const r = await availabilityService.isServiceAvailable("house-cleaning", "99999");
    expect(r.eligible).toBe(false);
    expect(r.reason).toMatch(/don't currently serve/i);
  });

  it("Scenario 1 — area granted, ZIP excluded", async () => {
    m.findServiceAreaGrant.mockResolvedValue({ id: "g1" }); // Dallas granted
    // 75001: no override -> follows area grant -> available
    m.findServiceableByCode.mockResolvedValue(dallasZip("z1"));
    m.findZipOverride.mockResolvedValue(null);
    expect((await availabilityService.isServiceAvailable("house-cleaning", "75001")).eligible).toBe(true);
    // 75002: EXCLUDE override -> unavailable despite the grant
    m.findServiceableByCode.mockResolvedValue(dallasZip("z2"));
    m.findZipOverride.mockResolvedValue({ effect: "EXCLUDE" });
    expect((await availabilityService.isServiceAvailable("house-cleaning", "75002")).eligible).toBe(false);
  });

  it("Scenario 2 — whole area granted, no overrides", async () => {
    m.findServiceableByCode.mockResolvedValue(dallasZip("z3"));
    m.findServiceAreaGrant.mockResolvedValue({ id: "g1" });
    expect((await availabilityService.isServiceAvailable("lawn-care", "75003")).eligible).toBe(true);
  });

  it("Scenario 3 — no area grant, ZIP-level INCLUDE only", async () => {
    m.findServiceAreaGrant.mockResolvedValue(null); // Dallas NOT granted
    // 75003 explicitly included
    m.findServiceableByCode.mockResolvedValue(dallasZip("z3"));
    m.findZipOverride.mockResolvedValue({ effect: "INCLUDE" });
    expect((await availabilityService.isServiceAvailable("window-cleaning", "75003")).eligible).toBe(true);
    // any other Dallas ZIP: no override, no grant -> unavailable
    m.findServiceableByCode.mockResolvedValue(dallasZip("z9"));
    m.findZipOverride.mockResolvedValue(null);
    expect((await availabilityService.isServiceAvailable("window-cleaning", "75009")).eligible).toBe(false);
  });
});

describe("setCoverage — dedupes grants and overrides (last-write-wins per ZIP)", () => {
  it("collapses duplicate areas and conflicting ZIP overrides", async () => {
    m.getOrThrow.mockResolvedValue({});
    m.replaceCoverage.mockResolvedValue(undefined);
    m.findServiceAreas.mockResolvedValue([]);
    m.findZipCoverage.mockResolvedValue([]);

    await coverageService.setCoverage("svc1", {
      areaIds: ["a1", "a1", "a2"],
      zipOverrides: [
        { zipCodeId: "z1", effect: "INCLUDE" },
        { zipCodeId: "z1", effect: "EXCLUDE" },
      ],
    });

    const [, areaIds, overrides] = m.replaceCoverage.mock.calls[0];
    expect(areaIds).toEqual(["a1", "a2"]);
    expect(overrides).toEqual([{ zipCodeId: "z1", effect: "EXCLUDE" }]);
  });
});
