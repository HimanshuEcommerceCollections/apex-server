// Single typed source of truth for the seed. Catalog structure/copy AND pricing
// deltas live together per service, so the id-alignment contract (config key ==
// pricing id) holds by construction — there is no second file to drift against.
// All money is integer cents. Values marked SAMPLE await product sign-off.

export type SeedInputType = "SELECT" | "MULTISELECT" | "QUANTITY" | "TOGGLE" | "TEXTAREA";

export interface SeedOption {
  key: string;
  label: string;
  sublabel?: string;
  delta: number; // cents, >= 0
}

export interface SeedGroup {
  key: string;
  label: string;
  inputType: SeedInputType;
  uiHint?: string | null;
  isRequired: boolean;
  selectMin?: number;
  selectMax?: number;
  options?: SeedOption[];
}

export type SeedTrigger =
  | { kind: "option_selected"; group: string; option: string }
  | { kind: "min_selected"; group: string; count: number };

export interface SeedRule {
  key: string;
  label: string;
  trigger: SeedTrigger;
  effect: { kind: "discount" | "fee"; calc: "percent" | "flat"; value: number };
  sortOrder: number;
}

export interface SeedService {
  slug: string;
  name: string;
  summary: string;
  description: string;
  categorySlug: string;
  mode: "PRICED" | "FROM" | "QUOTE";
  fromPrice?: number;
  isRecurringEligible?: boolean;
  badges?: string[];
  claimsBlock?: string;
  groups: SeedGroup[];
  rules: SeedRule[];
}

export const CATEGORIES = [
  { slug: "recurring-core", name: "Recurring & core", sortOrder: 0 },
  { slug: "one-time", name: "One-time projects", sortOrder: 1 },
  { slug: "specialty", name: "Specialty & quote", sortOrder: 2 },
];

const bedroomsOptions: SeedOption[] = [1, 2, 3, 4, 5].map((n) => ({
  key: String(n),
  label: `${n} bedroom${n > 1 ? "s" : ""}`,
  delta: n * 2500,
}));
const bathroomsOptions: SeedOption[] = [1, 2, 3, 4].map((n) => ({
  key: String(n),
  label: `${n} bathroom${n > 1 ? "s" : ""}`,
  delta: n * 1500,
}));

