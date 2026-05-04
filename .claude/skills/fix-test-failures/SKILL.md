---
allowed-tools: [Bash, Edit, Glob, Grep, Read, Skill, Write]
argument-hint: '<caseResultId> [caseResultId...]'
description: Resolve one or more Liferay test failures end-to-end against the local liferay-portal checkout pointed at by ${LIFERAY_PORTAL_PATH}. Accepts one or more Testray case result IDs separated by whitespace and processes each in turn — fetching the failure data through `/collect-failure-data`, reproducing the failure, isolating the offending commit in the SHA range, iterating a fix on the test or the product code, filing a Jira ticket, committing, and opening a PR. Produces a markdown summary in the chat plus a self-contained HTML table at `output/fix-<YYYY-MM-DD>-<HHMMSS>.html` listing every test, its verdict, conclusion, resolution time, ticket and PR. Use when the user invokes /fix-test-failures with one or more Testray case result IDs.
name: fix-test-failures
---

# Fix Test Failures

Resolve one or more test failures end-to-end. Take one or more Testray case result IDs, fetch each failure's data through `/collect-failure-data`, switch into the local liferay-portal checkout pointed at by `${LIFERAY_PORTAL_PATH}`, and process each failure in turn: reproduce it, identify the offending change in the supplied SHA range, fix the responsible side (test or product), file a Jira ticket, commit, and open a PR. When all failures have been processed (or skipped), print a markdown summary and render a self-contained HTML report from the template under `references/`.

## Input

`${ARGUMENTS}` is one or more positive integers separated by whitespace, each one a Testray case result ID. Tokenise on whitespace into a list and abort immediately when the result is empty or any token is not a positive integer.

For each case result ID, the failure data is fetched at the start of its iteration by invoking the `collect-failure-data` script (the same one `/collect-failure-data` runs). The script writes the failure object directly to `output/test-failure-<caseResultId>-<YYYY-MM-DD>.json` (no wrapper), with these fields:

- **errorTrace** — error trace produced by the test framework.
- **firstFailSha** — first commit where the test failed (may be `null` when the case has no recorded failure history).
- **lastPassSha** — commit where the test last passed (may be `null` when the case has no recent pass on record).
- **name** — test name (class, spec, or method).
- **type** — one of `Java Integration`, `Java Semantic Versioning`, `Java Unit`, `JavaScript`, `Playwright`, `Poshi`.

## Hard Preconditions

Verify all of these once at the start of the run, before processing any failure. Fail fast with a clear message if any is missing.

- The current working directory is the `liferay-test-fixer` project root.
- `.env.local` exists at the project root and exports `LIFERAY_PORTAL_PATH`.
- `${LIFERAY_PORTAL_PATH}` points to a directory that is a git checkout of `liferay-portal`.
- That checkout has a clean working tree (`git -C "${LIFERAY_PORTAL_PATH}" status --porcelain` is empty).
- That checkout is on `master`.
- The Liferay portal responds on port 8080 (required for `Java Integration`, `Playwright`, and `Poshi`):

    ```bash
    curl \
    	--fail \
    	--output /dev/null \
    	--silent \
    	--url http://localhost:8080
    ```

    Abort with a clear message when it does not respond.

- Resolve the bundles directory once and reuse it as `<bundles>` everywhere below. It is the value of `app.server.parent.dir` in `${LIFERAY_PORTAL_PATH}/app.server.${USER}.properties` (falling back to `${LIFERAY_PORTAL_PATH}/app.server.properties`).

## Cross-Repo Skills

The `jira-bug`, `jira-task`, `format-source`, `commit`, and `pr` skills referenced in this workflow live in `${LIFERAY_PORTAL_PATH}/.claude/skills/`, not in this project. They are not available via the `Skill` tool when this workflow runs from `liferay-test-fixer`. When a step says "invoke the `<name>` skill", read its `SKILL.md` from that directory and apply its workflow inline, executing the equivalent commands against `${LIFERAY_PORTAL_PATH}`.

## Workflow

Capture the fixer project root before doing anything else — the per-iteration `collect-failure-data` step runs from there, and the final HTML report is written there too:

```bash
export LIFERAY_TEST_FIXER_PATH=$(pwd)
```

