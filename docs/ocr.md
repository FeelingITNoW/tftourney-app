# TFT placement OCR

This document describes how the TFT placement parser turns a screenshot into an
ordered list of eight players. It covers both the Google Vision adapter and the
layout-aware parser in `lib/ocr/placements/`.

The parser is intentionally conservative. A screenshot contains many strings
that look like names—rank labels, LP totals, round records, damage values,
durations, headings, and item or trait labels. The parser therefore does not
ask OCR for “the eight names” and trust the first eight strings. It generates
several plausible standings layouts, scores the layouts as a whole, and only
automatically completes when the evidence is strong enough.

The design has three important consequences:

1. Geometry is evidence. A player row is part of an ordered vertical layout,
   and player-name starts should form a shared left edge. Rank glyphs help find
   rows, but they never override top-to-bottom order.
2. A roster is a constraint, not an ordering source. A roster can identify a
   candidate, but it cannot move a candidate to another placement. The parser
   assigns placements from screenshot row order and uses the roster only to
   validate identity.
3. Uncertainty remains visible. Without a roster—or when geometry, OCR, or
   roster matching is ambiguous—the response is `review_required`. The parser
   never fills a missing player merely because that player is the only roster
   entry left over.

## Entry point and request flow

The HTTP entry point is:

```text
POST /api/ocr/placements
```

The request must contain a multipart `image` field. PNG, JPEG, and WebP files
up to 7 MB are accepted. A bot may optionally send a JSON `roster` field:

```bash
curl -X POST http://localhost:3000/api/ocr/placements \
  -H "Authorization: Bearer $OCR_API_SECRET" \
  -F 'image=@result.png' \
  -F 'roster=[{"id":"player-1","displayName":"AXM Frnd Chicken"}]'
```

There are two authenticated request paths:

| Caller | Authentication | Roster source |
| --- | --- | --- |
| Discord bot or other service | `Authorization: Bearer ...` matching `OCR_API_SECRET` | Optional JSON form field |
| Organizer web page | Existing session cookie | Server-loaded roster for `tournamentId` and `lobbyId` |

The organizer path ignores a client-supplied roster. It loads the authoritative
lobby participants after verifying that the session user owns the tournament.
Completed lobbies are read-only. This prevents a caller from changing the
roster constraint to force an unsafe match.

Before OCR runs, the HTTP boundary validates the form body, image type, file
signature, file size, roster shape, authentication, and lobby access. Provider
errors are converted to bounded `PlacementParseError` responses and raw
provider details are not returned to the client.

The normal flow is:

```text
multipart request
    -> authentication and upload validation
    -> authoritative/optional roster resolution
    -> one Google Vision documentTextDetection request
    -> structured Vision words (or flat fallback words)
    -> layout profile detection
    -> row-layout hypothesis generation
    -> candidate span generation and noise scoring
    -> global candidate selection
    -> optional one-to-one roster matching
    -> schema-v2 response
```

## OCR adapter: converting Vision into parser words

The adapter is implemented in
`lib/ocr/placements/google-vision.ts`. It makes exactly one
`documentTextDetection` call per screenshot. The parser receives a compact,
provider-independent `OcrWord[]` instead of depending on the Google SDK types.

### Structured response mapping

Google Vision's [`fullTextAnnotation`](https://docs.cloud.google.com/vision/docs/fulltext-annotations)
is traversed in this order:

```text
pages -> blocks -> paragraphs -> words -> symbols
```

Symbols are joined to reconstruct the word text. For every word with text and a
valid bounding polygon, the adapter records:

| Field | Meaning |
| --- | --- |
| `text` | Reconstructed word text |
| `box` | Normalized `{left, top, right, bottom}` coordinates in `[0, 1]` |
| `confidence` | Vision word confidence, when supplied |
| `blockIndex` | Structured Vision block index |
| `paragraphIndex` | Structured Vision paragraph index |
| `wordIndex` | Word index within the paragraph |
| `breakType` | Detected break after the word, such as `SPACE` or `LINE_BREAK` |

