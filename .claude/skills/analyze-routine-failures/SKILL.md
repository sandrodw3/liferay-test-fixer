---
name: analyze-routine-failures
description: Analyze the most recent failures of a Testray routine. Given a routine ID, runs the project's `collect` script to produce a fresh JSON snapshot of failures, then for each failure investigates likely root causes by inspecting the test code, the recorded `errorTrace`, the commit window between `lastPassSha` and `firstFailSha`, and lazily-resolved Liferay portal module dependencies. Suspect commits are grouped into `LPD-XXXXX` clusters when they share a ticket prefix. Static analysis only — no test execution. Produces a markdown table in English with verdict, suspect cluster(s), confidence, and fix proposals.
---

# Analyze routine failures

Investigate the failures of a single Testray routine and produce an analysis report describing, for each failure, the likely culprit commit(s), whether the failure represents a portal bug or an outdated test, and a fix proposal — with an explicit confidence level per row.

## Invocation

```
/analyze-routine-failures <routineId>
```

- `<routineId>` (required, positive integer) — Testray routine to analyze.

## Hard preconditions

Verify all of these before doing any analysis. Fail fast with a clear message if any is missing.

- The current working directory is the `liferay-test-analyzer` project root (a `package.json` with the `collect` script must exist).
- `.env.local` exists and exports `TESTRAY_CLIENT_ID`, `TESTRAY_CLIENT_SECRET`, and `LIFERAY_PORTAL_PATH`.
- `LIFERAY_PORTAL_PATH` points to a directory that is a git checkout of `liferay-portal` and is currently on `master`.

## Output language

The final report and every label/column/section header in it MUST be written in English, regardless of the conversation language. This is the persisted artefact; conversational updates to the user during the run can be in whatever language the user is using.

## Workflow

### 1. Run the collect script

```
npm run collect -- <routineId>
```

The script writes `output/test-failures-<YYYY-MM-DD>.json`. Always read the file path printed on stdout — do not guess the filename. Read that JSON; the rest of the workflow operates on its contents.

### 2. Defensive git fetch

In the portal repo, fetch quietly so any `lastPassSha`/`firstFailSha` is reachable:

```
git -C "$LIFERAY_PORTAL_PATH" fetch --quiet origin master
```

Verify the working tree is clean and the current branch is `master` (or a checkout of `master`). If not, abort with a clear message — never modify the user's working tree.

### 3. Resolve dependencies on demand (lazy)

Do **not** walk all of `modules/` upfront — that is expensive (tens of thousands of directories) and most of it is irrelevant to a given run. Resolve module info lazily, per failure:

- **Test's module**: the closest ancestor of the test file containing a `build.gradle`. In Liferay this is typically `modules/apps/<category>/<name>-test` for tests and `modules/apps/<category>/<name>` (or `<name>-impl`, `<name>-web`, `<name>-api`) for production code.
- **Direct dependencies of the test's module**: read the `dependencies { ... }` block of its `build.gradle` only when needed (i.e., when the in-module commit list is short and you need to widen the search).
- **SUT (system under test) for functional tests**: derive from the feature name in the test's path or title (e.g., `fragment-web/...` → `modules/apps/fragment/fragment-web`). For Java tests, derive from production imports inside the test class.

The cheap signal that scales is `git log <range> -- <module-path> [<dep-path-1> ...]` — this gives you commits in the window touching the test's relevant code without ever materialising a full repo dependency graph. Cache module paths and dep lookups by test once you compute them; reuse across failures that share a module.

### 4. Classify each failure by type

For each entry in the JSON's `failures` array, branch by `type`:

| Type label                 | Action                                         |
| -------------------------- | ---------------------------------------------- |
| `Java Unit`                | Full static pipeline.                          |
| `Java Integration`         | Full static pipeline.                          |
| `Playwright`               | Full static pipeline.                          |
| `Poshi`                    | Full static pipeline.                          |
| `JavaScript`               | Full static pipeline.                          |
| `Java Semantic Versioning` | **Skip analysis.** Verdict `skipped`, no note. |
| `Java Log Assertor`        | **Skip analysis.** Verdict `skipped`, no note. |
| `Batch`                    | **Skip analysis.** Verdict `skipped`, no note. |