Resolve `${LIFERAY_PORTAL_PATH}` from `.env.local` and switch to it before processing any failure. Every command from here on (other than the per-iteration collect call, which runs in a subshell) operates against that checkout:

```bash
export LIFERAY_PORTAL_PATH=$(grep '^LIFERAY_PORTAL_PATH=' "${LIFERAY_TEST_FIXER_PATH}/.env.local" | cut --delimiter='=' --fields=2)
cd "${LIFERAY_PORTAL_PATH}"
```

Record the workflow start time so the final report can include elapsed duration:

```bash
date +%s > /tmp/fix-test-failures.start
```

Initialise an empty in-memory results array. One entry will be appended for every input failure, regardless of whether it ends up resolved or unresolved:

```jsonc
{
	"name": "<test-name>",
	"type": "<type>",
	"verdict": "Bug in portal" | "No fix needed" | "Outdated test" | "Unresolved",
	"conclusion": "<one sentence — for resolved failures, what broke and which commit caused it; for `No fix needed`, the literal string 'Test passes locally'; for unresolved ones, what was tried and why it did not converge>",
	"resolutionTime": "<minutes>m <seconds>s",
	"ticketUrl": "https://liferay.atlassian.net/browse/LPD-XXXXX" | null,
	"prUrl": "https://github.com/.../pull/N" | null
}
```

Then iterate over the input case result IDs. **At the start of every iteration**, snapshot the iteration start time so the per-failure resolution time can be computed when the entry is recorded:

```bash
date +%s > /tmp/fix-test-failures.iter-start
```

Then fetch the failure data for the current case result ID by invoking `collect-failure-data` from the fixer root in a subshell — the parent shell stays in `${LIFERAY_PORTAL_PATH}`:

```bash
(cd "${LIFERAY_TEST_FIXER_PATH}" && npm run --silent collect-failure-data -- "${CASE_RESULT_ID}") 2> /tmp/fix.err
```

On success, the script writes the failure JSON to `${LIFERAY_TEST_FIXER_PATH}/output/test-failure-${CASE_RESULT_ID}-$(date +%Y-%m-%d).json`. Read that file — its fields (`name`, `type`, `errorTrace`, `lastPassSha`, `firstFailSha`) are the failure object for the rest of the iteration. `lastPassSha` and `firstFailSha` may individually be `null`; downstream steps handle the degraded ranges. Continue to step 1.

On failure, no JSON is written. Append a result entry with `name: "case-result <CASE_RESULT_ID>"`, `type: "Unknown"`, the message from `/tmp/fix.err` as `conclusion`, and verdict `No fix needed` when the exit code is `2` (the case is `PASSED`) or `Unresolved` otherwise. Run the cleanup in step 10 and continue with the next case result.

For each failure, run steps 1–10 below. After each iteration — whether it succeeded or aborted — make sure the working tree is back on a clean `master` before starting the next one:

```bash
git -C "${LIFERAY_PORTAL_PATH}" checkout master
git -C "${LIFERAY_PORTAL_PATH}" reset --hard origin/master  # only when the previous iteration aborted with uncommitted changes
```

When **any** iteration aborts (test does not reproduce, iteration budget exhausted, test file cannot be located, …): record an `Unresolved` entry in the results — its `conclusion` must summarise the investigation honestly, listing the most relevant attempts so the user can pick up from there — run the portal cleanup in step 10, restore `master`, and continue with the next failure. Never stop the entire batch because of one bad failure.

Once every failure has been processed, jump to step 11 (final report).

Whenever an entry is appended to the results array (resolved in step 9, unresolved at any abort point), compute the iteration's elapsed time first and store it as `resolutionTime`:

```bash
ITER_START=$(cat /tmp/fix-test-failures.iter-start)
ITER_END=$(date +%s)
ITER_ELAPSED=$((ITER_END - ITER_START))
ITER_MINUTES=$((ITER_ELAPSED / 60))
ITER_SECONDS=$((ITER_ELAPSED % 60))
```

Format it as `${ITER_MINUTES}m ${ITER_SECONDS}s`. The iteration-start file is overwritten at the top of the next iteration, so it does not need to be removed between failures.

### 1. Locate the Test

