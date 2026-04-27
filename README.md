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

### 3. Ask Claude to analyze a routine

From inside this repo, invoke the skill in Claude Code:

```
/analyze-routine-failures <routineId>
```

Claude will run a `collect` script to prepare a resulting JSON, walk the commit window between `lastPassedHash` and `firstFailedHash` for each failure, and classify each one as `bug-in-portal`, `outdated-test`, or `unclear` with a confidence level and a fix proposal.

### 4. Read the output

- **Conversational report**: Claude prints the full analysis as a markdown table directly in the chat — verdict, suspect commit clusters, confidence, and fix proposal per failure.
- **HTML report**: the same analysis is rendered as a self-contained HTML page at `output/analysis-<YYYY-MM-DD>.html`, with the table and per-failure summary formatted for reading in a browser. Claude prints a clickable link to it at the end of the conversational output.

![Sample HTML report](docs/report-screenshot.png)
