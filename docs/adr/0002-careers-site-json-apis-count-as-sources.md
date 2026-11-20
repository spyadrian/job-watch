# Careers-site JSON APIs count as Sources; HTML scraping still doesn't

Amends [ADR 0001](0001-local-only-app-no-html-scraping.md), which limited Sources to "official" ATS job board APIs and RSS/Atom feeds.

Many employers use an ATS with no documented public job board API (Workday, Oracle Cloud HCM, BambooHR, iCIMS/Jibe, Eightfold). Their careers sites still get their Jobs from a public JSON endpoint that needs no login: the site's own front end calls it. Job Watch may read such an endpoint as a Source when all of these hold:

- it answers without authentication, cookies or a session token taken from a page;
- it returns structured data (JSON, XML, RSS/Atom), not HTML;
- it is the same request the careers site's own page makes, at a similar volume (one read per Refresh, a bounded number of pages).

Reading Jobs out of HTML markup is still never done. An adapter for an undocumented API must fail with a clear SourceError when the shape changes, never return a partial list (as for every adapter).

## Consequences

- These endpoints can change without notice; a broken adapter shows up as a failed read on that Company, not as wrong Jobs.
- The GLOSSARY's "Source" now covers these endpoints too: "official" means published by the employer's ATS, not documented by it.