| Type                            | Search                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `Java Integration`, `Java Unit` | `find modules portal-impl -name "<name>.java"`                                 |
| `Java Semantic Versioning`      | the failing module is the location; no test file                               |
| `JavaScript`                    | `*.test.{ts,tsx,js,jsx}` matching `<name>` under the suspected `-web` module   |
| `Playwright`                    | `grep --files-with-matches --recursive "<name>" modules/test/playwright/tests` |
| `Poshi`                         | `find portal-web/test/functional -name "<name>.testcase"`                      |

Ask the user when the search yields zero or multiple matches. When the user is unreachable or the answer is unclear, mark the failure as `Unresolved` with a `conclusion` along the lines of "Test file could not be located. Searched <pattern> under <path>; <N> candidates found, none unambiguous." and continue with the next one.

### 2. Reproduce Locally

This step runs **before** any range or commit analysis. The test may already pass locally — when it does, the iteration ends here without any further investigation.

#### 2.1. Set Feature Flags

Inspect the test source to discover which feature flags it depends on. Mirror the CI setup before reproducing, otherwise the test path differs.

- **Backend tests** (`Java Integration`, `Poshi`) read flags from `<bundles>/portal-ext.properties`. Before editing it for the first time in this run, snapshot it so it can be restored later:

    ```bash
    cp <bundles>/portal-ext.properties /tmp/portal-ext.properties.bak
    ```

    Then add the required flags. The portal must be restarted for new flag values to take effect:

    ```bash
    <bundles>/tomcat-*/bin/shutdown.sh
    while curl --fail --output /dev/null --silent --url http://localhost:8080; do sleep 2; done
    <bundles>/tomcat-*/bin/startup.sh
    until curl --fail --output /dev/null --silent --url http://localhost:8080; do sleep 5; done
    ```

- **Playwright tests** declare flags through the `featureFlagsTest` fixture under `modules/test/playwright/fixtures`. The fixture toggles them per test — no portal change is needed.

#### 2.2. Run the Test

When the type requires deployed modules, deploy them first from the module root:

```bash
cd <module-root> && <gradlew> deploy
```

| Type                       | Deploy | Command                                                                                                                                        |
| -------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `Java Integration`         | Yes    | `cd <module> && <gradlew> testIntegration --tests <FQN>`                                                                                       |
| `Java Semantic Versioning` | No     | `cd <module> && <gradlew> baseline`                                                                                                            |
| `Java Unit`                | No     | `cd <module> && <gradlew> test --tests <FQN>`                                                                                                  |
| `JavaScript`               | No     | `cd <module> && yarn test <file>`                                                                                                              |
| `Playwright`               | Yes    | `cd modules/test/playwright && npx playwright test <file>`                                                                                     |
| `Poshi`                    | Yes    | `HOSTNAME=localhost ANT_OPTS="-Xmx2560m" ant --buildfile build-test.xml run-selenium-test -Dtest.class=<File>#<Test>` from the repository root |

When the run produces a stack trace, also read `<bundles>/logs/liferay.<date>.log` around the failure timestamp. The server log usually contains a longer trace than **serverTrace**.

Compare the local outcome with **errorTrace**:

- **Test passes** → mark the failure as `No fix needed` with the `conclusion` set to the literal string `Test passes locally`. **Do not** investigate further: skip step 3 (diagnosis), step 4 (iteration), and steps 5–9 (ticket, branch, format, commit, PR). Run the cleanup in step 10, append the result entry, and continue with the next failure.
- **Same failure** → continue to step 3.
- **Different failure** → surface the diff and ask the user whether to proceed. When the user is unreachable or declines, mark the failure as `Unresolved` with a `conclusion` summarising both traces (the one in the input JSON and the one observed locally) and continue to the next one.

### 3. Diagnose the Cause

The breaking change lies in the suspect diff between `${LAST_PASS_SHA}` and `${FIRST_FAIL_SHA}`. Before iterating, identify which commit broke the test and form a working hypothesis on whether the change was **intentional** (test is outdated) or **accidental** (product regression). The hypothesis is provisional — iteration may sharpen it — but starting without one means the verdict ends up decided by which fix happens to reach green first.

#### 3.1 Pinpoint the offending commit