export const SERVICES: SeedService[] = [
  {
    slug: "cleaning",
    name: "Home Cleaning",
    summary: "Recurring or one-time cleaning, priced by beds, baths, and clean type.",
    description: "Professional home cleaning across Wake County — standard, deep, and move in/out cleans.",
    categorySlug: "recurring-core",
    mode: "PRICED",
    isRecurringEligible: true,
    fromPrice: 14900, // marketing "from $149" teaser (admin-editable); real price is configurator-driven
    badges: ["Background-checked pros", "Supplies included"],
    groups: [
      {
        key: "cleaning-type",
        label: "Cleaning type",
        inputType: "SELECT",
        uiHint: "matrix-axis",
        isRequired: true,
        options: [
          { key: "standard", label: "Standard", delta: 9500 },
          { key: "deep", label: "Deep Clean", delta: 14500 },
          { key: "move-in-out", label: "Move In/Out", delta: 19500 },
        ],
      },
      { key: "bedrooms", label: "Bedrooms", inputType: "SELECT", uiHint: "matrix-axis", isRequired: true, options: bedroomsOptions },
      { key: "bathrooms", label: "Bathrooms", inputType: "SELECT", uiHint: "matrix-axis", isRequired: true, options: bathroomsOptions },
      {
        key: "frequency",
        label: "Frequency",
        inputType: "SELECT",
        uiHint: "frequency",
        isRequired: true,
        options: [
          { key: "one-time", label: "One-time", delta: 0 },
          { key: "weekly", label: "Weekly", sublabel: "Save 20% (SAMPLE)", delta: 0 },
          { key: "biweekly", label: "Every two weeks", sublabel: "Save 15% (SAMPLE)", delta: 0 },
          { key: "monthly", label: "Monthly", sublabel: "Save 10% (SAMPLE)", delta: 0 },
        ],
      },
    ],
    rules: [
      { key: "freq-weekly-discount", label: "Weekly plan discount", trigger: { kind: "option_selected", group: "frequency", option: "weekly" }, effect: { kind: "discount", calc: "percent", value: 20 }, sortOrder: 1 },
      { key: "freq-biweekly-discount", label: "Bi-weekly plan discount", trigger: { kind: "option_selected", group: "frequency", option: "biweekly" }, effect: { kind: "discount", calc: "percent", value: 15 }, sortOrder: 2 },
      { key: "freq-monthly-discount", label: "Monthly plan discount", trigger: { kind: "option_selected", group: "frequency", option: "monthly" }, effect: { kind: "discount", calc: "percent", value: 10 }, sortOrder: 3 },
    ],
  },
  {
    slug: "lawn-care",
    name: "Lawn Care",
    summary: "Mow, edge, trim & blow — priced by lot size.",
    description: "Reliable recurring lawn care with the same crew each visit.",
    categorySlug: "recurring-core",
    mode: "PRICED",
    isRecurringEligible: true,
    fromPrice: 7900, // marketing "from $79" teaser
    badges: ["Same crew each visit"],
    groups: [
      {
        key: "lot-size",
        label: "Lot size",
        inputType: "SELECT",
        isRequired: true,
        options: [
          { key: "small", label: "Small yard", sublabel: "Up to 1/4 acre", delta: 4500 },
          { key: "medium", label: "Medium yard", sublabel: "1/4 to 1/2 acre", delta: 6500 },
          { key: "large", label: "Large yard", sublabel: "1/2 to 1 acre", delta: 9000 },
          { key: "xlarge", label: "Extra large yard", sublabel: "1+ acre", delta: 13000 },
        ],
      },
    ],
    rules: [],
  },
  {
    slug: "pool",
    name: "Pool Service",
    summary: "Skim, vacuum, brush & balance — priced by pool size and cadence.",
    description: "Weekly, bi-weekly, or monthly pool maintenance with equipment health checks.",
    categorySlug: "recurring-core",
    mode: "PRICED",
    isRecurringEligible: true,
    fromPrice: 9900, // marketing "from $99" teaser
    groups: [
      {
        key: "pool-size",
        label: "Pool size",
        inputType: "SELECT",
        isRequired: true,
        options: [
          { key: "small", label: "Small pool", sublabel: "Up to 15,000 gal", delta: 8900 },
          { key: "medium", label: "Medium pool", sublabel: "15,000 to 25,000 gal", delta: 12000 },
          { key: "large", label: "Large pool", sublabel: "25,000 to 40,000 gal", delta: 15900 },
          { key: "custom", label: "Custom pool", sublabel: "Over 40,000 gal", delta: 19900 },
        ],
      },
      {
        key: "frequency",
        label: "Service frequency",
        inputType: "SELECT",
        uiHint: "frequency",
        isRequired: true,
        options: [
          { key: "weekly", label: "Weekly", delta: 0 },
          { key: "biweekly", label: "Every two weeks", delta: 0 },
          { key: "monthly", label: "Monthly", sublabel: "Save 15% (SAMPLE)", delta: 0 },
        ],
      },
    ],
    rules: [
      { key: "freq-monthly-discount", label: "Monthly visit discount", trigger: { kind: "option_selected", group: "frequency", option: "monthly" }, effect: { kind: "discount", calc: "percent", value: 15 }, sortOrder: 1 },
    ],
  },
  {
    slug: "pest-control",
    name: "Pest Control",
    summary: "Protection plans for common household pests.",
    description: "One-time or recurring pest treatment. Final plan confirmed by a licensed pro.",
    categorySlug: "recurring-core",
    mode: "PRICED",
    isRecurringEligible: true,
    fromPrice: 8900, // marketing "from $89" teaser
    claimsBlock: "NC pesticide-application licensing expectations are collected from pros and shown for transparency; Apex does not itself hold the license.",
    groups: [
      {
        key: "plan",
        label: "Protection plan",
        inputType: "SELECT",
        isRequired: true,
        options: [
          { key: "one-time", label: "One-time treatment", delta: 19900 },
          { key: "quarterly", label: "Quarterly plan", sublabel: "Price per visit", delta: 9900 },
          { key: "monthly", label: "Monthly plan", sublabel: "Price per visit", delta: 7900 },
        ],
      },
      {
        key: "pest-type",
        label: "What are you dealing with?",
        inputType: "SELECT",
        isRequired: true,
        options: [
          { key: "general", label: "General prevention", delta: 0 },
          { key: "indoor", label: "Indoor issue", delta: 0 },
          { key: "outdoor", label: "Outdoor issue", delta: 0 },
          { key: "rodent", label: "Rodents / wildlife", delta: 0 },
        ],
      },
    ],
    rules: [],
  },
  {
    slug: "junk-removal",
    name: "Junk Removal",
    summary: "Haul-away priced by how full the truck gets.",
    description: "From a few items to a whole-home cleanout.",
    categorySlug: "one-time",
    mode: "PRICED",
    groups: [
      {
        key: "load-size",
        label: "How full is the truck?",
        inputType: "SELECT",
        uiHint: "load-estimator",
        isRequired: true,
        options: [
          { key: "quarter", label: "1/4 truck", sublabel: "A few items or one closet", delta: 9900 },
          { key: "half", label: "1/2 truck", sublabel: "A one-room cleanout", delta: 17900 },
          { key: "three-quarter", label: "3/4 truck", sublabel: "Several rooms of furniture", delta: 24900 },
          { key: "full", label: "Full truck", sublabel: "Whole-garage or whole-home cleanout", delta: 32900 },
        ],
      },
    ],
    rules: [],
  },
  {
    slug: "smart-home",
    name: "Smart Home Install",
    summary: "Install and set up your smart devices; bundle 3+ and save.",
    description: "Professional installation of smart plugs, cameras, thermostats, locks, and more.",
    categorySlug: "specialty",
    mode: "PRICED",
    groups: [
      {
        key: "devices",
        label: "Devices to install",
        inputType: "MULTISELECT",
        uiHint: "device-checklist",
        isRequired: true,
        selectMin: 1,
        options: [
          { key: "smart-plug-hub", label: "Smart plug / hub", delta: 4900 },
          { key: "video-doorbell", label: "Video doorbell", delta: 9900 },
          { key: "security-camera", label: "Security camera", delta: 11900 },
          { key: "smart-thermostat", label: "Smart thermostat", delta: 12900 },
          { key: "smart-lock", label: "Smart lock", delta: 14900 },
        ],
      },
    ],
    rules: [
      { key: "multi-device-discount", label: "3+ device bundle discount", trigger: { kind: "min_selected", group: "devices", count: 3 }, effect: { kind: "discount", calc: "percent", value: 15 }, sortOrder: 1 },
    ],
  },
  {
    slug: "power-washing",
    name: "Power Washing",
    summary: "Exterior surface cleaning — final pricing confirmed by your pro.",
    description: "Fence, driveway, deck, and siding cleaning. Priced from, with a pro walkthrough.",
    categorySlug: "one-time",
    mode: "FROM",
    fromPrice: 19900, // marketing "from $199"
    groups: [
      {
        key: "surfaces",
        label: "Surfaces",
        inputType: "MULTISELECT",
        isRequired: true,
        selectMin: 1,
        options: [
          { key: "fence", label: "Fence", delta: 9900 },
          { key: "driveway-sidewalk", label: "Driveway / sidewalk", delta: 12900 },
          { key: "deck-patio", label: "Deck / patio", delta: 14900 },
          { key: "house-siding", label: "House siding", delta: 19900 },
        ],
      },
    ],
    rules: [],
  },
  {
    slug: "handyman",
    name: "Handyman",
    summary: "Odd jobs and repairs — final pricing confirmed by your pro.",
    description: "From small repairs to fixture installs and TV mounting.",
    categorySlug: "one-time",
    mode: "FROM",
    fromPrice: 15000, // marketing "from $150" (compare table)
    groups: [
      {
        key: "job-type",
        label: "What do you need done?",
        inputType: "SELECT",
        isRequired: true,
        options: [
          { key: "small-repair", label: "Small repair", delta: 6500 },
          { key: "furniture-assembly", label: "Furniture assembly", delta: 7900 },
          { key: "fixture-install", label: "Fixture install", delta: 8900 },
          { key: "tv-mounting", label: "TV mounting", delta: 9900 },
        ],
      },
    ],
    rules: [],
  },
  {
    slug: "painting",
    name: "Painting",
    summary: "Interior & exterior painting — free quote.",
    description: "Tell us about your project and a pro will provide a custom quote.",
    categorySlug: "specialty",
    mode: "QUOTE",
    groups: [
      { key: "description", label: "Tell us about your project", inputType: "TEXTAREA", isRequired: true },
    ],
    rules: [],
  },
  {
    slug: "home-security",
    name: "Home Security",
    summary: "Consultation and install — free quote.",
    description: "Tell us about your home and goals; a pro will follow up with a quote.",
    categorySlug: "specialty",
    mode: "QUOTE",
    claimsBlock: "NC alarm-systems licensing expectations are collected from pros and shown for transparency; Apex does not itself hold the license.",
    groups: [
      { key: "description", label: "Tell us about your home and goals", inputType: "TEXTAREA", isRequired: true },
    ],
    rules: [],
  },
  {
    slug: "tree-stump",
    name: "Tree & Stump Removal",
    summary: "Tree and stump work — free quote.",
    description: "Describe the work and a pro will assess and quote.",
    categorySlug: "specialty",
    mode: "QUOTE",
    claimsBlock: "Arborist/insurance expectations are collected from pros and shown for transparency.",
    groups: [
      { key: "description", label: "Describe the tree or stump work", inputType: "TEXTAREA", isRequired: true },
    ],
    rules: [],
  },
];

