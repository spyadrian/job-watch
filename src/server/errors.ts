/**
 * A request the server refuses. `message` is shown to the person as-is;
 * `status` is the HTTP status the API answers with (see app.ts onError).
 */
export class RequestError extends Error {
  status: 400 | 404 | 409 | 502;
  constructor(message: string, status: RequestError["status"]) {
    super(message);
    this.name = "RequestError";
    this.status = status;
  }
}