The bounding box is normalized using the page width and height. This is
important because screenshots can be resized, cropped, or supplied at different
resolutions. A parser tolerance expressed in normalized coordinates behaves
similarly on a 1080p screenshot and a smaller crop.

The parser primarily uses word boxes and their relative positions. Break and
hierarchy metadata are preserved in the response for diagnostics and future
rules; they are not treated as a substitute for geometry because screenshots
from different websites do not use consistent line-break conventions.

### Flat annotation fallback

Some responses may contain `textAnnotations` without usable structured words.
The adapter then skips the first annotation (which is Vision's combined full
text string) and converts the remaining annotations into words with normalized
boxes. If page dimensions are missing, the adapter derives a normalization
extent from the observed annotation polygons instead of treating pixel
coordinates as if they were already normalized.

This fallback intentionally contains less metadata: flat annotations generally
do not provide the same block, paragraph, word-confidence, or break structure.
The placement parser can still operate from text and geometry, but confidence
and diagnostics may be weaker.

For local development, set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account
JSON file outside the repository. Deployments that cannot mount a file may set
`GOOGLE_CLOUD_VISION_CREDENTIALS_BASE64` instead. Screenshots are sent to
Google Cloud Vision for processing and are not stored by this app.

## Internal word and roster contracts

The parser accepts this normalized word shape:

```ts
type OcrWord = {
  text: string;
  box: { left: number; top: number; right: number; bottom: number };
  confidence?: number;
  blockIndex?: number;
  paragraphIndex?: number;
  wordIndex?: number;
  breakType?: OcrBreakType;
};
```

The parser does not require optional Vision metadata, so tests and alternate OCR
providers can supply only `text` and `box`. Coordinates should be normalized;
the Vision adapter guarantees this for Google responses.

A roster entry is:

```ts
type OcrRosterEntry = {
  id: string;
  displayName: string;
};
```

The HTTP layer accepts at most eight roster entries. Direct parser callers are
also bounded to eight entries. `id` is returned to the caller when a row is
matched; matching itself uses `displayName`.

## Parser pipeline

The main implementation is
`lib/ocr/placements/parser.ts`. The stages below describe the order in which
the parser makes decisions.

### 1. Normalize identity text

The parser uses two related forms of a name:

1. The display form, which is retained as `extractedName` for review.
2. A comparison form used for roster matching.

Before comparison, the parser:

- applies Unicode NFKC normalization;
- splits at the first `#`, treating the suffix as a Riot tag;
- removes trailing periods or ellipsis characters from the game-name portion;
- lowercases the game name; and
- removes punctuation and separators for comparison.

For example:

| OCR or roster text | Comparison game name |
| --- | --- |
| `TS Stryggar#004` | `tsstryggar` without the display-space separator |
| `ＡＸＭ  Frnd` | `axmfrnd` |
| `belatchengel…` | `belatchengel` |

The display text is not rewritten into the comparison form. The response can
therefore show the OCR text while also returning the full roster display name.

### 2. Detect a layout profile

`detectPlacementLayoutProfile` looks for normalized fingerprint tokens in the
OCR words. Profiles do not describe fixed pixel rectangles; they only provide
lightweight vocabulary hints and noise tokens.

| Profile | Typical fingerprints | Typical noise |
| --- | --- | --- |
| `game-client` | `standing`, `player`, `teamfightstactics` | Headings and client labels |
| `ranked-results` | `challenger`, `grandmaster`, `master`, `lp` | Rank tiers and LP |
| `compact-results` | `gameid`, `normal`, `damage`, `level` | Match metadata and damage/LP fields |
| `table-results` | `rank`, `time`, `round`, `wins` | Table headings, time, damage, LP |
| `generic` | No known fingerprint | No profile-specific vocabulary |

The first profile with the strongest fingerprint is selected. An unknown
website therefore does not require the caller to provide a website name. The
profile affects lexical noise penalties and is exposed as `debug.selectedProfile`;
the geometry hypotheses remain available for unfamiliar layouts.

### 3. Derive scale-aware tolerances