export interface SeedArea {
  slug: string;
  name: string;
  duration?: string; // response-time label shown on coverage (admin-editable)
  zips: { zipCode: string; city: string; state: string }[];
}

export const AREAS: SeedArea[] = [
  {
    slug: "wake-county",
    name: "Wake County",
    duration: "Same day",
    zips: [
      { zipCode: "27502", city: "Apex", state: "NC" },
      { zipCode: "27523", city: "Apex", state: "NC" },
      { zipCode: "27513", city: "Cary", state: "NC" },
      { zipCode: "27518", city: "Cary", state: "NC" },
      { zipCode: "27519", city: "Cary", state: "NC" },
      { zipCode: "27540", city: "Holly Springs", state: "NC" },
      { zipCode: "27560", city: "Morrisville", state: "NC" },
      { zipCode: "27587", city: "Wake Forest", state: "NC" },
      { zipCode: "27601", city: "Raleigh", state: "NC" },
      { zipCode: "27604", city: "Raleigh", state: "NC" },
      { zipCode: "27606", city: "Raleigh", state: "NC" },
      { zipCode: "27526", city: "Fuquay-Varina", state: "NC" },
    ],
  },
];

/** Which areas each service covers by default (slug -> area slugs). Absent = all areas. */
export const DEFAULT_COVERAGE: Record<string, string[]> = {}; // empty -> seed grants every service to every area
