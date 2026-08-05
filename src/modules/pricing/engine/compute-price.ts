import type {
  DisplayedPrice,
  EngineConfiguration,
  LineItem,
  Money,
  PricingTable,
} from "./types";
import { addMoney, negateMoney, scaleMoney, zeroMoney } from "./money";

/**
 * Pure, deterministic pricing: (pricing table, configuration) -> DisplayedPrice.
 *
 * The Recurring/Plans model simplified this to strictly additive math:
 *   total = base (flat, added once)
 *         + selected option deltas            (select / multiselect / toggle)
 *         + quantity × unit_price             (quantity groups own their unit)
 *         + fees                              (still always [] until tax/fees land)
 *
 * The old conditional-rules pass is gone — the only discount left in the system
 * is the recurring cadence %, and that is applied by the CALLER (checkout /
 * booking flow) on top of this configured pre-tax total, never inside the
 * engine. `config.quantity` (the legacy global multiplier) is deliberately
 * ignored: quantity now lives per-group.
 */
export function computePrice(table: PricingTable, config: EngineConfiguration): DisplayedPrice {
  const currency = table.currency;
  const sp = table.services[config.service_id];

  if (!sp) {
    return {
      total: zeroMoney(currency),
      subtotal: zeroMoney(currency),
      line_items: [],
      pricing_version: table.version,
      is_estimate: true,
    };
  }

  // Step 1 — flat base: the payable minimum AND the listed "from $X".
  const lines: LineItem[] = [];
  let subtotal: Money = sp.base_price;
  lines.push({ label: "Base", amount: subtotal, kind: "base" });

  // Step 2 — modifiers.
  for (const m of sp.modifiers) {
    const sel = config.selections[m.id];
    if (sel == null || sel === false) continue;

    // Quantity groups: numeric selection × the group's own unit price.
    if (m.type === "quantity") {
      const n = typeof sel === "number" ? sel : Number(sel);
      if (!Number.isInteger(n) || n <= 0 || !m.unit_price) continue;
      const amt = scaleMoney(m.unit_price, n);
      subtotal = addMoney(subtotal, amt);
      lines.push({ label: `${m.label} × ${n}`, amount: amt, kind: "modifier" });
      continue;
    }

    const ids = Array.isArray(sel) ? sel : [sel];
    for (const raw of ids) {
      const id = String(raw);
      const opt = m.options?.find((o) => o.id === id);
      const delta = opt?.delta ?? m.delta;
      if (!delta) continue; // $0 options are "Included" — priced in the base
      subtotal = addMoney(subtotal, delta);
      lines.push({
        label: opt?.label ?? m.label,
        amount: delta,
        kind: m.options ? "option" : "modifier",
      });
    }
  }

  // Step 3 — fees (percent computes against the modifier-final subtotal).
  let total = subtotal;
  for (const f of sp.fees) {
    const base: Money =
      f.calc === "percent"
        ? { amount: Math.round((subtotal.amount * f.value) / 100), currency }
        : { amount: f.value, currency };
    const amt = f.kind === "discount" ? negateMoney(base) : base;
    total = addMoney(total, amt);
    lines.push({ label: f.label, amount: amt, kind: f.kind });
  }

  return {
    total,
    subtotal,
    line_items: lines,
    pricing_version: table.version,
    is_estimate: true,
  };
}
