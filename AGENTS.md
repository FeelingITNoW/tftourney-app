<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes -- APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Agent Instructions

## Project Overview

TFTourney Organizer is a starter Next.js application for running Teamfight Tactics tournaments. The product should eventually support tournament setup, player registration, seeding, lobby generation, screenshot submission, OCR-assisted result parsing, bracket/standings updates, and real-time Google Sheets output.

Current stack:

- Next.js 16 App Router
- React 19
- TypeScript with `strict` enabled
- Tailwind CSS 4
- ESLint 9 using `eslint-config-next`
- Planned integrations: PostgreSQL, Python OCR pipeline, Google Sheets API

## Working Principles

- Prefer small, focused changes that keep the starter easy to evolve.
- Follow the existing App Router conventions under `app/`.
- Keep business rules separate from UI. Tournament scoring, seeding, lobby generation, and OCR result normalization should live in testable modules outside page components.
- Use TypeScript types for domain concepts such as tournament, player, round, lobby, placement, score, and screenshot processing status.
- Treat uploaded screenshots, OCR output, and Google Sheets writes as untrusted external inputs. Validate before persisting or displaying them.
- Do not add dependencies casually. If a dependency is needed, choose maintained packages that fit Next.js 16 and React 19.
- Keep secrets out of the repo. Use environment variables for database, OCR, and Google API credentials.

## Suggested Structure

Use this structure as features are added:

```text
app/
  layout.tsx
  page.tsx
  tournaments/
    page.tsx
    [tournamentId]/
      page.tsx
      lobbies/
        page.tsx
components/
  ui/
  tournaments/
lib/
  tournament/
    scoring.ts
    seeding.ts
    lobby-generation.ts
    standings.ts
  ocr/
    parse-results.ts
  sheets/
    sync-standings.ts
  db/
    client.ts
    schema.ts
types/
  tournament.ts
```

Guidelines:

- `app/` should contain routes, layouts, loading/error states, and route handlers.
- `components/` should contain reusable UI. Keep route-specific components grouped by feature when useful.
- `lib/` should contain pure domain logic, service adapters, and integration boundaries.
- `types/` should contain shared domain types only when they are used across multiple modules.
- Keep tests next to the module they cover or in a feature-level `__tests__/` folder; be consistent once the first test pattern is established.

## Development Commands

Run commands from `tftourney-app/`.

```bash
npm run dev
npm run lint
npm run build
```

Current scripts:

- `npm run dev`: starts the local Next.js dev server.
- `npm run lint`: runs ESLint.
- `npm run build`: builds the production app and catches many type and framework errors.

Before finishing code changes, run `npm run lint`. Run `npm run build` when touching routing, server/client component boundaries, config, metadata, or data-fetching behavior.

## Linting Standards

- Keep `eslint.config.mjs` based on `nextVitals` and `nextTs` unless there is a concrete project need to change it.
- Fix lint errors directly instead of suppressing them.
- Use `eslint-disable` only for narrow, documented exceptions.
- Keep imports clean and remove unused variables before handing off work.
- Preserve `strict` TypeScript behavior. Do not weaken `tsconfig.json` to work around type errors.

## Testing Strategy

Testing is not configured yet. When the first meaningful feature is added, introduce tests before the domain logic becomes hard to change.

Recommended testing layers:

- Unit tests for pure tournament logic in `lib/tournament/*`.
- Unit tests for OCR normalization and parsing in `lib/ocr/*`, using checked-in fixture text/JSON rather than large image files.
- Integration tests for database repositories and Google Sheets adapters, with external services mocked by default.
- Component tests for interactive UI that has stateful behavior.
- End-to-end tests for critical flows such as creating a tournament, entering players, generating lobbies, submitting results, and publishing standings.

Recommended tooling when tests are introduced:

- Vitest for TypeScript unit and component-adjacent tests.
- React Testing Library for component behavior.
- Playwright for end-to-end browser flows.
- Lightweight fixtures under `test/fixtures/` for OCR and standings scenarios.

Add scripts when the tooling is installed:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "check": "npm run lint && npm run test && npm run build"
  }
}
```

Until test tooling exists, validate changes with `npm run lint` and `npm run build`, and manually exercise changed routes in the browser when UI behavior changes.

## Test Design Guidelines

- Test business outcomes, not implementation details.
- Keep tournament scoring and lobby-generation tests table-driven with clear fixtures.
- Include edge cases: ties, missing screenshots, duplicate players, invalid placements, manual corrections, dropped players, and round reseeding.
- Mock OCR and Google Sheets boundaries. Do not require network access for normal test runs.
- Keep e2e tests focused on critical user journeys rather than every visual state.
- Add regression tests for every bug fix in domain logic or data transformation.

## UI and Accessibility

- Build the actual tournament workflow, not a marketing page, unless explicitly requested.
- Favor dense, clear operational screens for organizers: tables, filters, status indicators, forms, and action bars.
- Keep page components server-rendered by default. Add `"use client"` only for components that need browser state, effects, or event handlers.
- Use semantic HTML, labels for form fields, keyboard-accessible controls, and visible focus states.
- Avoid putting complex tournament state only in the client. Server state should remain the source of truth once persistence is added.

## Data and Integration Boundaries

- Keep database access behind small repository/service functions.
- Keep Google Sheets sync behind an adapter so tournament logic does not depend on spreadsheet API details.
- Keep OCR processing behind a boundary that accepts an uploaded asset or extracted OCR text and returns validated domain data.
- Store raw OCR output separately from reviewed/confirmed match results so organizers can audit and correct automation mistakes.
- Prefer idempotent operations for result imports and sheet syncs.

## Handoff Expectations

When changing code:

- Mention the files changed.
- Mention the validation commands run and their results.
- Call out any skipped tests or missing tooling.
- Leave follow-up TODOs only when they are concrete and still necessary.
