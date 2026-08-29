# AI Handoff

## Current state

The Job Work Order edit and detail screens now treat input-side **Qty Returned** as a read-only derived value. It is the total of valid output-material quantities whose `source_job_line_id` matches the input material's `job_line_id`.

Input Materials no longer includes a Received Date. Each output material row retains its own Received Date because outputs from one input can arrive on different dates.

## Last completed task

Implemented the above Job Work output-to-input return calculation.

## Files changed

- `src/app/(app)/jobwork/[id]/edit/page.tsx`
- `src/app/(app)/jobwork/[id]/JobWorkReturnClient.tsx`
- `src/app/(app)/jobwork/[id]/page.tsx`

## Verification

- `npx tsc --noEmit` passes.
- `npm run lint` passes (eslint@9.39.5 / eslint-plugin-react@7.37.5) with one pre-existing, unrelated warning: `'scoped' is assigned a value but never used` in `tests/data-integrity/vendor-movements-report.test.ts:165`.

