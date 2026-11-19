// What routes read from a request: its JSON body and its `:id` path parameter.
import type { Context } from "hono";
import type { RequestError } from "../errors.ts";

/** The JSON body as an object; {} when it is missing, unparsable or not an object. */
export async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const body: unknown = await c.req.json().catch(() => null);
  return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/** The `:id` path parameter; anything but a positive whole number names nothing, so `notFound()` is thrown. */
export function idParam(c: Context, notFound: () => RequestError): number {
  const raw = c.req.param("id") ?? "";
  if (!/^[1-9]\d{0,14}$/.test(raw)) throw notFound();
  return Number(raw);
}
