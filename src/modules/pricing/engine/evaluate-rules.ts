import type { LineItem, Money, PricingRule, RuleTrigger, Selections } from "./types";
import { negateMoney } from "./money";

/** Normalize a selection value EXACTLY the way the modifier loop does. */
function selectedKeys(sel: Selections[string] | undefined): string[] {
  if (sel == null || sel === false) return [];
  const ids = Array.isArray(sel) ? sel : [sel];
  return ids.map((raw) => String(raw));
}

type TriggerOf<K extends RuleTrigger["kind"]> = Extract<RuleTrigger, { kind: K }>;

/**
 * Trigger evaluators keyed by trigger kind — a mapped Record over the
 * discriminated union: adding a trigger kind = one zod variant + one entry
 * here (the compiler rejects a missing entry). No switch statements.
 */
const triggerEvaluators: {
  [K in RuleTrigger["kind"]]: (trigger: TriggerOf<K>, selections: Selections) => boolean;
} = {
  min_selected: (t, s) => selectedKeys(s[t.group]).length >= t.count,
  option_selected: (t, s) => selectedKeys(s[t.group]).includes(t.option),
};

export function isTriggered(trigger: RuleTrigger, selections: Selections): boolean {
  const evaluate = triggerEvaluators[trigger.kind] as (t: RuleTrigger, s: Selections) => boolean;
  return evaluate(trigger, selections);
}

/**
 * Evaluate conditional rules against the modifier-final subtotal. Returns one
 * signed LineItem per TRIGGERED rule, ordered by sortOrder asc then key asc.
 * Percent effects use the identical rounding expression as the fee loop.
 */
export function evaluateRules(
  rules: PricingRule[],
  selections: Selections,
  subtotal: Money,
  currency: string,
): LineItem[] {
  const ordered = [...rules].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));

  const lines: LineItem[] = [];
  for (const rule of ordered) {
    if (!isTriggered(rule.trigger, selections)) continue;
    const base: Money =
      rule.effect.calc === "percent"
        ? { amount: Math.round((subtotal.amount * rule.effect.value) / 100), currency }
        : { amount: rule.effect.value, currency };
    const amt = rule.effect.kind === "discount" ? negateMoney(base) : base;
    lines.push({ label: rule.label, amount: amt, kind: rule.effect.kind });
  }
  return lines;
}