The parser calculates the median normalized OCR word height, `h`. It uses `h` to
scale line grouping, left-column clustering, rank-anchor fitting, wrapped-line
joining, and large-gap detection. This is the key reason the parser does not
depend on fixed screenshot dimensions.

The important relationships are:

- line grouping uses approximately `1.35h`;
- candidate columns cluster within a fraction of `h`;
- rank anchors must be separated by more than roughly `2h`;
- a wrapped continuation must be close vertically and start no farther right
  than a height-scaled allowance; and
- a horizontal token gap is suspicious when it is several word heights or word
  widths rather than ordinary inter-word spacing.

There are small normalized floors for degenerate inputs, such as zero-height
boxes. They are safeguards for malformed OCR data, not screenshot-specific
coordinates.

### 4. Generate row-layout hypotheses

The parser does not commit to one way of finding rows. It creates multiple
hypotheses, each with row centers and candidate names for each row.

#### 4.1 Numeric placement anchors

The parser first considers OCR tokens that are standalone integers from `1` to
`8`. It clusters them by their left coordinate, because the placement numbers
normally form their own vertical column.

For each plausible numeric column it:

1. keeps at most one observation of each placement number;
2. requires at least two distinct placement values in increasing vertical order;
3. fits a line `y = intercept + step * placement`;
4. rejects the fit if residual error is too large or the step is too small; and
5. synthesizes all eight row centers from the fitted line.

The anchor support is the fraction of the eight placements observed directly.
For example, six clear rank glyphs produce support `6 / 8`, while two anchors
still provide a weak spacing signal. Up to three strong anchor sets are kept so
that a stray numeric column does not create unbounded work.

Missing or misread rank glyphs do not prevent a hypothesis. The fitted line can
fill the missing center, but the rest of the layout still has to support the
result.

#### 4.2 Repeated left-edge columns

The parser collects words containing letters, excluding known headings, and
clusters them by `box.left`. A cluster that repeats down the screenshot is a
candidate player-name column. Its word-line centers become row-center evidence.

For a column hypothesis, each row preferentially keeps candidate spans whose
start is close to the column's median left edge. If a row has no candidate in
that column, the parser retains its alternatives rather than discarding the
row entirely; the resulting alignment penalty makes the fallback visible in
global scoring.

This directly encodes the layout assumption that player names aligned on one
horizontal line should have the other placements strictly beneath the same
left edge. It also prevents a right-side damage or duration column from winning
simply because it contains readable words.

#### 4.3 Regular text baselines

As a generic fallback, all non-empty text words are grouped into lines and their
line centers are considered. If more than eight centers exist, the parser
examines contiguous eight-center windows and chooses the one whose gaps are most
regular. This handles screenshots with a heading or footer outside the actual
standings block without hard-coding a crop rectangle.

### 5. Form row bands

For each set of eight centers, the parser creates a vertical band around every
center. The boundary between adjacent rows is halfway between their centers.
Words inside a band are the raw material for that placement's candidates.

This matters because a row can contain more than one visual line. A player name
may be followed by rank text on a second line, and a long player name may wrap
onto a continuation line. The band keeps nearby text available while preventing
words from the next player row from being merged.

### 6. Generate candidate name spans

Within each row band:

1. words are grouped into text lines using their vertical centers and the
   height-scaled tolerance;
2. each line is sorted left-to-right when the words are on the same baseline;
3. every contiguous start/end span on the line is considered;
4. adjacent lines may be joined as one wrapped candidate if the second line is
   close enough vertically and begins under the first line; and
5. duplicate candidates are collapsed and only the highest-scoring bounded set
   is retained.

This is why a name such as `AXM Frnd Chicken` can be recovered from three words,
and why `AXM Frnd` followed by a lower `Chicken` can be recovered as one name.
It also means the parser can choose `AXM Frnd` instead of accidentally including
the next field on the same visual row.

#### Candidate text limits

Candidate assembly is deliberately left-to-right:

- The game-name portion may contain at most 16 Unicode code points, including
  spaces.
