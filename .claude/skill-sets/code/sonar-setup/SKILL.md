---
description: Set up local SonarQube for a project — self-healing infrastructure via `sonar ensure`
argument-hint: "[project-dir or repo name]"
allowed-tools:
  - Bash(bun:*)
  - Bash(npx:*)
  - Bash(curl:*)
  - Bash(docker:*)
  - Bash(test:*)
  - Bash(ls:*)
  - Bash(git:*)
  - Bash(chmod:*)
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - AskUserQuestion
---

# Purpose

One-command setup for local SonarQube analysis on a project. Uses `core sonar ensure` to handle all infrastructure (Docker, SonarQube, project creation, token generation). After this, `/sonar-fix` can use the local scanner for fast validation.

Supports Python and TypeScript projects. Auto-detects language from repo contents.

## Instructions

### 1. Resolve Project Directory

If `$ARGUMENTS` is provided:
- If it's an absolute path → use it as project dir
- If it's a repo name → look in `~/Documents/GitHub/cleanroom/survey-apps/{name}`, `~/Documents/GitHub/{name}`, or `${CLAUDE_PROJECT_DIR}`
- If empty → use current working directory / `${CLAUDE_PROJECT_DIR}`

Verify the directory exists and is a git repo.

### 2. Ensure Infrastructure

Run the self-healing ensure command:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core sonar ensure --project-dir "{project_dir}"
```

This single command handles:
- Starting Docker if not running
- Starting/creating SonarQube container if needed
- Creating the project if it doesn't exist
- Generating a fresh ephemeral token
- Auto-detecting language
- Updating `.sonar/tally.json` with scanner config
- Running a baseline scan for new projects

Parse the JSON response to get: `host`, `projectKey`, `token`, `language`, `scannerCommand`, `steps`.

Report what happened based on `steps` (e.g., "Docker: already running, SonarQube: started, Project: created, Token: generated").

### 3. Initialize Tally

```bash
bun ${CLAUDE_PLUGIN_ROOT}/cli/bin/core sonar init --project "{projectKey}" --language "{language}" --project-dir "{project_dir}"
```

### 4. Create Coverage Script

Check if `scripts/check-all-coverage.sh` exists. If not, create it:

**Python projects:**
```bash
#!/bin/bash
set -e
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
bash "$SCRIPT_DIR/lint.sh" --fix
bash "$SCRIPT_DIR/type-check.sh"
if [ -f .venv/bin/activate ]; then source .venv/bin/activate
elif [ -f venv/bin/activate ]; then source venv/bin/activate; fi
pytest tests/ -m "not integration and not e2e and not validation" \
  --cov=app --cov-report=term-missing --cov-report=xml --tb=short
```

**TypeScript projects:**
```bash
#!/bin/bash
set -e
npm run type-check || echo "Type-check warnings (continuing)"
npm run lint -- --fix
npx vitest run --coverage --coverage.reporter=lcov --coverage.reporter=text
npm run build
```

Make it executable: `chmod +x scripts/check-all-coverage.sh`

### 5. Gitignore .sonar/

Check if `.sonar/` is already in `.gitignore`. If not:

```bash
echo '' >> .gitignore
echo '# Sonar fix tally and local scanner config' >> .gitignore
echo '.sonar/' >> .gitignore
```

### 6. Run First Scan

Ask the user before running (it can take a minute):
> "Ready to run the first local scan to establish a baseline. This takes ~60 seconds. Go?"

Use the scanner command from the ensure output:

```bash
cd {project_dir} && {scannerCommand}
```

Timeout: 5 minutes. If successful, report the SonarQube dashboard URL:
```
Local SonarQube dashboard: http://localhost:9000/dashboard?id={project_key}
```

**Note:** If `ensure` already ran a baseline scan (steps.baseline = "scanned"), skip this step and report that baseline was already established.

### 7. Summary

Report what was done:

```
SonarQube Setup Complete
========================
Instance:    http://localhost:9000
Project:     {project_key} ({language})
Scanner:     {scannerCommand}
Token:       Ephemeral (generated fresh each session by `sonar ensure`)
Tally:       .sonar/tally.json (scanner config stored)
Coverage:    scripts/check-all-coverage.sh
Gitignore:   .sonar/ added

Dashboard:   http://localhost:9000/dashboard?id={project_key}

Next steps:
- /sonar-fix will auto-call `sonar ensure` for fresh tokens
- Run check-all-coverage.sh before scans for coverage data
```

## Error Handling

| Error | Response |
|-------|----------|
| Docker not installed | "Docker is required for local SonarQube. Install from docker.com" |
| Port 9000 in use (not SonarQube) | "Port 9000 is in use by another process. Free it or configure a different port." |
| SonarQube won't start | Show docker logs: `docker logs sonarqube --tail 20` |
| Admin auth fails | "Cannot authenticate to SonarQube. Check admin credentials." |
| Scanner fails | Show output, verify sources directory exists |

## Notes

- **No more shell profile tokens** — `sonar ensure` generates ephemeral tokens each session. No stale `SONAR_LOCAL_TOKEN` in `~/.zshrc`.
- **No properties files** — scanner uses explicit `-D` flags to avoid `sonar.organization` conflicts from `sonar-project.properties`.
- `SONAR_LOCAL_TOKEN` is separate from `SONAR_TOKEN` (SonarCloud). They serve different instances.
- The scanner (`npx sonar-scanner`) works for both Python and TypeScript — SonarQube does the analysis server-side.
- First scan establishes a baseline. Subsequent scans (via `/sonar-fix`) show only what changed.
