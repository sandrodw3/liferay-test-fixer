---
name: collect-routine-failures
description: Run the project's `collect` script for a given Testray routine ID, producing a JSON snapshot of that routine's most recent failures at `output/test-failures-<routineId>-<YYYY-MM-DD>.json`. The snapshot includes per-failure metadata (name, type, `errorTrace`, `lastPassSha`, `firstFailSha`) and is the input expected by `/fix-test-failures`. Use this skill whenever the user wants to refresh the snapshot for a routine before fixing its failures.
---

# Collect routine failures

Produce a fresh JSON snapshot of a Testray routine's recent failures by running the project's `collect` script. This skill is the data-gathering half of the workflow — `/fix-test-failures` then operates on the snapshot this skill writes.

## Invocation

```
/collect-routine-failures <routineId>
```

- `<routineId>` (required, positive integer) — Testray routine to collect.

## Hard preconditions

Verify before running. Fail fast with a clear message if any is missing.

- The current working directory is the `liferay-test-analyzer` project root (a `package.json` with the `collect` script must exist).
- `.env.local` exists and exports `TESTRAY_CLIENT_ID` and `TESTRAY_CLIENT_SECRET`.

## Workflow

```
npm run collect -- <routineId>
```

The script writes `output/test-failures-<routineId>-<YYYY-MM-DD>.json` and prints the absolute path on stdout. Surface that path to the user and stop — there is no further action.

If a snapshot for the same `<routineId>` and today's date already exists, the script overwrites it. That is intentional: one snapshot per routine per day.

## Hard rules

- Do **not** run any analysis or fix on the JSON. That is `/fix-test-failures`.
- Never commit or push.
- Fail fast on missing preconditions — do not silently substitute defaults for missing env vars.
- Read the path from the script's stdout; do not reconstruct the filename yourself.
