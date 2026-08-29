# Project Status

## Completed

- Job Work output materials support Qty Produced, Unit, and a per-row Received Date.
- Input-side Qty Returned is displayed from the total output quantity for the matching Job Line ID.
- Input-side Received Date was removed to avoid representing multiple output receipt dates as one ambiguous value.

## Current verification

- TypeScript check passes with `npx tsc --noEmit`.
- `npm run lint` passes with one pre-existing, unrelated warning (unused var in `tests/data-integrity/vendor-movements-report.test.ts`).