```bash
git log --oneline ${LAST_PASS_SHA}..${FIRST_FAIL_SHA}
git diff --stat ${LAST_PASS_SHA}..${FIRST_FAIL_SHA}
```

Two high-signal probes — use them before reading commits one by one:

- For the file that owns the line nearest the failing assertion or the topmost frame in **errorTrace**:

    ```bash
    git log -L <line>,<line>:<file> ${LAST_PASS_SHA}..${FIRST_FAIL_SHA}
    ```

- When the failure is a missing UI text, message, or element (typical for `Playwright` and `Poshi`), grep the suspect diff for the exact string the test was looking for:

    ```bash
    git log -S "<exact-string-from-assertion>" ${LAST_PASS_SHA}..${FIRST_FAIL_SHA}
    ```

When neither probe points to a single commit, fall back to the candidate ordering: files in the test's own module first, then modules whose packages the test imports, then `*-api` / `portal-kernel` / shared `frontend-js-*`, then `portal-impl` / `petra-*` / shared infrastructure.

#### 3.2 Form the hypothesis

Read the offending commit's documented intent — the commit message, the linked Jira ticket when the subject carries an `LPD-XXXXX` key, and the GitHub PR body when the commit landed via a PR:

```bash
git show <offending-sha>

curl \
	--header "Content-Type: application/json" \
	--silent \
	--url "https://liferay.atlassian.net/rest/api/3/issue/LPD-XXXXX?fields=summary,issuetype,description" \
	--user "${JIRA_API_USER}:${JIRA_API_TOKEN}"

gh pr list --search "<offending-sha>" --repo brianchandotcom/liferay-portal --state merged --json number,title,body
```

The single question to answer: **does the commit's documented scope (subject + ticket + PR) explicitly cover the behavior the test was asserting on?**

- **Yes** → hypothesis is `Outdated test`. The change was intentional and the assertion checks a contract that no longer exists.
- **No** → hypothesis is `Bug in portal`. The broken behavior is a side effect, not the goal of the change. This is also the default when the answer is unclear: tests encode expectations, and silencing an assertion without documented justification is worse than restoring product behavior that was probably dropped by accident.
- **No offending commit was reliably identified, or no documentation exists at all** → mark the failure as `Unresolved` with a `conclusion` listing the candidate commits and what was tried. Do not iterate.

Record the hypothesis in the conversation as a single short paragraph: offending commit short SHA and subject, linked ticket key / type / summary (or "no linked ticket"), one sentence answering the question above with cited evidence, and the hypothesis verdict. The same paragraph is reused in the PR body's "Root Cause" section in step 9.

### 4. Iterate Until Green

Work on `master` with uncommitted changes — the branch is created later, once the fix is confirmed. Apply a fix consistent with the hypothesis from step 3.2, then run the test command from step 2.2. For types that require deploy, redeploy the affected modules between attempts.

The fix must touch something inside the suspect diff: revert or correct the offending hunks (`Bug in portal`), or adapt the test to the new contract documented in those hunks (`Outdated test`). A fix that ignores the diff is fantasising — go back to step 3.

Iteration is part of diagnosis, not a rote application of the hypothesis. The hypothesis can legitimately flip while iterating, but only when iteration surfaces **new evidence** that changes the answer to step 3.2's question:

- Trying to adapt the test reveals the asserted element/UX is genuinely useful with no replacement in the offending commit → flip to `Bug in portal`.
- Trying to restore product behavior reveals the offending commit deliberately removed it as part of a documented contract change you missed on first read → flip to `Outdated test`.

What is **not** legitimate is flipping sides because the fix you tried first didn't reach green. Re-examine the diagnosis with new evidence; pure trial-and-error is not new evidence.

Stop after **5 iterations** without convergence. Mark the failure as `Unresolved` and write a `conclusion` that gives the user a real handover: hypotheses considered, attempts made (one short bullet per iteration), what each attempt changed about the failure, and the most plausible remaining lead. Run the cleanup in step 10 and continue to the next failure. Do not file a ticket or commit on incomplete work.

### 5. File the Jira Ticket

Decide the type from the change that turned the test green:

