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
  mode: "FROM" | "QUOTE";
  // cents; the engine base (× quantity) AND the listed "from $X" — the payable
  // minimum. Deltas below are tuned so the cheapest required configuration costs
  // exactly this (cheapest option of every required group = 0). Default 0 = the
  // service lists no from-price.
  basePrice?: number;
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

// Display-only membership plans (marketing catalog cards). No Stripe IDs yet — they
// drive the /membership-plans pricing but can't be subscribed to until Stripe is
// configured and the plans are wired (admin createPlan). fromPrice is the member
// "from $X / visit" teaser (admin-editable).
export interface SeedMembershipPlan {
  key: string;
  name: string;
  serviceSlug: string;
  interval: "WEEK" | "MONTH";
  intervalCount: number;
  fromPrice: number; // cents
}

export const MEMBERSHIP_PLANS: SeedMembershipPlan[] = [
  { key: "cleaning", name: "Home Cleaning", serviceSlug: "cleaning", interval: "WEEK", intervalCount: 2, fromPrice: 14900 },
  { key: "lawn-care", name: "Lawn Care", serviceSlug: "lawn-care", interval: "WEEK", intervalCount: 1, fromPrice: 5300 },
  { key: "pool", name: "Pool Service", serviceSlug: "pool", interval: "WEEK", intervalCount: 1, fromPrice: 11900 },
  { key: "power-washing", name: "Power Washing", serviceSlug: "power-washing", interval: "MONTH", intervalCount: 3, fromPrice: 7900 },
];

// Display labels for the pricing Compare table (admin-editable). recurringDiscount
// null renders an em-dash.
export const COMPARE_LABELS: Record<string, { typicalDuration: string; recurringDiscount: string | null }> = {
  "cleaning": { typicalDuration: "2–3 hrs", recurringDiscount: "up to 15%" },
  "lawn-care": { typicalDuration: "30–60 min", recurringDiscount: "up to 15%" },
  "power-washing": { typicalDuration: "2–4 hrs", recurringDiscount: null },
  "painting": { typicalDuration: "1–3 days", recurringDiscount: null },
  "junk-removal": { typicalDuration: "1–2 hrs", recurringDiscount: null },
  "pool": { typicalDuration: "45–60 min", recurringDiscount: "up to 10%" },
  "pest-control": { typicalDuration: "~45 min", recurringDiscount: "up to 10%" },
  "home-security": { typicalDuration: "Consultation", recurringDiscount: null },
  "smart-home": { typicalDuration: "1–4 hrs", recurringDiscount: "15% (3+)" },
  "handyman": { typicalDuration: "Per block", recurringDiscount: null },
  "tree-stump": { typicalDuration: "Varies", recurringDiscount: null },
};

// ── Service-page "Recurring plans" cards (admin-editable via /admin/recurring-plans).
// Amounts are display strings only (never summed by the pricing engine).
export interface SeedRecurringPlan {
  name: string;
  freq: string;
  amount: string;
  unit?: string;
  disc?: string;
  best?: boolean;
  cta: string;
}
export interface SeedRecurringSection {
  heading: string;
  plans: SeedRecurringPlan[];
}

const DEFAULT_RECURRING_HEADING = "Book once. Never think about it again.";

/** The standard one-time / weekly / biweekly trio most services show. */
const stdRecurring = (amount: string): SeedRecurringPlan[] => [
  { name: "One-time", freq: "Single visit", amount, cta: "Choose one-time" },
  { name: "Weekly", freq: "Every week", amount, unit: "/visit", disc: "Save 15%", best: true, cta: "Choose weekly" },
  { name: "Biweekly", freq: "Every 2 weeks", amount, unit: "/visit", disc: "Save 10%", cta: "Choose biweekly" },
];

