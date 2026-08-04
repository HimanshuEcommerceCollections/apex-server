import { describe, expect, it } from "vitest";
import { validateSelections, type GroupDescriptor } from "./selection.validator";

const cleaningGroups: GroupDescriptor[] = [
  { key: "cleaning-type", inputType: "SELECT", isRequired: true, selectMin: null, selectMax: null, optionKeys: ["standard", "deep", "move-in-out"] },
  { key: "frequency", inputType: "SELECT", isRequired: true, selectMin: null, selectMax: null, optionKeys: ["one-time", "weekly"] },
];

const smartGroups: GroupDescriptor[] = [
  { key: "devices", inputType: "MULTISELECT", isRequired: true, selectMin: 1, selectMax: null, optionKeys: ["a", "b", "c"] },
];

const paintingGroups: GroupDescriptor[] = [
  { key: "description", inputType: "TEXTAREA", isRequired: true, selectMin: null, selectMax: null, optionKeys: [] },
];

const codes = (v: { code: string }[]) => v.map((x) => x.code);

describe("validateSelections", () => {
  it("accepts valid SELECT selections (lenient preview)", () => {
    const v = validateSelections({
      selections: { "cleaning-type": "standard", frequency: "weekly" },
      groups: cleaningGroups,
      pricingMode: "FROM",
      strict: false,
    });
    expect(v).toEqual([]);
  });

  it("rejects unknown groups and unknown option keys", () => {
    const v = validateSelections({
      selections: { nope: "x", "cleaning-type": "gold" },
      groups: cleaningGroups,
      pricingMode: "FROM",
      strict: false,
    });
    expect(codes(v)).toEqual(expect.arrayContaining(["UNKNOWN_SELECTION_GROUP", "UNKNOWN_OPTION_KEY"]));
  });

  it("enforces MULTISELECT bounds", () => {
    const v = validateSelections({
      selections: { devices: [] },
      groups: smartGroups,
      pricingMode: "FROM",
      strict: false,
    });
    expect(codes(v)).toContain("SELECT_MIN");
  });

  it("rejects a TEXTAREA value smuggled into selections", () => {
    const v = validateSelections({
      selections: { description: "paint the hall" },
      groups: paintingGroups,
      pricingMode: "QUOTE",
      strict: false,
    });
    expect(codes(v)).toContain("TEXTAREA_IN_SELECTIONS");
  });

  it("strict: requires all required groups at submit", () => {
    const v = validateSelections({
      selections: { "cleaning-type": "standard" }, // frequency missing
      groups: cleaningGroups,
      pricingMode: "FROM",
      strict: true,
    });
    expect(codes(v)).toContain("MISSING_REQUIRED_SELECTION");
  });

  it("strict: QUOTE demands a 10+ char description; FROM forbids one", () => {
    expect(
      codes(validateSelections({ selections: {}, groups: paintingGroups, pricingMode: "QUOTE", strict: true, description: "short" })),
    ).toContain("QUOTE_DESCRIPTION_REQUIRED");

    expect(
      codes(
        validateSelections({
          selections: { "cleaning-type": "standard", frequency: "weekly" },
          groups: cleaningGroups,
          pricingMode: "FROM",
          strict: true,
          description: "should not be here",
        }),
      ),
    ).toContain("DESCRIPTION_NOT_ALLOWED");
  });

  it("lenient preview does NOT enforce required groups or description", () => {
    const v = validateSelections({
      selections: { "cleaning-type": "standard" },
      groups: cleaningGroups,
      pricingMode: "FROM",
      strict: false,
    });
    expect(v).toEqual([]);
  });
});
