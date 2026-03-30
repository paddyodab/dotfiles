---
description: Set up local SonarQube for a project — Docker infrastructure, scanner config, baseline scan
argument-hint: "[project-dir]"
allowed-tools:
  - Bash(curl:*)
  - Bash(npx:*)
  - Bash(docker:*)
  - Bash(test:*)
  - Bash(ls:*)
  - Bash(git:*)
  - Bash(chmod:*)
  - Bash(grep:*)
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - AskUserQuestion
---

# Purpose

One-command setup for local SonarQube analysis on a project. Handles Docker infrastructure, admin password, project creation, token generation, tally init, and baseline scan. After this, `/sonar-fix` can use the local scanner for fast validation.

Supports Python and TypeScript projects. Auto-detects language from repo contents.

## Instructions

### 1. Resolve Project Directory

If `$ARGUMENTS` is provided and is an absolute path, use it. Otherwise use the current working directory.

Verify the directory exists and is a git repo.

### 2. Locate tool-gw

Find the tool-gw `.env` file. Check these locations in order:
1. `$TOOL_GW_DIR/.env` (if env var set)
2. `~/my-projects/GitHub/tool-gw/.env`

If not found, tell the user: "Can't find tool-gw .env file. Set TOOL_GW_DIR or create the file."

Store the path as `TOOL_GW_ENV` for later steps.

### 3. Ensure Docker & SonarQube Infrastructure

**Docker running?**
```bash
docker info > /dev/null 2>&1 && echo "running" || echo "stopped"
```
If stopped, tell the user to start Docker Desktop and wait.

**SonarQube container exists and running?**
```bash
docker ps -a --filter name=sonarqube --format '{{.Status}}'
```
If not exists, create it:
```bash
docker run -d --name sonarqube -p 9000:9000 sonarqube:lts-community
```
If exists but stopped:
```bash
docker start sonarqube
```

Wait for SonarQube to be healthy:
```bash
curl -s http://localhost:9000/api/system/status
```
(Poll until `status: "UP"`, timeout 2 minutes)

### 4. Handle Admin Password

Check if `SONAR_ADMIN_PASSWORD` exists in the tool-gw `.env` file:
```bash
grep -q SONAR_ADMIN_PASSWORD "$TOOL_GW_ENV" 2>/dev/null && echo "exists" || echo "missing"
```

**If missing (first-time setup):**

1. Ask the user: "Pick a password for your local SonarQube admin account:"
2. Change the default password via API:
   ```bash
   curl -s -u admin:admin -X POST \
     "http://localhost:9000/api/users/change_password?login=admin&previousPassword=admin&password={newPassword}"
   ```
3. Append to the tool-gw `.env` file:
   ```bash
   echo 'SONAR_ADMIN_PASSWORD={newPassword}' >> "$TOOL_GW_ENV"
   ```
4. Report: "Admin password set and saved to tool-gw .env. You can use this to log in at localhost:9000."

**If exists:**

Read the password:
```bash
grep SONAR_ADMIN_PASSWORD "$TOOL_GW_ENV" | cut -d= -f2
```

Verify it works:
```bash
curl -s -u admin:{password} http://localhost:9000/api/authentication/validate
```

If auth fails, ask the user if they changed it manually and want to update.

Use `admin:{password}` for all subsequent SonarQube API calls in this skill.

### 5. Create Project & Generate Token

**Project exists in SonarQube?**
```bash
curl -s -u admin:{password} "http://localhost:9000/api/projects/search?q={projectKey}"
```
If not found, create it:
```bash
curl -s -u admin:{password} -X POST "http://localhost:9000/api/projects/create?name={projectKey}&project={projectKey}"
```

**Generate ephemeral token:**
```bash
curl -s -u admin:{password} -X POST "http://localhost:9000/api/user_tokens/generate?name=tool-gw-$(date +%s)"
```
Parse the `token` field from the response.

### 6. Auto-detect Language

Check repo contents:
- `pyproject.toml`, `setup.py`, `*.py` → python
- `package.json`, `tsconfig.json` → typescript

### 7. Initialize Tally

```bash
curl -s -X POST http://localhost:9876/tally/init \
  -H 'Content-Type: application/json' \
  -d '{"projectDir": "{project_dir}", "project": "{projectKey}", "language": "{language}"}'
```

### 8. Create Coverage Script

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

### 9. Gitignore .sonar/

Check if `.sonar/` is already in `.gitignore`. If not, add it.

### 10. Run First Scan

Ask the user before running (takes ~60 seconds):
> "Ready to run the first local scan to establish a baseline. Go?"

```bash
cd {project_dir} && npx sonar-scanner \
  -Dsonar.host.url=http://localhost:9000 \
  -Dsonar.token={token} \
  -Dsonar.projectKey={projectKey}
```

Timeout: 5 minutes. Report the dashboard URL:
```
Local SonarQube dashboard: http://localhost:9000/dashboard?id={projectKey}
```

### 11. Summary

```
SonarQube Setup Complete
========================
Instance:    http://localhost:9000
Project:     {projectKey} ({language})
Admin:       admin / (password in tool-gw .env)
Token:       Ephemeral (generated fresh each session)
Tally:       .sonar/tally.json
Coverage:    scripts/check-all-coverage.sh
Gitignore:   .sonar/ added

Dashboard:   http://localhost:9000/dashboard?id={projectKey}

Next steps:
- /sonar-fix will fetch issues and fix them systematically
- Log in at localhost:9000 with admin / your chosen password
- Run check-all-coverage.sh before scans for coverage data
```

## Error Handling

| Error | Response |
|-------|----------|
| Docker not installed | "Docker is required for local SonarQube. Install from docker.com" |
| Port 9000 in use (not SonarQube) | "Port 9000 is in use by another process. Free it or configure a different port." |
| SonarQube won't start | `docker logs sonarqube --tail 20` |
| tool-gw not running | "Start tool-gw with `npm run dev` in the tool-gw directory." |
| Password change fails | "Could not change admin password. Log in manually at localhost:9000 and update SONAR_ADMIN_PASSWORD in tool-gw .env." |
| Auth validation fails | "Stored password doesn't work. Did you change it manually? Update SONAR_ADMIN_PASSWORD in tool-gw .env." |
