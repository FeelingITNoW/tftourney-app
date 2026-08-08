# Google Sheets synchronization performance

The Sheets publisher is an asynchronous, revisioned queue. Organizer actions
save tournament data first and wake a background sync after the response, so a
Google API call never holds up the score-save redirect.

## Synchronization flow

1. A tournament mutation (registration, start, result update, randomization, or
   node finalization) commits to Supabase.
2. The database dirty trigger increments `desired_revision` and marks an
   existing `tournament_sheet_exports` row as `queued`.
3. The server schedules a targeted worker with `after()`. The worker atomically
   claims the tournament row through `claim_tournament_sheet_export`, acquiring
   a five-minute lease.
4. The worker builds the minimal export view model and writes the workbook to
   Google Sheets.
5. `complete_tournament_sheet_export` records the revision that was written.
   If another mutation arrived during the write, the row remains queued and
   the targeted worker claims it again, for up to three consecutive passes.
6. The scheduled Supabase Edge Function runs every minute as a backstop for
   retry delays, worker restarts, and direct database changes.

## Why this is faster

| Change | Effect |
| --- | --- |
| Post-response targeted worker | Score saves return immediately and normally start syncing within seconds instead of waiting for the next cron tick. |
| Bounded worker pool | Different tournaments synchronize concurrently; one slow Google workbook does not block all other tournaments. |
| Revision coalescing | Several rapid mutations collapse into the newest desired revision instead of producing one Google write per intermediate score. |
| Atomic leases and `SKIP LOCKED` | Multiple worker invocations can run safely without duplicate writes to the same workbook. |
| Per-export failure isolation | A failed or reauthorization-required export does not cancel other exports in the same batch. |

The worker pool is intentionally concurrent across tournaments only. A single
tournament remains serialized so its workbook cannot be overwritten by an
older projection. Each successful sync still writes the managed workbook tabs
and Google API quotas remain the upper throughput limit.

## Tuning and operations

Set `GOOGLE_SHEET_WORKER_CONCURRENCY` in the Next.js app to control the number
of asynchronous export slots per worker invocation. The default is `4`; values
are clamped to `1` through `10`. Keep the value within the Google Sheets and
Drive quotas for the organizer accounts being served.

The Supabase Edge Function at
`supabase/functions/sync-tournament-sheets` should be invoked by Supabase Cron
every minute. It calls the protected
`/api/internal/google-sheets/sync` route with the worker secret. Inspect the
export status fields when diagnosing delays:

- `desired_revision` greater than `synced_revision` means work is pending.
- `state = syncing` means a worker currently owns the lease.
- `state = queued` with `next_attempt_at` in the future means retry backoff is
  active.
- `state = needs_reauth` means Google rejected the refresh token; reconnect
  Google Drive, then retry the export.

## Validation

The bounded worker and revision-drain behavior are covered by
`test/google-sheets-sync.test.ts`. Run the deterministic checks with:

```bash
npm run lint
npm test
npm run build
```

The live Google workbook test remains opt-in through
`npm run test:sheets:live`.