- **Bug** — product code carried the fix. Invoke the `jira-bug` skill (defined in `${LIFERAY_PORTAL_PATH}/.claude/skills/jira-bug/SKILL.md`; see "Cross-Repo Skills" above). The title summarizes the regression. The description carries the failing test name, the trace, and reproduction steps derived from the test scenario. The Bug key is the **commit key**.
- **Task** — the test carried the fix. Invoke the `jira-task` skill (defined in `${LIFERAY_PORTAL_PATH}/.claude/skills/jira-task/SKILL.md`) with title `Fix <test name>`. Then create a subtask under it with the same title via the Jira REST API. The **subtask key is the commit key** — never the parent task key.

Capture the commit key as `LPD-XXXXX` for the next steps. Branch and commits both use this key. Save the full `https://liferay.atlassian.net/browse/LPD-XXXXX` URL on the in-flight result entry as `ticketUrl`.

Tag the commit-key ticket with the `claude-test-fix` label so every ticket created by this skill stays searchable as a group:

```bash
curl \
	--data '{"update": {"labels": [{"add": "claude-test-fix"}]}}' \
	--header "Content-Type: application/json" \
	--request PUT \
	--silent \
	--url "https://liferay.atlassian.net/rest/api/3/issue/LPD-XXXXX" \
	--user "${JIRA_API_USER}:${JIRA_API_TOKEN}"
```

### 6. Create the Branch

The fix is currently uncommitted on `master`. Move it to a feature branch named after the commit key from step 5:

```bash
git stash --include-untracked
git checkout -b LPD-XXXXX master
git stash pop
```

### 7. Format

Invoke the `format-source` skill (defined in `${LIFERAY_PORTAL_PATH}/.claude/skills/format-source/SKILL.md`) once on the branch.

### 8. Commit

Invoke the `commit` skill (defined in `${LIFERAY_PORTAL_PATH}/.claude/skills/commit/SKILL.md`). The Jira-prefixed subject convention applies (`LPD-XXXXX <Subject>`) using the commit key from step 5. When the change spans unrelated hunks, split into separate commits as the skill prescribes.

### 9. Open the PR

Invoke the `pr` skill (defined in `${LIFERAY_PORTAL_PATH}/.claude/skills/pr/SKILL.md`) with `sandrodw3/liferay-portal` as the target repository. Override the user's title-only default and pass the body content explicitly so the pull request explains the regression.

The body must be Markdown with these three sections in order, each headed with `##`:

1. **Failing Test** — the test name, the path to the spec or class, and the trimmed error trace from **errorTrace**.

1. **Root Cause** — the offending commit short SHA and subject, followed by one or two sentences explaining how that change broke the test.

1. **Fix** — a short prose paragraph describing the change and why it resolves the regression, then the list of modified files.

Use this template, substituting the placeholders before invoking the `pr` skill:

```markdown
https://liferay.atlassian.net/browse/LPD-XXXXX

## Failing Test

`<test-name>`

`<test-path>`

\`\`\`
<errorTrace>
\`\`\`

## Root Cause

Commit `<short-sha>` ("<subject>") <one or two sentences>.

## Fix

<one paragraph explaining the change and why it works>.

- `<file-1>`
- `<file-2>`
```

Save the PR URL returned by the `pr` skill on the in-flight result entry as `prUrl`. Set `verdict` to `Bug in portal` or `Outdated test` and `conclusion` to a one or two sentence explanation that names the offending commit (short SHA and subject) and what changed. Compute and store `resolutionTime` as described in the workflow preamble, then append the entry to the results array.

### 10. Restore the Portal

When step 2.1 changed `<bundles>/portal-ext.properties`, restore the snapshot and restart the portal to leave it in its original state:

```bash
cp /tmp/portal-ext.properties.bak <bundles>/portal-ext.properties
rm /tmp/portal-ext.properties.bak

<bundles>/tomcat-*/bin/shutdown.sh
while curl --fail --output /dev/null --silent --url http://localhost:8080; do sleep 2; done
<bundles>/tomcat-*/bin/startup.sh
until curl --fail --output /dev/null --silent --url http://localhost:8080; do sleep 5; done
```

This step also runs when the iteration aborts in step 1, step 2, or step 4 (and when step 2 short-circuits with `No fix needed`), so the next iteration (or the user, after the last one) does not inherit a tampered properties file.

