import { env } from "../../config/env";
import { logger } from "../../utils/logger";

/**
 * Publish-triggered cache-bust: ping the Next client's POST /api/revalidate so
 * it can `revalidateTag('catalog')` the moment an admin changes pricing, instead
 * of waiting out the client's ISR TTL (07 §8).
 *
 * Config-guarded (no-op unless REVALIDATE_SECRET is set) and deliberately never
 * throws — a failed ping must not fail the admin's write; the ISR TTL is the
 * backstop. Fire-and-forget: callers `void` it so the response isn't delayed.
 */
export async function pingClientRevalidate(tags: string[]): Promise<void> {
  const secret = env.REVALIDATE_SECRET;
  if (!secret) return;
  const url = `${env.CLIENT_BASE_URL}/api/revalidate`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-revalidate-secret": secret },
      body: JSON.stringify({ tags }),
    });
    if (!res.ok) logger.warn(`[revalidate] client ${url} responded ${res.status}`);
  } catch (err) {
    logger.warn(`[revalidate] ping to ${url} failed: ${String(err)}`);
  }
}