The skipped types still appear in the final table so the user has a complete picture of the routine's failures, but no analysis is performed for them. For every skipped row, leave **Suspect commit(s)**, **Confidence**, and **Fix proposal** as `—` (em dash). Do not write rationale strings, version disclaimers, or any other filler in those cells.

### 5. Static analysis pipeline (per non-skipped failure)

#### 5a. Locate the test in `liferay-portal`

Map `name` → file path using the strategy for each type:

- **Java Unit / Java Integration**: `name` is typically `com.liferay.x.y.SomeTest` or `com.liferay.x.y.SomeTest#someMethod`. Strip the `#method` if present, convert dots to slashes, then locate:
    - For unit: `find "$LIFERAY_PORTAL_PATH/modules" -path '*/src/test/java/*' -name 'SomeTest.java'`
    - For integration: `find "$LIFERAY_PORTAL_PATH/modules" -path '*/src/testIntegration/java/*' -name 'SomeTest.java'`
- **Playwright**: `name` usually includes the `.spec.ts` filename. Search:
    - `find "$LIFERAY_PORTAL_PATH/modules/test/playwright/tests" -name '<spec-name>.spec.ts'`
    - If multiple matches, narrow by the test title text inside the file.
- **Poshi**: `name` typically matches `<TestCaseName>#<method>`. Search:
    - `find "$LIFERAY_PORTAL_PATH" -path '*/testFunctional/tests/*' -name '<TestCaseName>.testcase'`
- **JS Unit**: `name` is the test description; locate the `.test.js` file:
    - `grep -rl --include='*.test.js' "<test-description-substring>" "$LIFERAY_PORTAL_PATH/modules"`

If no match: report `verdict: unclear`, `confidence: low`, note "test file could not be located", skip the rest of the pipeline for this failure.

If multiple plausible matches (common — Liferay has many `*Test.java` files with overlapping names): pick the one whose containing path has the **longest overlap with the test's full namespace**. For Java, that is the file whose package path matches the most segments of the FQN read left-to-right (`com/liferay/x/y/z/test/SomeTest.java` beats `com/liferay/x/y/test/SomeTest.java` when the FQN is `com.liferay.x.y.z.test.SomeTest`). For Playwright/Poshi/JS, pick the file whose directory chain best matches the feature path encoded in the test name. If still ambiguous, list all candidates in the notes and proceed with the most specific.

Read the test file. Also read the SUT (the production module the test exercises) when it can be inferred — for Java tests, infer from imports of `com.liferay.*` classes; for Playwright/Poshi, infer from the feature name in the test's path or title.

#### 5b. Resolve the commit window

```
git -C "$LIFERAY_PORTAL_PATH" log --pretty=format:'%H %s' <lastPassSha>..<firstFailSha>
```

If either hash is `null` in the JSON (no recorded last-passed or first-failed), state that in the row and proceed with whatever side of the window is available — confidence is automatically `low` in that case.

#### 5c. Mechanical filter (no LLM)

For each commit in the window, run `git -C "$LIFERAY_PORTAL_PATH" show --name-only --pretty=format: <hash>` to get the changed files. Cache results by hash so repeated lookups across failures are free.

Map each file to its module (the closest ancestor directory that contains a `build.gradle`). Score the commit:

- **Plausible**: the commit touches the test's own module; or a module in the test's direct dependencies (resolved lazily per step 3); or — for functional tests — the SUT module or its direct dependencies.
- **Improbable**: the commit only touches unrelated modules, top-level docs, lockfiles, formatting-only diffs, or non-source files.

Discard improbable commits from further analysis. Keep plausible ones (typically 10–40 even when the window is 200–500).

#### 5c-bis. Group plausible commits into clusters

Liferay commits typically come in groups sharing a Jira-style ticket prefix in the subject (`LPD-XXXXX`). Treat these as **clusters** — a single semantic change unit. Group the plausible commits by their `LPD-XXXXX` prefix (or `LRCI-`, `LRQA-`, etc.) before judgment. Cluster names are how the report refers to suspects: `LPD-86647 cluster (db505b62, b84892df)` reads better and is more accurate than naming a single commit when the change actually spans many.

Commits without a recognisable ticket prefix stay as standalone candidates.