- A `#RiotTag` is excluded from that limit and ends the identity. Text after
  the tag is not part of the candidate.
- A trailing `...` or `…` remains a truncation marker for matching. It is not
  counted as part of the normalized game name.
- If adding a later token would exceed 16 characters, the later token and all
  following text are excluded.
- If the first token is already overlong, the candidate is rejected rather than
  truncated into a potentially false roster match.

The 16-character rule is a noise boundary, not a way to repair arbitrary OCR.
It is especially useful when a website places a rank or statistic immediately
after the username.

#### Lexical candidate score

Each candidate receives a bounded lexical score. The score rewards:

- containing letters;
- a plausible 3–16-character game name;
- a left-side start in the standings area;
- longer useful text up to the name limit; and
- higher OCR confidence.

It penalizes:

- numeric-only text;
- numeric prefixes such as `6 Alpha`;
- profile-specific noise such as `Master`, `LP`, or `Damage`;
- records such as `6-2`;
- durations such as `34:30`; and
- unusually large horizontal gaps between the words in one span.

The lexical score is only one input. A candidate that looks name-like in
isolation can still lose to a globally consistent alternative.

Each row is capped at 64 candidates. The no-roster selector considers at most
24 candidates per row, and the global roster selector keeps at most 96 partial
states. These bounds prevent a noisy screenshot from causing combinatorial
growth.

## Global layout selection

After candidate generation, the parser selects one candidate per proposed row.
The selection is global: it considers all eight rows together instead of making
eight independent decisions.

### With a roster: constrained assignment

For each hypothesis, the selector maintains a bitmask of roster entries already
used. A state contains:

- the number of safe roster matches;
- accumulated similarity;
- accumulated lexical score;
- the selected candidate for each processed row; and
- the roster entry assigned to each candidate, or `null`.

For every row/candidate combination, the selector can either leave the row
unassigned or assign one safe roster match that is not already present in the
bitmask. This is a bounded dynamic-programming/beam search rather than a greedy
“best name per row” loop.

The comparison priority is intentionally structural:

1. Prefer more complete selected rows.
2. Prefer more unique safe roster matches.
3. Prefer stronger placement-anchor support.
4. Prefer a shared left edge across selected names.
5. Prefer regular row spacing.
6. Prefer higher OCR/name similarity and lexical evidence.
7. Use the final confidence score as a tie-breaker.

This prevents two rows from selecting the same participant and makes an aligned
slightly fuzzy candidate preferable to an isolated exact-looking word in a
different column when the rest of the layout supports the aligned candidate.

### Without a roster: geometry-only selection

Without a roster there is no authoritative identity constraint. The parser still
selects a top-to-bottom sequence using lexical evidence and left-edge
consistency, but it cannot prove that the strings are the eight lobby players.
It therefore always returns:

```text
status: "review_required"
issue:  ROSTER_VALIDATION_REQUIRED
```

The extracted rows are useful for a human correction UI or a later roster lookup,
but they must not be written automatically as authoritative results.

## Roster matching and ambiguity rules

### Similarity

The comparison form of each candidate and roster display name is scored with
normalized Levenshtein similarity:

```text
similarity = 1 - editDistance / max(candidateLength, rosterLength)
```

Exact normalized matches score `1`. A candidate ending in `...` or `…` can also
match a roster member when the visible prefix is at least four comparison
characters and uniquely identifies that member. This is how a website-truncated
`belatchengel…` can match `belatchengelha` without treating every fuzzy prefix as
safe.

For ordinary fuzzy OCR errors, the candidate must meet the retained threshold
(`0.82`) and beat the next-best roster score by the retained ambiguity margin
(`0.08`). Exact and unique truncated-prefix matches bypass the fuzzy-margin
requirement because their identity evidence is stronger.

### Duplicate game names

Riot tags are not visible in the standings name field. If the roster contains
two entries with the same normalized game name but different tags, neither is a
safe automatic match. The row receives `DUPLICATE_ROSTER_NAME` and remains for
review.

### Assignment and row order

