# Job Watch

An account-free job watcher: a person follows the companies they care about and reviews those companies' open jobs in one place.

## Language

### Companies and sources

**Company**:
An employer the person follows, attached to exactly one Source.
_Avoid_: Employer, organization, board

**Source**:
The official, public, machine-readable listing of a Company's open Jobs (an ATS job board API or an RSS/Atom feed).
_Avoid_: Feed (when meaning a Company's listing), provider, integration

**Shortcut**:
A link to a careers site whose Jobs cannot be read automatically; the person opens it to browse jobs there.
_Avoid_: Bookmark, link, manual company

### Jobs

**Job**:
One open position published by a Source.
_Avoid_: Offer, posting, listing, opening

**Outdated**:
Said of a Job that no longer appears in its Source after a successful read of that Source.
_Avoid_: Expired, closed, stale

### Job status

A Job has exactly one status: Unseen, Seen, Saved or Applied.

**Unseen**:
The default status: the person has not yet dealt with the Job.
_Avoid_: New, unread

**Seen**:
The person has looked at the Job and needs no further action on it.
_Avoid_: Read, viewed, not interested, dismissed

**Saved**:
The person wants to come back to the Job later.
_Avoid_: Bookmarked, starred, favorite

**Applied**:
The person has applied to the Job.
_Avoid_: Submitted, postulated

### Lists and filtering

**Inbox**:
The list of Unseen Jobs that pass the Filter; the main page.
_Avoid_: Feed, home, dashboard

**Filter**:
The person's standing choice of City filters and keywords that decides which Jobs reach the Inbox and in what order.
_Avoid_: Search (search is the separate, temporary full-text query)

**City filter**:
One city the person wants, given as one or more spellings of that city (e.g. Geneva / Genève / Genf).
_Avoid_: Location filter

**Required keyword**:
A word of which at least one must appear in a Job's title for the Job to pass the Filter (shown green).
_Avoid_: Must-have, include keyword

**Boosted keyword**:
A word that, when in a Job's title, moves the Job to the top of the list (shown yellow).
_Avoid_: Priority keyword, highlight

**Excluded keyword**:
A word that, when in a Job's title, keeps the Job out of the Inbox (shown red).
_Avoid_: Blocked keyword, negative keyword
