---
description: Fetch SonarQube issues (local or SonarCloud) and fix them systematically — validate and commit each fix
argument-hint: "<project-key or 'local'>"
allowed-tools:
  - Bash(curl:*)
  - Bash(git:*)
  - Bash(test:*)
  - Bash(npx:*)
  - Bash(./scripts/check-all.sh)
  - Read
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
---

# Purpose

Work through Sonar findings for a project: fetch issues from a local SonarQube instance **or SonarCloud**, fix them one at a time starting from the most severe, validate each fix with the repo's check script, and auto-commit.

Supports two invocation styles:
- **Cloud (simple):** Pass a SonarCloud project key → fetches issues via cloud adapter
- **Local:** Pass "local" or nothing → uses local SonarQube at localhost:9000

## Gateway

All API calls go through tool-gw at `http://localhost:9876`. If it's not running, tell the user: "Start tool-gw with `npm run dev` in the tool-gw directory."

## Instructions

### 1. Detect Source & Parse Arguments

Examine `$ARGUMENTS`:

**Cloud source** — argument looks like a project key (e.g., `NationalResearchCorporation_survey-fielding-api`):
- No scanner flags or `-D` options
- Store: `source = cloud`, `projectKey = $ARGUMENTS`

**Local source** — argument is empty, "local", or a scanner command:
- If it's a scanner command (contains `-Dsonar.`), parse connection:
  ```bash
  curl -s -X POST http://localhost:9876/sonar/parse-connection \
    -H 'Content-Type: application/json' \
    -d '{"scannerCommand": "$ARGUMENTS"}'
  ```
- If empty or "local": use `host=http://localhost:9000`, detect projectKey from directory name

Detect language from repo contents: `pyproject.toml`/`*.py` → python, `package.json`/`tsconfig.json` → typescript

### 2. Initialize Tally

```bash
curl -s -X POST http://localhost:9876/tally/init \
  -H 'Content-Type: application/json' \
  -d '{"projectDir": "'$(pwd)'", "project": "{projectKey}", "language": "{language}"}'
```

### 3. Ensure Branch (Cloud Source)

**Cloud only:** Verify you're NOT on `main` or `master`. If you are, create a fix branch:
```bash
git checkout -b fix/sonar-cleanup
```

**Local source:** Branch management is optional.

### 4. Fetch Issues

```bash
curl -s "http://localhost:9876/sonar/issues?source={source}&project={projectKey}"
```

For cloud with branch scoping:
```bash
curl -s "http://localhost:9876/sonar/issues?source=cloud&project={projectKey}&branch={branch}&new=true"
```

### 5. Present Summary

Display issue counts by severity and top rules. Ask whether to start from CRITICAL, a specific rule, or review the full list.

### 6. Fix Loop

For each issue, in severity order, grouped by file path:

**Announce:**
```
Issue {n}/{total} — {severity} — {rule}
File: {file_path}:{line}
Rule: {message}
```

**Read** the file around the reported line (±30 lines context).

**Assess fixability:**
- Auto-fixable (generic exceptions, unused imports, simple refactors) → fix immediately
- Needs refactoring (cognitive complexity) → fix with care
- Needs human decision (TODOs, behavior changes) → ask: fix, skip, or stop

**Fix** with minimal diff. Preserve behavior. Match existing code style.

**Validate** by running the check script. If it fails, attempt repair (up to 2 tries).

**Commit** each fix:
```bash
git add {changed_files}
git commit -m "fix(sonar): {rule_id} {short_description}

{file_path}:{line} — {sonar_message}
Sonar rule: {rule}
Severity: {severity}

Co-Authored-By: Claude <noreply@anthropic.com>"
```

**Record in tally** after each successful commit:
```bash
curl -s -X POST http://localhost:9876/tally/record \
  -H 'Content-Type: application/json' \
  -d '{"projectDir": "'$(pwd)'", "rule": "{rule}", "name": "{name}", "severity": "{severity}", "type": "{type}", "file": "{file_path}"}'
```

**IMPORTANT: Validate, commit, and tally record must each be separate Bash calls.**

### 7. Re-scan & Loop

**Local source:** Re-run scanner, then re-fetch issues. This is cheap — do it after every fix batch.

**Cloud source:** Batch fixes by rule/severity. Push once per batch:
```bash
git push -u origin {branch}
```
Then re-fetch issues (cloud adapter waits for CI analysis).

**Exit the loop when:**
- No open issues remain
- The user says to stop
- Only skippable issues remain

### 8. Final Report

```
Scan cycles:  {n}
Fixed:        {n}
Skipped:      {n}
Commits:      {n}

Skipped: {list with reasons}
Final scan: {clean | {n} remaining}
```

**Tally summary:**
```bash
curl -s "http://localhost:9876/tally/summary?projectDir=$(pwd)"
```

If patterns exist (count >= 3), suggest `/sonar-learn`.

## Common Fix Patterns

| Rule | Fix |
|------|-----|
| S112 (Generic exceptions) | Replace bare `except Exception` with specific types |
| S3776 (Cognitive complexity) | Extract helpers, simplify conditionals, early returns |
| S1135 (TODOs) | Ask user: remove, convert to issue, or keep |
| S1192 (String literals) | Extract to constants |
| S107 (Too many params) | Group into dataclass/config object |
| S1066 (Collapsible if) | Merge with `and` |

## Error Handling

| Error | Response |
|-------|----------|
| ECONNREFUSED | "tool-gw is not running. Start with `npm run dev`." |
| 401/403 from sonar | "Token rejected. Check SONAR_TOKEN in tool-gw .env." |
| No issues | "No open issues. Clean bill of health." |
| File not found | Skip issue, note in report |
| Check script fails after fix | Repair up to 2x, then ask user |
