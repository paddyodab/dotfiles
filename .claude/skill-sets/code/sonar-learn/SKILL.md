---
description: Analyze sonar-fix tally patterns and generate preventive guidance — rule files, linter config, CLAUDE.md guidelines
argument-hint: "[--express]"
allowed-tools:
  - Bash(curl:*)
  - Bash(git:*)
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - AskUserQuestion
---

# Purpose

Analyze patterns from `/sonar-fix` sessions and generate preventive guidance: per-rule documentation with examples from git history, linter config suggestions, and compiled CLAUDE.md guidelines.

Reads `.sonar/tally.json` (created by `/sonar-fix`).

## Gateway

All API calls go through tool-gw at `http://localhost:9876`. If it's not running, tell the user: "Start tool-gw with `npm run dev` in the tool-gw directory."

## Instructions

### Choose Mode

Ask the user: "Express mode (automated) or interactive (step-by-step)?"

- **Express mode:** Single API call, fully automated (recommended)
- **Interactive mode:** Step-by-step with user review

---

## Express Mode (Recommended)

```bash
curl -s -X POST http://localhost:9876/tally/learn \
  -H 'Content-Type: application/json' \
  -d '{"projectDir": "'$(pwd)'", "minCount": 3, "volumeThreshold": 20, "maxCommits": 3}'
```

For dry run (preview without writing):
```bash
curl -s -X POST http://localhost:9876/tally/learn \
  -H 'Content-Type: application/json' \
  -d '{"projectDir": "'$(pwd)'", "minCount": 3, "dryRun": true}'
```

**Report to user:**

Parse the JSON response and highlight:
- **New rules documented:** Rule IDs with fix counts
- **Rules skipped:** Already current
- **High-volume rules:** Added to CLAUDE.md (mechanical rules with >20 fixes)
- **Mechanical rules:** Suggest enabling linter rules (see Linter Suggestions below)

**Example output:**
```
Analyzed 4 rules (57 fixes):
✓ S6853 (6 fixes): Documented in .sonar/rules/
✓ S6759 (47 fixes): Documented + added to CLAUDE.md (high volume)
✓ S6772 (4 fixes): Documented in .sonar/rules/
• S1234 (2 fixes): Below threshold

Mechanical rules detected:
  S6759 → @typescript-eslint/prefer-readonly
  S6772 → Consider enabling strict callback typing
```

---

## Interactive Mode (Step-by-Step)

### 1. Load Tally

```bash
curl -s "http://localhost:9876/tally/load?projectDir=$(pwd)&minCount=3"
```

If error: "Run `/sonar-fix` first." If no qualifying rules: show counts, suggest more sessions.

### 2. Review Qualifying Rules

Display the qualifying rules from the load response. Let the user review before proceeding.

### 3. Run Learn with Dry Run

```bash
curl -s -X POST http://localhost:9876/tally/learn \
  -H 'Content-Type: application/json' \
  -d '{"projectDir": "'$(pwd)'", "minCount": 3, "dryRun": true}'
```

Show what would be created/updated. Ask user to confirm.

### 4. Run Learn for Real

```bash
curl -s -X POST http://localhost:9876/tally/learn \
  -H 'Content-Type: application/json' \
  -d '{"projectDir": "'$(pwd)'", "minCount": 3}'
```

### 5. Suggest Linter Config

For mechanical rules, map to linter equivalents:

**TypeScript/JS (ESLint):**
| Sonar Rule | ESLint Rule |
|------------|-------------|
| S6759 | `@typescript-eslint/prefer-readonly` |
| S1066 | `no-lonely-if` |
| S1128 | `@typescript-eslint/no-unused-vars` |
| S1116 | `no-empty` |
| S1186 | `no-empty-function` |
| S1135 | `no-warning-comments` |

**Python (Ruff):**
| Sonar Rule | Ruff Rule |
|------------|-----------|
| S1066 | SIM102 (flake8-simplify) |
| S1128 | F401 (unused imports) |
| S1481 | F841 (unused variables) |
| S106 | T201 (flake8-print) |
| S125 | ERA001 (eradicate) |

Present as: "Enable these linter rules to prevent future occurrences."

### 6. Report

```
Analyzed: {n} rules from {totalFixes} fixes

Structural: {n} rules → .sonar/rules/
Mechanical: {n} rules → linter suggestions provided
High-volume: {n} rules → CLAUDE.md updated
Current: {n} rules (no changes needed)
```

## Notes

- **Read-only:** Does not fix code or create commits
- **Incremental:** Only processes rules that need action
- **Idempotent:** Safe to run multiple times
- `.sonar/` directory not committed by default — user decides