The roster assignment identifies a player; it does not determine placement. The
parser always emits placement `1` for the top selected row, placement `2` for
the next selected row, and so on. This protects against a roster list arriving
in a different order from the screenshot.

## Confidence, completeness, and status

The parser combines several signals into a bounded layout confidence:

| Signal | Weight |
| --- | ---: |
| Placement-anchor support | 0.25 |
| Row-spacing regularity | 0.25 |
| Candidate left-edge consistency | 0.20 |
| Median OCR confidence | 0.10 |
| Safe roster-match fraction | 0.20 when a roster is supplied |

The confidence gate is `0.55`. A result is `complete` only when all of the
following are true:

- a roster was supplied;
- exactly eight selected rows exist;
- all eight rows have unique safe roster matches;
- layout confidence meets the gate;
- every returned row has `matchStatus: "matched"`; and
- no issue was generated.

Everything else is `review_required`, including a visually convincing eight-row
result without a roster. `debug.runnerUpMargin` reports the confidence distance
between the selected hypothesis and the next available hypothesis, clamped to
`[0, 1]`. A small margin means the layout selection itself deserves review even
if individual names look readable.

## Response schema (version 2)

Every successful parser response has `schemaVersion: 2`:

```ts
type PlacementParseResult = {
  schemaVersion: 2;
  status: "complete" | "review_required";
  strategy: "rank_anchors" | "roster_guided" | "name_column" | "unresolved";
  placements: PlacementRow[];
  issues: PlacementIssue[];
  debug: PlacementParseDebug;
};
```

Each placement row contains:

| Field | Meaning |
| --- | --- |
| `placement` | Top-to-bottom placement number, 1 through 8 |
| `extractedName` | Selected OCR text before roster replacement |
| `matchStatus` | `matched`, `unmatched`, `ambiguous`, or `not_requested` |
| `matchedRosterEntry` | Matched `id`, full display name, and similarity, or `null` |
| `similarity` | Candidate-to-roster score, or `null` without a roster |

### Strategies

| Strategy | Meaning |
| --- | --- |
| `roster_guided` | A roster was supplied and constrained the global selection |
| `name_column` | Geometry found a repeated player-name column |
| `rank_anchors` | Numeric placement anchors were the strongest structural signal |
| `unresolved` | The parser could not find a recognizable ordered layout |

The strategy is descriptive, not a promise of completion. A `roster_guided`
response can still be `review_required` when rows are missing, unmatched, or
ambiguous.

### Issues

| Code | Meaning and recommended action |
| --- | --- |
| `INCOMPLETE_ROWS` | Fewer or more than eight selected rows; inspect row centers and candidates |
| `EMPTY_PLAYER_NAME` | A row band had no usable candidate text |
| `UNMATCHED_PLAYER` | OCR text did not safely match this roster |
| `AMBIGUOUS_PLAYER` | Several roster entries were too close under the fuzzy rules |
| `DUPLICATE_ROSTER_NAME` | Two roster entries share the same game name without distinguishable tags |
| `UNSUPPORTED_LAYOUT` | No recognizable ordered standings layout was found |
| `ROSTER_VALIDATION_REQUIRED` | No authoritative roster was supplied |
| `LOW_LAYOUT_CONFIDENCE` | Geometry/OCR evidence fell below the confidence gate |

The presence of any issue prevents `complete`. The UI should show issues to the
organizer and keep the existing manual correction/save flow as the authority.

### Debug object

`debug` is transient diagnostic data for the authenticated caller. It contains:

- `detectedWords`: the normalized OCR words and optional Vision metadata;
- `orderedNameCandidates`: the selected candidate text in row order;
- `rankAnchors`: numeric tokens that supported anchor fitting;
- `selectedProfile`: the detected layout family;
- `layoutConfidence`: the final confidence in `[0, 1]`;
- `runnerUpMargin`: confidence separation from the next hypothesis;
- `rowCenters`: normalized vertical centers used for the selected rows;
- `candidateDiagnostics`: the selected candidate and a bounded list of
  alternatives for each row;
