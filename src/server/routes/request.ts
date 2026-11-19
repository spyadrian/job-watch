// What routes read from a request.
import type { Context } from "hono";

/** The JSON body as an object; {} when it is missing, unparsable or not an object. */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