#### 5d. LLM judgment on plausible commits and clusters

For each plausible cluster (and each standalone commit), read the diffs (`git -C "$LIFERAY_PORTAL_PATH" show <hash>`) plus the commit messages, and reason about whether the cluster could plausibly produce the failure described in `errorTrace`. Take into account:

- The exact exception type and key tokens of the error message.
- The line numbers / class / method named in the stacktrace, when present.
- The behavioural change introduced by the cluster (renames, signature changes, removed APIs, changed selectors, modified queries, etc.).
- Whether the cluster changes only test code (suggests the test was being updated and may be incomplete) or only production code or both.

Rank the candidates and select the **top 1–3 suspect clusters/commits**. Quote them in the report as `<ticket> cluster (<short-hash-1>, <short-hash-2>)` when they are clusters, or as `<short-hash> <subject>` for standalone ones.

#### 5e. Verdict and confidence

For each non-skipped failure, decide:

- **Verdict**:
    - `bug-in-portal` — top suspect changes production code in a way consistent with the failure; test code is reasonable.
    - `outdated-test` — top suspect changes the test, or changes production in a way the test should have been updated for (renamed selector, removed API, etc.).
    - `unclear` — no plausible candidate stands out, or evidence is too weak to commit to either of the above.
- **Confidence**:
    - `high` — small window (<50 commits), one or two candidates clearly correlate with the error, stacktrace is precise, dependency match is direct.
    - `medium` — moderate window or multiple plausible candidates, decent correlation, some uncertainty.
    - `low` — large window with many plausible candidates, vague stacktrace, indirect dependency match, the test could not be located, **or 0 in-window commits in the test's module** (transitive break — honest signal that the static pipeline cannot pinpoint without traversing the full dep graph).
- **Fix proposal**: a one- or two-sentence concrete suggestion (e.g., "revert `<hash>` or restore the removed `getFooBar` method", "update selector `[data-qa=submit]` → `[data-qa=submit-button]` to match `<hash>`", "investigate timing change in `<module>`, possibly add explicit wait").

### 6. Generate the report

Produce the report in two formats, one per destination:

1. **Conversation (markdown)**: print the full markdown report directly in the chat so the user sees it without opening a file. Same content as the structure below.
2. **Disk (HTML)**: render the same content as a self-contained HTML file at `output/analysis-<YYYY-MM-DD>.html` (same `output/` directory `collect` writes the JSON to). Use today's date in the filename; if the file already exists for today, overwrite it — one analysis per day, mirroring the JSON snapshot's convention. Do **not** also write a `.md` copy.

After printing the markdown report in the conversation, end your final message with a single line linking to the generated HTML — `Report saved to [file:///<absolute-path>/output/analysis-<YYYY-MM-DD>.html](file:///<absolute-path>/output/analysis-<YYYY-MM-DD>.html)` — using the absolute `file://` URL so it opens directly in a browser.

#### 6a. Markdown structure (conversation)

```markdown
# Routine <routineId> failure analysis (<YYYY-MM-DD>)

Build: <buildId> · Hash: <hash> · Failures: <n> total (<n_skipped> skipped)

| #   | Test | Type                     | Suspect commit(s)         | Verdict       | Confidence | Fix proposal                         |
| --- | ---- | ------------------------ | ------------------------- | ------------- | ---------- | ------------------------------------ |
| 1   | …    | Java Unit                | `abc1234` Refactor X      | bug-in-portal | high       | Revert `abc1234` or restore `getX()` |
| 2   | …    | Playwright               | `def5678` Update selector | outdated-test | medium     | Update selector to match `def5678`   |
| 3   | …    | Java Semantic Versioning | —                         | skipped       | —          | —                                    |
| …   |

## Details

### 1. <test name>

- **Window**: `<lastPassed>..<firstFailed>` (<n> commits)
- **Located at**: `modules/.../SomeTest.java`
- **Suspect commits**:
    - `abc1234` <subject> — <one-line rationale linking the diff to the error>
    - `bbb5678` <subject> — <one-line rationale>
- **Reasoning**: <2–4 sentences explaining the verdict>
- **Fix**: <concrete proposal>

### 2. <test name>

…
```

