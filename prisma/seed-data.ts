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
  description?: string; // admin-written blurb shown under the label
  inputType: SeedInputType;
  uiHint?: string | null;
  isRequired: boolean;
  selectMin?: number;
  selectMax?: number;
  // QUANTITY groups: bounds + the pricing strategy (quantity × unitPrice).
  quantityMin?: number;
  quantityMax?: number;
  unitLabel?: string; // e.g. "per hour"
  unitPrice?: number; // cents per unit
  options?: SeedOption[];
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
}

export const CATEGORIES = [
  { slug: "recurring-core", name: "Recurring & core", sortOrder: 0 },
  { slug: "one-time", name: "One-time projects", sortOrder: 1 },
  { slug: "specialty", name: "Specialty & quote", sortOrder: 2 },
];

// MembershipPlan merged into ServicePlan — SEED_PLANS below is the one plan
// catalog (the /membership-plans page renders from it).

// Display labels for the pricing Compare table (admin-editable). The
// "Recurring discount up to X%" label is DERIVED from SEED_RECURRING now.
export const COMPARE_LABELS: Record<string, { typicalDuration: string }> = {
  "cleaning": { typicalDuration: "2–3 hrs" },
  "lawn-care": { typicalDuration: "30–60 min" },
  "power-washing": { typicalDuration: "2–4 hrs" },
  "painting": { typicalDuration: "1–3 days" },
  "junk-removal": { typicalDuration: "1–2 hrs" },
  "pool": { typicalDuration: "45–60 min" },
  "pest-control": { typicalDuration: "~45 min" },
  "home-security": { typicalDuration: "Consultation" },
  "smart-home": { typicalDuration: "1–4 hrs" },
  "handyman": { typicalDuration: "Per block" },
  "tree-stump": { typicalDuration: "Varies" },
};

// ── Recurring cadences (GLOBAL, admin-extendable) + per-service settings ──────

export interface SeedCadence {
  key: string;
  label: string;
  interval: "NONE" | "WEEK" | "MONTH";
  intervalCount: number;
}

export const SEED_CADENCES: SeedCadence[] = [
  { key: "one-time", label: "One-time", interval: "NONE", intervalCount: 1 },
  { key: "weekly", label: "Weekly", interval: "WEEK", intervalCount: 1 },
  { key: "biweekly", label: "Every two weeks", interval: "WEEK", intervalCount: 2 },
  { key: "monthly", label: "Monthly", interval: "MONTH", intervalCount: 1 },
  { key: "quarterly", label: "Every 3 months", interval: "MONTH", intervalCount: 3 },
];

/**
 * Per-service cadence settings: which cadences are offered and the % that comes
 * off the configured pre-tax total — THE discount mechanism. One-time is active
 * for every service automatically (seed.ts); rows here activate the rest.
 * Values marked SAMPLE await product sign-off.
 */
export const SEED_RECURRING: Record<string, Record<string, number>> = {
  "cleaning": { weekly: 20, biweekly: 15, monthly: 10 },
  "lawn-care": { weekly: 10, biweekly: 5 },
  "pool": { weekly: 15, biweekly: 10, monthly: 5 }, // SAMPLE (was flat deltas)
  "pest-control": { monthly: 10 },
};

export const RECURRING_HEADING = "Book once. Never think about it again.";

// ── Plans (admin-composed; price is the BINDING pre-tax billing amount) ───────

export interface SeedPlan {
  serviceSlug: string;
  cadenceKey: string;
  name: string;
  bullets: string[]; // max 4
  price: number; // cents
  priceType: "PER_VISIT" | "PER_MONTH" | "FLAT";
  featured?: boolean;
}

// The four /membership-plans page cards, bullets verbatim from the design —
// prices are BINDING per-cycle amounts (the old teasers, admin-tunable).
export const SEED_PLANS: SeedPlan[] = [
  {
    serviceSlug: "cleaning",
    cadenceKey: "biweekly",
    name: "Home Cleaning",
    bullets: ["Same trusted 2-person team", "Kitchen, baths & all rooms", "Free re-clean guarantee", "Supplies included"],
    price: 14900,
    priceType: "PER_VISIT",
  },
  {
    serviceSlug: "lawn-care",
    cadenceKey: "weekly",
    name: "Lawn Care",
    bullets: ["Mow, edge, trim & blow", "Seasonal height adjustments", "Priority weather rescheduling", "Same crew each visit"],
    price: 5300,
    priceType: "PER_VISIT",
  },
  {
    serviceSlug: "pool",
    cadenceKey: "weekly",
    name: "Pool Service",
    bullets: ["Skim, vacuum & brush", "Chemical balancing", "Equipment health check", "Filter maintenance"],
    price: 11900,
    priceType: "PER_VISIT",
  },
  {
    serviceSlug: "power-washing",
    cadenceKey: "quarterly",
    name: "Power Washing",
    bullets: ["Driveways, siding & decks", "Surface-safe pressure", "Free re-wash guarantee", "Bundle & save rates"],
    price: 7900,
    priceType: "PER_VISIT",
  },
];

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
      // Frequency is no longer a configuration group — the /book frequency
      // section renders from SEED_RECURRING (cadence % is the discount).
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
    basePrice: 9900, // "from $99": a standard clean costs exactly this per visit
    groups: [
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
    // The "3+ devices -> 15%" bundle rule died with the rules engine (discounts
    // are cadence-% only now, by decision). Re-expressible when promos land.
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
  },
  {
    slug: "handyman",
    name: "Handyman",
    summary: "Odd jobs and repairs — final pricing confirmed by your pro.",
    description: "From small repairs to fixture installs and TV mounting.",
    categorySlug: "one-time",
    mode: "FROM",
    // "from $95": the base covers the first hour (the call-out minimum); extra
    // time is the quantity group below at its own per-hour unit price.
    basePrice: 9500,
    groups: [
      {
        key: "kind",
        label: "Task type",
        description: "What kind of work is it? All task types bill the same hourly rate.",
        inputType: "SELECT",
        isRequired: true,
        options: [
          { key: "general", label: "Small repair", delta: 0 },
          { key: "mount", label: "Mount / hang", delta: 0 },
          { key: "assemble", label: "Assembly", delta: 0 },
          { key: "multi", label: "Punch list", delta: 0 },
        ],
      },
      {
        key: "additional-hours",
        label: "Additional hours",
        description: "The first hour is included in the base price.",
        inputType: "QUANTITY",
        isRequired: false,
        quantityMin: 0,
        quantityMax: 7,
        unitLabel: "per hour",
        unitPrice: 9500,
      },
    ],
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
