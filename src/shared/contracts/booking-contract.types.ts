/**
 * P14-M2 booking-configurator contract types (standalone — no Prisma types, so
 * this stays extractable per the shared-boundary rule). Module services map
 * between Prisma enums and these wire shapes.
 */

export interface Money {
  amount: number; // integer minor units (cents)
  currency: string; // "USD"
}

export type ConfigValue = string | number | boolean | string[];

/** configuration.selections: Record<group.key, option.key | option.key[] | number | boolean>. */
export type Selections = Record<string, ConfigValue>;

export type LineItemKind = "base" | "modifier" | "option" | "fee" | "discount";

export interface LineItem {
  label: string;
  amount: Money;
  kind: LineItemKind;
}

/** displayed_price omitted end-to-end for QUOTE services. */
export interface DisplayedPrice {
  subtotal: Money;
  total: Money;
  line_items: LineItem[];
  currency: string;
}
