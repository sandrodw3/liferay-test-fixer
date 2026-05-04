# Liferay Test Analyzer

Static analysis tooling that pulls Testray routine failures and lets Claude Code investigate them against a local `liferay-portal` repository.

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

### 4. Analyze the snapshot

```
/analyze-routine-failures <routineId>
```

Claude picks the most recent snapshot for that routine in `output/`, walks the commit window between `lastPassSha` and `firstFailSha` for each failure, and classifies each one as `bug-in-portal`, `outdated-test`, or `unclear` with a confidence level and a fix proposal.

This skill does not call Testray — it consumes the JSON produced by `/collect-routine-failures`. Re-run the collect skill whenever you want a fresh snapshot.

### 5. Read the output

- **Conversational report**: Claude prints the full analysis as a markdown table directly in the chat — verdict, suspect commit clusters, confidence, and fix proposal per failure.
- **HTML report**: the same analysis is rendered as a self-contained HTML page at `output/analysis-<routineId>-<YYYY-MM-DD>.html`, with the table and per-failure summary formatted for reading in a browser. Claude prints a clickable link to it at the end of the conversational output.

![Sample HTML report](docs/report-screenshot.png)