export const RECURRING_PLANS: Record<string, SeedRecurringSection> = {
  "cleaning": {
    heading: DEFAULT_RECURRING_HEADING,
    plans: [
      { name: "One-time", freq: "Single visit", amount: "$170", cta: "Choose one-time" },
      { name: "Weekly", freq: "Every week", amount: "$133", unit: "/visit", disc: "Save 22%", best: true, cta: "Choose weekly" },
      { name: "Biweekly", freq: "Every 2 weeks", amount: "$145", unit: "/visit", disc: "Save 15%", cta: "Choose biweekly" },
      { name: "Monthly", freq: "Every month", amount: "$156", unit: "/visit", disc: "Save 8%", cta: "Choose monthly" },
    ],
  },
  "lawn-care": {
    heading: "Book once. Never chase a mow again.",
    plans: [
      { name: "One-time", freq: "Single visit", amount: "$59", cta: "Choose one-time" },
      { name: "Weekly", freq: "Every week", amount: "$53", unit: "/visit", disc: "Save 10%", best: true, cta: "Choose weekly" },
      { name: "Biweekly", freq: "Every 2 weeks", amount: "$56", unit: "/visit", disc: "Save 5%", cta: "Choose biweekly" },
    ],
  },
  "power-washing": { heading: DEFAULT_RECURRING_HEADING, plans: stdRecurring("$79") },
  "painting": { heading: DEFAULT_RECURRING_HEADING, plans: stdRecurring("$349") },
  "junk-removal": { heading: DEFAULT_RECURRING_HEADING, plans: stdRecurring("$99") },
  "pool": { heading: DEFAULT_RECURRING_HEADING, plans: stdRecurring("$119") },
  "pest-control": { heading: DEFAULT_RECURRING_HEADING, plans: stdRecurring("$99") },
  "home-security": { heading: DEFAULT_RECURRING_HEADING, plans: stdRecurring("$199") },
  "smart-home": { heading: DEFAULT_RECURRING_HEADING, plans: stdRecurring("$149") },
  "handyman": { heading: DEFAULT_RECURRING_HEADING, plans: stdRecurring("$95") },
  "tree-stump": { heading: DEFAULT_RECURRING_HEADING, plans: stdRecurring("$199") },
};

// Deltas are increments over the 1-bed/1-bath baseline (already in basePrice),
// so the cheapest configuration prices at exactly the listed base.
const bedroomsOptions: SeedOption[] = [1, 2, 3, 4, 5].map((n) => ({
  key: String(n),
  label: `${n} bedroom${n > 1 ? "s" : ""}`,
  delta: (n - 1) * 2500,
}));
const bathroomsOptions: SeedOption[] = [1, 2, 3, 4].map((n) => ({
  key: String(n),
  label: `${n} bathroom${n > 1 ? "s" : ""}`,
  delta: (n - 1) * 1500,
}));