### 11. Final Report

Compute the run-level elapsed duration from the timestamp captured at the top of the workflow, then remove the timestamp file:

```bash
START=$(cat /tmp/fix-test-failures.start)
END=$(date +%s)
ELAPSED=$((END - START))
MINUTES=$((ELAPSED / 60))
SECONDS=$((ELAPSED % 60))

rm -f /tmp/fix-test-failures.start /tmp/fix-test-failures.iter-start
```

Produce the final report in two formats:

#### 11a. Conversation summary (markdown)

Print a concise summary in the chat. Structure:

```markdown
## Fix run summary (<YYYY-MM-DD HH:MM>)

Failures processed: <total> (<resolved> resolved, <noFixNeeded> no fix needed, <unresolved> unresolved) · Elapsed: <MINUTES>m <SECONDS>s

### 1. <test name> — <verdict>

- **Ticket**: [LPD-XXXXX](https://liferay.atlassian.net/browse/LPD-XXXXX)
- **PR**: [#N](https://github.com/sandrodw3/liferay-portal/pull/N)
- **Resolution time**: <Xm Ys>
- **Conclusion**: <one or two sentences naming the offending commit and what it changed>.
- **Fix**: <one or two sentences describing the change applied and why it resolves the regression>.

### 2. <test name> — No fix needed

- **Resolution time**: <Xm Ys>
- **Conclusion**: Test passes locally.

### 3. <test name> — Unresolved

- **Resolution time**: <Xm Ys>
- **Conclusion**: <handover summary — hypotheses considered, attempts made, observed effects, most plausible remaining lead>.

…
```

Per verdict:

- **Resolved** (`Bug in portal`, `Outdated test`): include all lines (Ticket, PR, Resolution time, Conclusion, Fix).
- **No fix needed**: include only Resolution time and Conclusion (which is always the literal `Test passes locally.`).
- **Unresolved**: include only Resolution time and Conclusion.

`<resolved>` is the count of entries with verdict `Bug in portal` or `Outdated test`. `<noFixNeeded>` is the count of `No fix needed` entries. `<unresolved>` is the count of `Unresolved` entries. Always render all three counts even when one is zero.

#### 11b. HTML table (disk)

The HTML template lives at `references/report.html` inside this skill. It is a single self-contained file with all required CSS already validated for column overflow, long `<code>` wrapping, sticky header, and per-verdict colour cues — do not duplicate or rewrite the markup; read the template, substitute the placeholders, and write the result to `output/`.

Make sure to switch back to the `liferay-test-fixer` project root before writing — every previous step has been operating inside `${LIFERAY_PORTAL_PATH}`. Use today's date and the current time in the filename so concurrent or sequential runs in the same day do not overwrite each other:

```bash
cd -                                            # back to the liferay-test-fixer root
TEMPLATE=.claude/skills/fix-test-failures/references/report.html
TIMESTAMP=$(date '+%Y-%m-%d-%H%M%S')
OUT="output/fix-${TIMESTAMP}.html"
```

Substitute these top-level placeholders in the template (string replace — they each appear exactly once):

| Placeholder       | Value                                                            |
| ----------------- | ---------------------------------------------------------------- |
| `{{date}}`        | `<YYYY-MM-DD>`                                                   |
| `{{time}}`        | `<HH:MM>`                                                        |
| `{{total}}`       | total number of result entries                                   |
| `{{resolved}}`    | count of entries with verdict `Bug in portal` or `Outdated test` |
| `{{noFixNeeded}}` | count of entries with verdict `No fix needed`                    |
| `{{unresolved}}`  | count of entries with verdict `Unresolved`                       |
| `{{minutes}}`     | run-level elapsed minutes                                        |
| `{{seconds}}`     | run-level elapsed seconds                                        |
| `{{rows}}`        | the concatenation of the per-entry `<tr>` snippets               |

Build `{{rows}}` by joining one snippet per result entry. Use the **resolved row** snippet for verdicts `Bug in portal` / `Outdated test`, the **no-fix-needed row** snippet for `No fix needed`, and the **unresolved row** snippet for `Unresolved`. The CSS class on the verdict pill is the kebab-cased verdict (`bug-in-portal`, `outdated-test`, `no-fix-needed`, `unresolved`).

