# Local-only app with a server that reads Sources; no HTML scraping

Job Watch runs on the person's own machine (`docker compose up`, bound to `127.0.0.1`) rather than as a hosted website. A server is needed because most RSS/Atom feeds don't send CORS headers, so a browser-only app couldn't read them; keeping that server local means it is never an open proxy reachable by others, and there is no hosted instance or user data to operate. The server reads only official, public, machine-readable Sources (ATS job board APIs and RSS/Atom feeds) and never scrapes HTML pages for Jobs, which would break many sites' terms of service and be fragile.

## Considered Options

- **Browser-only static site**: no server to run, but RSS feeds without CORS `*` would be unusable.
- **Hosted static site plus a public proxy**: usable from any device, but a public fetch-any-URL proxy invites abuse (SSRF, open proxy) and must be operated and secured.