export const SERVICES: SeedService[] = [
  {
    slug: "cleaning",
    name: "Home Cleaning",
    summary: "Recurring or one-time cleaning, priced by beds, baths, and clean type.",
    description: "Professional home cleaning across Wake County — standard, deep, and move in/out cleans.",
    categorySlug: "recurring-core",
    mode: "FROM",
    isRecurringEligible: true,
    basePrice: 14900, // "from $149": a 1-bed/1-bath standard clean costs exactly this
    badges: ["Background-checked pros", "Supplies included"],
    groups: [
      {
        key: "cleaning-type",
        label: "Cleaning type",
        inputType: "SELECT",
        uiHint: "matrix-axis",
        isRequired: true,
        options: [
          { key: "standard", label: "Standard", delta: 0 },
          { key: "deep", label: "Deep Clean", delta: 5000 },
          { key: "move-in-out", label: "Move In/Out", delta: 10000 },
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
    mode: "FROM",
    isRecurringEligible: true,
    basePrice: 7900, // "from $79": a small-yard mow & edge costs exactly this
    badges: ["Same crew each visit"],
    groups: [
      {
        key: "lot-size",
        label: "Lot size",
        inputType: "SELECT",
        isRequired: true,
        options: [
          { key: "small", label: "Small yard", sublabel: "Up to 1/4 acre", delta: 0 },
          { key: "medium", label: "Medium yard", sublabel: "1/4 to 1/2 acre", delta: 2000 },
          { key: "large", label: "Large yard", sublabel: "1/2 to 1 acre", delta: 4500 },
          { key: "xlarge", label: "Extra large yard", sublabel: "1+ acre", delta: 8500 },
        ],
      },
      {
        key: "service",
        label: "Service",
        inputType: "SELECT",
        isRequired: true,
        options: [
          { key: "mow", label: "Mow & edge", delta: 0 },
          { key: "full", label: "Full care +", delta: 1500 },
        ],
      },
      {
        key: "frequency",
        label: "Frequency",
        inputType: "SELECT",
        uiHint: "frequency",
        isRequired: true,
        options: [
          { key: "one-time", label: "One-time", delta: 0 },
          { key: "weekly", label: "Weekly", sublabel: "Save 10%", delta: 0 },
          { key: "biweekly", label: "Every two weeks", sublabel: "Save 5%", delta: 0 },
        ],
      },
    ],
    rules: [
      { key: "lawn-weekly-discount", label: "Weekly plan discount", trigger: { kind: "option_selected", group: "frequency", option: "weekly" }, effect: { kind: "discount", calc: "percent", value: 10 }, sortOrder: 1 },
      { key: "lawn-biweekly-discount", label: "Bi-weekly plan discount", trigger: { kind: "option_selected", group: "frequency", option: "biweekly" }, effect: { kind: "discount", calc: "percent", value: 5 }, sortOrder: 2 },
    ],
  },
  {
    slug: "pool",
    name: "Pool Service",
    summary: "Skim, vacuum, brush & balance — priced by pool size and cadence.",
    description: "Weekly, bi-weekly, or monthly pool maintenance with equipment health checks.",
    categorySlug: "recurring-core",
    mode: "FROM",
    isRecurringEligible: true,
    basePrice: 9900, // "from $99": a weekly standard clean costs exactly this per visit
    groups: [
      {
        key: "frequency",
        label: "Service frequency",
        inputType: "SELECT",
        uiHint: "frequency",
        isRequired: true,
        options: [
          { key: "one-time", label: "One-time", delta: 3000 },
          { key: "weekly", label: "Weekly", delta: 0 },
          { key: "biweekly", label: "Every two weeks", delta: 1000 },
          { key: "monthly", label: "Monthly", delta: 2000 },
        ],
      },
      {
        key: "type",
        label: "Service type",
        inputType: "SELECT",
        isRequired: true,
        options: [
          { key: "standard", label: "Standard clean", delta: 0 },
          { key: "green", label: "Green-to-clean +", delta: 8000 },
        ],
      },
    ],
    rules: [],
  },
  {
    slug: "pest-control",
    name: "Pest Control",
    summary: "Protection plans for common household pests.",
    description: "One-time or recurring pest treatment. Final plan confirmed by a licensed pro.",
    categorySlug: "recurring-core",
    mode: "FROM",
    isRecurringEligible: true,
    basePrice: 8900, // "from $89": a general apartment treatment costs exactly this
    claimsBlock: "NC pesticide-application licensing expectations are collected from pros and shown for transparency; Apex does not itself hold the license.",
    groups: [
      {
        key: "property",
        label: "Property",
        inputType: "SELECT",
        isRequired: true,
        options: [
          { key: "apt", label: "Apartment", delta: 0 },
          { key: "house", label: "House", delta: 2000 },
          { key: "large", label: "Large home", delta: 5000 },
        ],
      },
      {
        key: "service",
        label: "Service",
        inputType: "SELECT",
        isRequired: true,
        options: [
          { key: "general", label: "General pest", delta: 0 },
          { key: "mosquito", label: "Mosquito +", delta: 3000 },
          { key: "termite", label: "Termite", delta: 0 },
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
    mode: "FROM",
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
    mode: "FROM",
    groups: [
      {
        key: "devices",
        label: "Choose your devices",
        inputType: "MULTISELECT",
        uiHint: "device-checklist",
        isRequired: true,
        selectMin: 1,
        options: [
          { key: "thermo", label: "Smart thermostat", delta: 12900 },
          { key: "doorbell", label: "Video doorbell", delta: 14900 },
          { key: "cam", label: "Cameras (2-pack)", delta: 19900 },
          { key: "lock", label: "Smart locks", delta: 13900 },
          { key: "light", label: "Lighting kit", delta: 11900 },
          { key: "hub", label: "Central hub", delta: 9900 },
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
    basePrice: 19900, // "from $199": walkways-only costs exactly this (selectMin 1 makes one surface unavoidable)
    groups: [
      {
        key: "surfaces",
        label: "What needs washing?",
        inputType: "MULTISELECT",
        isRequired: true,
        selectMin: 1,
        options: [
          { key: "drive", label: "Driveway", delta: 2000 },
          { key: "siding", label: "House siding", delta: 7000 },
          { key: "deck", label: "Deck / patio", delta: 4000 },
          { key: "fence", label: "Fence", delta: 1000 },
          { key: "roof", label: "Roof / gutters", delta: 12000 },
          { key: "walk", label: "Walkways", delta: 0 },
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
    // $95/hr; engine multiplies by quantity = estimated hours. Deliberately NOT
    // set from the old $150 compare-table teaser: this base carries engine
    // meaning, so the site now lists "from $95" (one honest hour).
    basePrice: 9500,
    groups: [
      {
        key: "kind",
        label: "Task type",
        inputType: "SELECT",
        isRequired: true,
        options: [
          { key: "general", label: "Small repair", delta: 0 },
          { key: "mount", label: "Mount / hang", delta: 0 },
          { key: "assemble", label: "Assembly", delta: 0 },
          { key: "multi", label: "Punch list", delta: 0 },
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

// One area PER CITY -- the coverage list on the home page is the set of active
// areas, so each city carries its own response-time label. `duration` is only
// applied when an area is first created; admin edits win on re-seed.
//
// NOTE: `zipCode` is globally unique among non-deleted rows, so a ZIP belongs to
// exactly one city. Each city is padded to 10 ZIPs -- the first few are its real
// USPS ZIPs, the rest are neighbouring Triangle-area ZIPs assigned to the closest
// serving city (Holly Springs, Garner, Knightdale, Fuquay-Varina and Morrisville
// only have 1-2 ZIPs of their own). `city` records each ZIP's true postal city,
// which is why the coverage list reads area names and not ZIP cities.
export const AREAS: SeedArea[] = [
  {
    slug: "cary",
    name: "Cary",
    duration: "15 MIN",
    zips: [
      { zipCode: "27511", city: "Cary", state: "NC" },
      { zipCode: "27512", city: "Cary", state: "NC" },
      { zipCode: "27513", city: "Cary", state: "NC" },
      { zipCode: "27518", city: "Cary", state: "NC" },
      { zipCode: "27519", city: "Cary", state: "NC" },
      { zipCode: "27613", city: "Raleigh", state: "NC" },
      { zipCode: "27703", city: "Durham", state: "NC" },
      { zipCode: "27707", city: "Durham", state: "NC" },
      { zipCode: "27709", city: "Research Triangle Park", state: "NC" },
      { zipCode: "27713", city: "Durham", state: "NC" },
    ],
  },
  {
    slug: "apex",
    name: "Apex",
    duration: "18 MIN",
    zips: [
      { zipCode: "27502", city: "Apex", state: "NC" },
      { zipCode: "27523", city: "Apex", state: "NC" },
      { zipCode: "27539", city: "Apex", state: "NC" },
      { zipCode: "27562", city: "New Hill", state: "NC" },
      { zipCode: "27559", city: "Moncure", state: "NC" },
      { zipCode: "27312", city: "Pittsboro", state: "NC" },
      { zipCode: "27514", city: "Chapel Hill", state: "NC" },
      { zipCode: "27515", city: "Chapel Hill", state: "NC" },
      { zipCode: "27516", city: "Chapel Hill", state: "NC" },
      { zipCode: "27517", city: "Chapel Hill", state: "NC" },
    ],
  },
  {
    slug: "morrisville",
    name: "Morrisville",
    duration: "20 MIN",
    zips: [
      { zipCode: "27560", city: "Morrisville", state: "NC" },
      { zipCode: "27617", city: "Raleigh", state: "NC" },
      { zipCode: "27701", city: "Durham", state: "NC" },
      { zipCode: "27702", city: "Durham", state: "NC" },
      { zipCode: "27704", city: "Durham", state: "NC" },
      { zipCode: "27705", city: "Durham", state: "NC" },
      { zipCode: "27706", city: "Durham", state: "NC" },
      { zipCode: "27708", city: "Durham", state: "NC" },
      { zipCode: "27710", city: "Durham", state: "NC" },
      { zipCode: "27712", city: "Durham", state: "NC" },
    ],
  },
  {
    slug: "raleigh",
    name: "Raleigh",
    duration: "22 MIN",
    zips: [
      { zipCode: "27601", city: "Raleigh", state: "NC" },
      { zipCode: "27603", city: "Raleigh", state: "NC" },
      { zipCode: "27604", city: "Raleigh", state: "NC" },
      { zipCode: "27605", city: "Raleigh", state: "NC" },
      { zipCode: "27606", city: "Raleigh", state: "NC" },
      { zipCode: "27607", city: "Raleigh", state: "NC" },
      { zipCode: "27608", city: "Raleigh", state: "NC" },
      { zipCode: "27609", city: "Raleigh", state: "NC" },
      { zipCode: "27610", city: "Raleigh", state: "NC" },
      { zipCode: "27612", city: "Raleigh", state: "NC" },
    ],
  },
  {
    slug: "holly-springs",
    name: "Holly Springs",
    duration: "25 MIN",
    zips: [
      { zipCode: "27540", city: "Holly Springs", state: "NC" },
      { zipCode: "27592", city: "Willow Spring", state: "NC" },
      { zipCode: "27505", city: "Broadway", state: "NC" },
      { zipCode: "27330", city: "Sanford", state: "NC" },
      { zipCode: "27331", city: "Sanford", state: "NC" },
      { zipCode: "27332", city: "Sanford", state: "NC" },
      { zipCode: "27207", city: "Bear Creek", state: "NC" },
      { zipCode: "27208", city: "Bennett", state: "NC" },
      { zipCode: "27213", city: "Goldston", state: "NC" },
      { zipCode: "27344", city: "Siler City", state: "NC" },
    ],
  },
  {
    slug: "garner",
    name: "Garner",
    duration: "28 MIN",
    zips: [
      { zipCode: "27529", city: "Garner", state: "NC" },
      { zipCode: "27520", city: "Clayton", state: "NC" },
      { zipCode: "27527", city: "Clayton", state: "NC" },
      { zipCode: "27577", city: "Smithfield", state: "NC" },
      { zipCode: "27576", city: "Selma", state: "NC" },
      { zipCode: "27524", city: "Four Oaks", state: "NC" },
      { zipCode: "27504", city: "Benson", state: "NC" },
      { zipCode: "27568", city: "Pine Level", state: "NC" },
      { zipCode: "27569", city: "Princeton", state: "NC" },
      { zipCode: "27593", city: "Wilsons Mills", state: "NC" },
    ],
  },
  {
    slug: "wake-forest",
    name: "Wake Forest",
    duration: "30 MIN",
    zips: [
      { zipCode: "27587", city: "Wake Forest", state: "NC" },
      { zipCode: "27588", city: "Wake Forest", state: "NC" },
      { zipCode: "27614", city: "Raleigh", state: "NC" },
      { zipCode: "27615", city: "Raleigh", state: "NC" },
      { zipCode: "27571", city: "Rolesville", state: "NC" },
      { zipCode: "27596", city: "Youngsville", state: "NC" },
      { zipCode: "27525", city: "Franklinton", state: "NC" },
      { zipCode: "27549", city: "Louisburg", state: "NC" },
      { zipCode: "27522", city: "Creedmoor", state: "NC" },
      { zipCode: "27509", city: "Butner", state: "NC" },
    ],
  },
  {
    slug: "fuquay-varina",
    name: "Fuquay-Varina",
    duration: "35 MIN",
    zips: [
      { zipCode: "27526", city: "Fuquay-Varina", state: "NC" },
      { zipCode: "27501", city: "Angier", state: "NC" },
      { zipCode: "27546", city: "Lillington", state: "NC" },
      { zipCode: "27543", city: "Kipling", state: "NC" },
      { zipCode: "27521", city: "Coats", state: "NC" },
      { zipCode: "27506", city: "Buies Creek", state: "NC" },
      { zipCode: "28323", city: "Bunnlevel", state: "NC" },
      { zipCode: "28334", city: "Dunn", state: "NC" },
      { zipCode: "28339", city: "Erwin", state: "NC" },
      { zipCode: "28326", city: "Cameron", state: "NC" },
    ],
  },
  {
    slug: "knightdale",
    name: "Knightdale",
    duration: "38 MIN",
    zips: [
      { zipCode: "27545", city: "Knightdale", state: "NC" },
      { zipCode: "27616", city: "Raleigh", state: "NC" },
      { zipCode: "27591", city: "Wendell", state: "NC" },
      { zipCode: "27597", city: "Zebulon", state: "NC" },
      { zipCode: "27557", city: "Middlesex", state: "NC" },
      { zipCode: "27555", city: "Micro", state: "NC" },
      { zipCode: "27542", city: "Kenly", state: "NC" },
      { zipCode: "27882", city: "Spring Hope", state: "NC" },
      { zipCode: "27856", city: "Nashville", state: "NC" },
      { zipCode: "27893", city: "Wilson", state: "NC" },
    ],
  },
];

/// Areas replaced by the per-city split above; retired (soft-deleted) by the
/// reshape script so they stop appearing in coverage.
export const RETIRED_AREA_SLUGS: string[] = ["wake-county"];

/** Which areas each service covers by default (slug -> area slugs). Absent = all areas. */
export const DEFAULT_COVERAGE: Record<string, string[]> = {}; // empty -> seed grants every service to every area
