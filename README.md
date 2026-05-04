# Liferay Test Analyzer

Tooling that pulls Testray routine failures and lets Claude Code fix them end-to-end against a local `liferay-portal` checkout — reproducing each failure, identifying the offending commit, applying the fix, filing a Jira ticket, and opening a PR per resolved failure.

## 🔧 Setup

### 1. Clone the repo

```
git clone <repo-url> liferay-test-analyzer
cd liferay-test-analyzer
npm install
```

### 2. Set the environment variables

Create a `.env.local` file at the repo root with:

```
TESTRAY_CLIENT_ID=<your-testray-client-id>
TESTRAY_CLIENT_SECRET=<your-testray-client-secret>
LIFERAY_PORTAL_PATH=<absolute-path-to-your-liferay-portal-clone>
```

- `TESTRAY_CLIENT_ID` and `TESTRAY_CLIENT_SECRET` authenticate against Testray.
- `LIFERAY_PORTAL_PATH` is the absolute path to your local `liferay-portal` repository.

### 3. Collect a routine's failures

From inside this repo, invoke the collect skill in Claude Code:

```
/collect-routine-failures <routineId>
```

This runs the project's `collect` script against Testray and writes a JSON snapshot at `output/test-failures-<routineId>-<YYYY-MM-DD>.json` with per-failure metadata: `name`, `type`, `errorTrace`, `lastPassSha`, and `firstFailSha`.

### 4. Fix the failures

```
/fix-test-failures <failure JSON or array of failure JSONs>
```

Pick one or more failure entries from the snapshot above and pass them as the argument — a single object for one fix, or a JSON array to batch several. For each failure Claude switches into the local `liferay-portal` checkout, reproduces the failure, identifies the offending commit in the `lastPassSha`..`firstFailSha` window, iterates a fix on the test or the product code, files a Jira ticket, commits, and opens a PR. When one failure cannot be resolved (does not reproduce locally, iteration budget exhausted, …) it is recorded as `Unresolved` with a handover summary in its conclusion, and the run continues with the next failure.

### 5. Read the output

- **Conversational summary**: Claude prints a per-failure summary in the chat with the verdict, ticket link, PR link, resolution time, conclusion and fix description.
- **HTML report**: the same information is rendered as a self-contained HTML table at `output/fix-<YYYY-MM-DD>-<HHMMSS>.html`, with one row per failure and columns for Test name, Type, Verdict (`Bug in portal` / `Outdated test` / `Unresolved`), Conclusion, Resolution time, Jira ticket, and PR. Claude prints a clickable link to the file at the end of the conversational output.

![Sample HTML report](docs/report-screenshot.png)