All three row snippets wrap the test name in `<span class="test-name">{{name}}</span>` so it renders as a monospace pill (the `.test-name` class is already defined in the template's CSS).

Resolved row snippet:

```html
<tr>
	<td><span class="test-name">{{name}}</span></td>
	<td class="col-type">{{type}}</td>
	<td><span class="verdict {{verdictClass}}">{{verdict}}</span></td>
	<td>{{conclusion}}</td>
	<td class="nowrap muted">{{resolutionTime}}</td>
	<td><a href="{{ticketUrl}}">{{ticketKey}}</a></td>
	<td><a href="{{prUrl}}">#{{prNumber}}</a></td>
</tr>
```

No-fix-needed row snippet (Jira ticket and PR cells render an em dash since neither is created; the conclusion is always the literal `Test passes locally.`):

```html
<tr>
	<td><span class="test-name">{{name}}</span></td>
	<td class="col-type">{{type}}</td>
	<td><span class="verdict no-fix-needed">No fix needed</span></td>
	<td class="muted">Test passes locally.</td>
	<td class="nowrap muted">{{resolutionTime}}</td>
	<td>—</td>
	<td>—</td>
</tr>
```

Unresolved row snippet (Jira ticket and PR cells render an em dash since neither is created):

```html
<tr>
	<td><span class="test-name">{{name}}</span></td>
	<td class="col-type">{{type}}</td>
	<td><span class="verdict unresolved">Unresolved</span></td>
	<td class="muted">{{conclusion}}</td>
	<td class="nowrap muted">{{resolutionTime}}</td>
	<td>—</td>
	<td>—</td>
</tr>
```

Wrap any code identifiers inside `{{conclusion}}` in `<code>…</code>` so they pick up the table's monospace styling — the validated CSS already handles wrapping for them. For commit short SHAs, wrap them in a link to the corresponding commit on the Liferay portal repository: `<a href="https://github.com/liferay/liferay-portal/commit/<full-sha>"><code><short-sha></code></a>`. Use the **full** 40-character SHA in the URL (so the link survives any future short-SHA collisions) and the **short** 13-character SHA inside `<code>` for the visible text.

After writing the file, end the message with a single line linking to it:

```
Report saved to [file:///<absolute-path>/output/fix-<YYYY-MM-DD>-<HHMMSS>.html](file:///<absolute-path>/output/fix-<YYYY-MM-DD>-<HHMMSS>.html)
```

## Hard Rules

- The fix must touch something inside the suspect diff between `${LAST_PASS_SHA}` and `${FIRST_FAIL_SHA}` — that is the only place the regression can live. A fix outside that range means the diagnosis is wrong.
- Removing, weakening, or `@Ignore`-ing an assertion is only legitimate when the offending commit's documentation (subject, linked Jira ticket, or PR body) explicitly states the contract change the assertion was checking. Without that documented justification, the assertion is correct and the regression lives in product code.
- Never file a ticket or commit without a green local run.
- Never skip the format step.
- Never deploy-skip a type that requires deploy: `Java Integration`, `Playwright`, and `Poshi` need the modules in the bundle before the rerun.
- For Task tickets, both the branch and the commits use the subtask key, never the parent task key.
- Always restore `portal-ext.properties` before moving to the next iteration (or exiting) when step 2.1 modified it, including on abort.
- Stop iterating on a single failure when the iteration budget is exhausted, mark it as `Unresolved`, and move on. Never escalate the scope of the change to force convergence.
- One iteration aborting does not abort the batch. Continue with the remaining failures and report the unresolved one in the final table.
- When the test passes on the first local run (step 2.2), short-circuit immediately with verdict `No fix needed` and conclusion `Test passes locally`. Do **not** read the suspect diff, run `git log` over the SHA range, inspect commits, search for related branches/PRs, or perform any other investigation — the only follow-up is the portal cleanup in step 10 before moving on. The whole point of this verdict is that no time is spent on a test that already passes.
- The HTML report is always written, even when every failure ended up `Unresolved`, even when only one failure was supplied, and even when nothing succeeded.