- `finalizedOrder`: the placement numbers and extracted names after selection;
- `rosterProvided` and `rosterSize`: whether roster validation was available.

The debug object is displayed in the expandable OCR trace in the lobby editor.
It is not logged or persisted by this app.

## Worked examples

### Wrapped name plus profile text

Suppose one row produces these words:

```text
AXM      x=0.15, y=0.40
Frnd     x=0.20, y=0.40
Chicken  x=0.15, y=0.43
Master   x=0.15, y=0.46
```

The line enumerator creates `AXM`, `AXM Frnd`, and `Chicken` candidates. The
wrapped-line rule can combine the first two lines into `AXM Frnd Chicken` because
the continuation starts beneath the first line. The profile noise penalty makes
`Master` less attractive, and the 16-character boundary prevents a later field
from being appended. With a matching roster entry, the global assignment selects
the full wrapped name and ignores the rank label.

### Truncated website name

For `belatchengel…`, normalization removes the ellipsis for comparison but keeps
the marker for matching. The parser accepts a roster match only if the visible
prefix is sufficiently long and uniquely prefixes one roster game name. If two
roster entries share that prefix, the row is ambiguous rather than guessed.

### Right-side noise

If every player name begins near `x=0.18` but a damage column begins near
`x=0.70`, the repeated-column hypothesis keeps the left-aligned candidates. A
large gap penalty also discourages combining the two columns into one span. The
global scorer then rewards the layout whose selected candidates share the left
edge and whose row centers are regular.

### No roster

The parser may return eight readable names in top-to-bottom order, but each row
has `matchStatus: "not_requested"`, `matchedRosterEntry: null`, and the response
has `status: "review_required"` plus `ROSTER_VALIDATION_REQUIRED`. This is
intentional: OCR text alone cannot prove lobby membership.

## Upload, UI, and persistence behavior

The organizer lobby page sends the screenshot together with `tournamentId` and
`lobbyId`. The server supplies the authoritative roster, and the client only
prefills inputs for rows with unique `matchedRosterEntry` values. The existing
manual score-save action remains responsible for persistence. OCR results are
suggestions until the organizer reviews and saves them.

The OCR endpoint does not persist screenshots, raw Vision responses, usernames,
or debug traces. The debug object exists only in the authenticated response and
the current page state.

## Tests and fixtures

The OCR tests cover:

- structured Vision hierarchy, confidence, breaks, and flat fallback;
- the four supported layout families and an unknown generic layout;
- rank-anchor loss and misread placement glyphs;
- repeated left edges, shifted/resized coordinates, and right-side noise;
- multi-word and wrapped names;
- Riot tags and text after tags;
- trailing-ellipsis prefix matching;
- the 16-Unicode-character boundary;
- rank, LP, record, duration, level, damage, and profile-heading noise;
- duplicate game names and fuzzy ambiguity;
- Unicode normalization and one-character OCR mistakes; and
- authenticated bot and organizer HTTP behavior.

Fixtures live under `test/fixtures/ocr/`. Normal OCR tests use sanitized word
objects rather than image files so they remain deterministic and fast.

Run the checks from `tftourney-app/`:

```bash
npm test
npm run lint
npm run build
```

The live Google Sheets test is intentionally skipped unless its external
credentials are configured. Normal OCR tests do not call Google Vision; they
exercise the adapter mapping with fixtures and the pure parser with normalized
words.

## Extending the parser safely

When a new website layout appears, first add a sanitized fixture and determine
which existing hypothesis already explains it. Add a profile only when the
layout has stable vocabulary/noise fingerprints; do not add fixed screenshot
rectangles.

When a failure is caused by candidate selection, add a parser fixture that
contains the misleading text and the correct roster. Prefer changing geometry,
normalization, or bounded scoring over adding a special-case username list.

When a failure is caused by OCR not producing a usable word box, preserve the
structured OCR diagnostics and collect consented failure examples before adding
a learned model. A small candidate ranker should be considered before a raw
image username detector, because most current ambiguity comes from layout and
noise selection rather than missing text recognition.
