import type {
  DisplayedPrice,
  EngineConfiguration,
  LineItem,
  Money,
  PricingTable,
} from "./types";
import { addMoney, negateMoney, scaleMoney, zeroMoney } from "./money";
import { evaluateRules } from "./evaluate-rules";

/**
 * Pure, deterministic pricing: (pricing table, configuration) -> DisplayedPrice.
 * Faithful port of the Elevate client engine with exactly ONE inserted pass
 * (conditional rules) between the modifier loop and the fee loop. Integer
 * minor-unit math throughout. With rules: [] the output is byte-identical to the
 * Elevate client engine.
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

  // Step 1 — base scaled by quantity.
  const lines: LineItem[] = [];
  let subtotal: Money = scaleMoney(sp.base_price, config.quantity);
  lines.push({ label: "Base", amount: subtotal, kind: "base" });

  // Step 2 — modifiers.
  for (const m of sp.modifiers) {
    const sel = config.selections[m.id];
    if (sel == null || sel === false) continue;
    const ids = Array.isArray(sel) ? sel : [sel];
    for (const raw of ids) {
      const id = String(raw);
      const opt = m.options?.find((o) => o.id === id);
      const delta = opt?.delta ?? m.delta;
      if (!delta) continue;
      const amt = m.applies === "per_unit" ? scaleMoney(delta, config.quantity) : delta;
      subtotal = addMoney(subtotal, amt);
      lines.push({
        label: opt?.label ?? m.label,
        amount: amt,
        kind: m.options ? "option" : "modifier",
      });
    }
  }

  // Step 3 — APEX EXTENSION: conditional rules. Percent effects compute against
  // the modifier-final subtotal; rule amounts accumulate into total only.
  let total = subtotal;
  for (const ruleLine of evaluateRules(sp.rules, config.selections, subtotal, currency)) {
    total = addMoney(total, ruleLine.amount);
    lines.push(ruleLine);
  }

  // Step 4 — fees (percent computes against the modifier-final subtotal).
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
