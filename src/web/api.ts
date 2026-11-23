/** Calls the JSON API; throws an Error carrying the server's human-readable message. */
export async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  return callWithJson<T>(method, path, body === undefined ? undefined : JSON.stringify(body));
}

/** Like `call`, with a body that is already JSON text (e.g. a file's contents), sent as is. */
export async function callWithJson<T>(method: string, path: string, json?: string): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: json === undefined ? undefined : { "content-type": "application/json" },
    body: json,
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status}).`);
  return data as T;
}
