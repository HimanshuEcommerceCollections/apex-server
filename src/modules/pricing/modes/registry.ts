import { PricingMode } from "../../../enums";
import type { PricingModeHandler } from "./handler.types";
import { pricedHandler } from "./priced.handler";
import { fromHandler } from "./from.handler";
import { quoteHandler } from "./quote.handler";

/**
 * The ONLY PricingMode dispatch in the codebase. Record<PricingMode, ...> is
 * exhaustiveness-checked by TypeScript: adding a value to the Prisma PricingMode
 * enum makes this file fail `npm run typecheck` until a handler is registered.
 */
const handlers: Record<PricingMode, PricingModeHandler> = {
  [PricingMode.PRICED]: pricedHandler,
  [PricingMode.FROM]: fromHandler,
  [PricingMode.QUOTE]: quoteHandler,
};

export function getPricingModeHandler(mode: PricingMode): PricingModeHandler {
  return handlers[mode];
}