For every `skipped` row, set **Suspect commit(s)**, **Confidence**, and **Fix proposal** to `—`. Do not write rationale strings or version disclaimers in those cells.

#### 6b. HTML template (disk)

The HTML is a single self-contained file (no external CSS/JS, no CDN links). Use exactly the structure and `<style>` block below — it has been validated for column overflow, long `<code>` wrapping, sticky header, and per-verdict colour cues. Substitute the placeholders (`<routineId>`, `<YYYY-MM-DD>`, `<buildId>`, `<hash>`, `<n>`, `<n_skipped>`) and emit one `<tr>` per failure plus one `<section class="detail …">` per non-skipped failure.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Routine <routineId> failure analysis (<YYYY-MM-DD>)</title>
<style>
  :root {
    --c-bug: #c0392b;
    --c-outdated: #d68910;
    --c-skipped: #7f8c8d;
    --c-unclear: #5d6d7e;
    --c-bg: #fdfdfd;
    --c-fg: #1c1c1c;
    --c-muted: #5a6772;
    --c-border: #e1e4e8;
    --c-row: #f6f8fa;
    --c-code-bg: #eef1f4;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--c-bg);
    color: var(--c-fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 1180px; margin: 0 auto; padding: 32px 28px 80px; }
  h1 { margin: 0 0 4px; font-size: 26px; }
  .summary {
    color: var(--c-muted);
    font-size: 14px;
    margin-bottom: 28px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--c-border);
  }
  h2 {
    margin: 36px 0 14px;
    font-size: 20px;
    border-bottom: 1px solid var(--c-border);
    padding-bottom: 6px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    table-layout: fixed;
  }
  thead th {
    position: sticky;
    top: 0;
    background: #f0f3f6;
    text-align: left;
    padding: 10px 10px;
    border-bottom: 2px solid var(--c-border);
    font-weight: 600;
  }
  thead th:nth-child(1) { width: 40px; }
  thead th:nth-child(2) { width: 18%; }
  thead th:nth-child(3) { width: 10%; }
  thead th:nth-child(4) { width: 20%; }
  thead th:nth-child(5) { width: 11%; }
  thead th:nth-child(6) { width: 9%; }
  thead th:nth-child(7) { width: auto; }
  thead th:nth-child(6),
  tbody td:nth-child(6) { padding-left: 18px; }
  tbody td {
    padding: 10px;
    border-bottom: 1px solid var(--c-border);
    vertical-align: top;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  tbody tr:nth-child(even) td { background: var(--c-row); }
  td.col-num { color: var(--c-muted); }
  td.col-type { white-space: normal; }
  td code, dd code, section.detail code {
    overflow-wrap: anywhere;
    word-break: break-word;
    white-space: normal;
  }
  .verdict {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 600;
    color: white;
    white-space: nowrap;
  }
  .verdict.bug-in-portal { background: var(--c-bug); }
  .verdict.outdated-test { background: var(--c-outdated); }
  .verdict.unclear { background: var(--c-unclear); }
  .verdict.skipped { background: var(--c-skipped); }
  .conf {
    display: inline-block;
    font-size: 12px;
    color: var(--c-muted);
    text-transform: lowercase;
  }
  .conf.high { color: #1e8449; font-weight: 600; }
  .conf.medium { color: #b9770e; font-weight: 600; }
  .conf.low { color: #7d3c98; }
  code {
    background: var(--c-code-bg);
    padding: 1px 5px;
    border-radius: 3px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.92em;
  }
  section.detail {
    margin: 22px 0;
    padding: 16px 18px;
    background: var(--c-row);
    border-left: 3px solid var(--c-border);
    border-radius: 4px;
  }
  section.detail.bug-in-portal { border-left-color: var(--c-bug); }
  section.detail.outdated-test { border-left-color: var(--c-outdated); }
  section.detail.unclear { border-left-color: var(--c-unclear); }
  section.detail.skipped { border-left-color: var(--c-skipped); }
  section.detail h3 {
    margin: 0 0 10px;
    font-size: 15px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    word-break: break-all;
  }
  section.detail dl {
    margin: 0;
    display: grid;
    grid-template-columns: 120px minmax(0, 1fr);
    gap: 6px 14px;
  }
  section.detail dt { font-weight: 600; color: var(--c-muted); font-size: 13px; }
  section.detail dd { margin: 0; font-size: 13px; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
  section.detail ul { margin: 4px 0; padding-left: 18px; }
  section.detail li { margin-bottom: 3px; overflow-wrap: anywhere; word-break: break-word; }
</style>
</head>
<body>
<main>
  <h1>Routine <routineId> failure analysis (<YYYY-MM-DD>)</h1>
  <p class="summary">
    Build: <code><buildId></code> ·
    Hash: <code><hash></code> ·
    Failures: <n> total (<n_skipped> skipped)
  </p>

  <table>
    <thead>
      <tr>
        <th>#</th><th>Test</th><th>Type</th><th>Suspect commit(s)</th>
        <th>Verdict</th><th>Confidence</th><th>Fix proposal</th>
      </tr>
    </thead>
    <tbody>
      <!-- One <tr> per failure. Skipped rows: cols 4, 6, 7 are em dashes. -->
      <tr>
        <td class="col-num">1</td>
        <td>SomeTest</td>
        <td class="col-type">Java Unit</td>
        <td><code>abc1234</code> Refactor X</td>
        <td><span class="verdict bug-in-portal">bug-in-portal</span></td>
        <td><span class="conf high">high</span></td>
        <td>Revert <code>abc1234</code> or restore <code>getX()</code>.</td>
      </tr>
      <tr>
        <td class="col-num">2</td>
        <td>SomeBatchEntry</td>
        <td class="col-type">Java Semantic Versioning</td>
        <td>—</td>
        <td><span class="verdict skipped">skipped</span></td>
        <td>—</td>
        <td>—</td>
      </tr>
    </tbody>
  </table>

  <h2>Details</h2>

  <!-- One <section> per non-skipped failure. Class on <section> mirrors the verdict for the left border colour. -->
  <section class="detail bug-in-portal">
    <h3>1. SomeTest</h3>
    <dl>
      <dt>Window</dt><dd><code>abc1234..def5678</code> (N commits)</dd>
      <dt>Located at</dt><dd><code>modules/.../SomeTest.java</code></dd>
      <dt>Suspect</dt><dd>
        <ul>
          <li><code>abc1234</code> &lt;subject&gt; — &lt;rationale&gt;</li>
        </ul>
      </dd>
      <dt>Reasoning</dt><dd>2–4 sentences.</dd>
      <dt>Fix</dt><dd>Concrete proposal.</dd>
    </dl>
  </section>
</main>
</body>
</html>
```

The CSS already handles the failure modes encountered during validation:

- `table-layout: fixed` plus explicit per-column widths keeps `Verdict`/`Confidence` from being squeezed by long suspect lists.
- `overflow-wrap: anywhere` + `word-break: break-word` on cells, `<code>`, `<dd>`, `<li>` lets long Java identifiers and file paths wrap inside the cell.
- `grid-template-columns: 120px minmax(0, 1fr)` plus `min-width: 0` on `<dd>` prevents long values in the details `<dl>` from blowing out the section width.
- Extra `padding-left: 18px` on the Confidence column gives breathing room from the `Verdict` pill.

Do not modify the CSS unless a new failure mode appears — and if you do, update this template too.

## Hard rules

- **Read-only on liferay-portal**: never `checkout`, `reset`, `stash`, or otherwise modify the working tree of `LIFERAY_PORTAL_PATH`. The `git fetch` in step 2 is the only mutating command allowed, and only on the local refs (no `pull`).
- **Never commit or push** in either repo.
- **English output** for the final report. Conversational status updates can be in the user's language.
- **Skip Batch / Java Log Assertor / Java Semantic Versioning** entirely — they go in the table as `skipped`, no analysis.
- **Never run tests automatically**: this skill performs static analysis only.
- **Fail clearly on missing preconditions** — do not silently substitute defaults for missing env vars or unreachable hashes.
- **Cache `git show` results by hash** during a single run; do not re-shell for the same commit when it appears in multiple failures' windows.
- **Confidence must be honest**: when the window is huge or the test couldn't be located, say so with `low` and explain in the notes; do not overstate.
- **No file mutations outside the project** — the skill writes only inside `output/` (the HTML report alongside the JSON already written by `collect`) and never touches anything outside the project root.
