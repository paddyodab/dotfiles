---
description: Set up CloudWatch RUM end-to-end — infra, app integration, config, and verification
argument-hint: "[aws-profile]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
---

# Purpose

Walk through the full journey of adding CloudWatch Real User Monitoring (RUM) to a web application. This skill is a coach — it assesses where you are and picks up from there. The journey spans four phases:

1. **Infra** — Deploy the RUM stack (Cognito Identity Pool, IAM role, AppMonitor)
2. **Code** — Add the `aws-rum-web` library and RUM wrapper module
3. **Configure** — Wire the RUM outputs (AppMonitorId, IdentityPoolId) into env vars
4. **Verify** — Confirm telemetry is flowing

Each phase is a checkpoint. If a phase is already complete, the skill skips it.

## Reference Implementation

The canonical RUM integration pattern lives in survey-fielding-web:

- **RUM wrapper**: `src/lib/monitoring/rum.ts` — initializes `AwsRum`, exports helpers for custom events, errors, and session attributes
- **API instrumentation**: `src/lib/api/client.ts` — axios interceptors that record `api_call` events (with latency), `api_error` events, and network errors via `recordRumEvent`/`recordRumError`
- **CFN template**: `infra/templates/rum.yaml` — Cognito pool, IAM unauth role, AppMonitor
- **Env vars**: `VITE_RUM_APPLICATION_ID`, `VITE_RUM_IDENTITY_POOL_ID`, `VITE_RUM_APPLICATION_VERSION`, `VITE_RUM_APPLICATION_REGION`, `VITE_RUM_SESSION_SAMPLE_RATE`, `VITE_ENVIRONMENT`

## Instructions

### 1. Determine Target App and Environment

**If argument provided:**
- Use it as the AWS profile name (e.g., `dev`, `stage`, `prod`)

**If no argument:**
- Use AskUserQuestion:
  - Options: `dev`, `stage`, `prod`
  - Question: "Which AWS environment are we setting up RUM in?"

Then determine which web app we're working with. Check the current working directory or recent context for a survey-apps web project.

Use AskUserQuestion if unclear:
- Question: "Which web app are we adding RUM to?"
- Options: `survey-fielding-web`, `survey-management-web`, "Other"

Store the app name as `{app-name}` and resolve the repo path: `~/Documents/GitHub/cleanroom/survey-apps/{app-name}/`

### 2. Verify AWS Session

```bash
aws sts get-caller-identity --profile {profile}
```

**If error (expired SSO):**
Report: "SSO session expired. Run `aws sso login --profile {profile}` and try again."
Stop.

**If success:**
Extract account ID. Confirm: "Authenticated as {ARN} in account {Account}."

### 3. Assess Current State

Run all of these checks to understand what's already in place:

#### 3a. Check for CFN template

```bash
ls {repo-path}/infra/templates/rum.yaml 2>&1
```

#### 3b. Check for deployed RUM stack

```bash
aws cloudformation describe-stacks --stack-name "{app-name}-rum" --profile {profile} 2>&1
```

If the stack exists, grab its outputs:

```bash
aws cloudformation describe-stacks \
  --stack-name "{app-name}-rum" \
  --profile {profile} \
  --query 'Stacks[0].Outputs'
```

#### 3c. Check for aws-rum-web dependency

```bash
grep "aws-rum-web" {repo-path}/package.json 2>&1
```

#### 3d. Check for RUM wrapper module

```bash
ls {repo-path}/src/lib/monitoring/rum.ts 2>&1
```

#### 3e. Check for env var configuration

Look for existing `.env.{profile}` or `.env` files with RUM variables:

```bash
grep -r "VITE_RUM" {repo-path}/.env* 2>&1 || true
```

#### 3f. Report Assessment

Summarize what's done and what's needed:

```
RUM Setup Assessment for {app-name} ({profile}):

  CFN template:     {exists / missing}
  Deployed stack:   {exists / missing}
  aws-rum-web:      {installed / missing}
  RUM module:       {exists / missing}
  Env vars:         {configured / missing}
```

Then say: "Here's where we need to pick up. Ready to continue?" and proceed to the first incomplete phase.

---

## Phase 1: Infrastructure

**Skip if:** The CFN stack `{app-name}-rum` already exists in this environment.

### 4. Determine Domain Name

The domain name is the URL where end users access the app. Use AskUserQuestion:

- Question: "What domain does {app-name} serve traffic on in {profile}?"
- Options based on known patterns:
  - For survey-fielding-web: `research-survey.{profile}.nrchealth.com` (dev/stage) or `research-survey.nrchealth.com` (prod)
  - For survey-management-web: `research-survey-management.{profile}.nrchealth.com` (dev/stage) or `research-survey-management.nrchealth.com` (prod)
  - "Other"

Store as `{domain-name}`.

### 5. Ensure CFN Template Exists

**If `infra/templates/rum.yaml` exists:**
Report: "CFN template already exists. Using it."

**If missing:**
Create it by reading the reference template from survey-fielding-web and adapting the `AppName` default:

Read `/Users/pdabney/Documents/GitHub/cleanroom/survey-apps/survey-fielding-web/infra/templates/rum.yaml` as the reference.

Write a copy to `{repo-path}/infra/templates/rum.yaml` with the `AppName` default changed to `{app-name}`. Keep everything else identical.

### 6. Deploy the CFN Stack

```bash
aws cloudformation deploy \
    --stack-name {app-name}-rum \
    --template-file {repo-path}/infra/templates/rum.yaml \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides \
        "Environment={profile}" \
        "AppName={app-name}" \
        "DomainName={domain-name}" \
    --profile {profile}
```

### 7. Grab Stack Outputs

```bash
aws cloudformation describe-stacks \
  --stack-name "{app-name}-rum" \
  --profile {profile} \
  --query 'Stacks[0].Outputs[*].{Key:OutputKey,Value:OutputValue}' \
  --output table
```

Store `AppMonitorId` as `{app-monitor-id}` and `IdentityPoolId` as `{identity-pool-id}`.

Report the values clearly — the user will need these.

### 7b. Update Environment Command File

Check if the deploy command is already documented:

```bash
grep -l "rum" {repo-path}/infra/{profile}/*-commands.txt 2>&1 || true
```

**If not found**, offer to append the deploy command to the environment's command file. Use AskUserQuestion:
- Question: "Should I add the RUM deploy command to the {profile} commands file for future reference?"
- Options: "Yes (Recommended)", "No, skip"

**If yes**, append to `{repo-path}/infra/{profile}/{profile}-commands.txt`:

```
# ─────────────────────────────────────────────────────────────────────────────
# CloudWatch RUM (Real User Monitoring)
#    Creates: AppMonitor, Cognito Identity Pool (unauth), IAM Role
#    After deploy, grab the Outputs (AppMonitorId, IdentityPoolId) and
#    populate VITE_RUM_APPLICATION_ID and VITE_RUM_IDENTITY_POOL_ID in .env.{profile}
# ─────────────────────────────────────────────────────────────────────────────
aws cloudformation deploy \
    --stack-name {app-name}-rum \
    --template-file ../templates/rum.yaml \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides \
        "Environment={profile}" \
        "AppName={app-name}" \
        "DomainName={domain-name}"
```

---

## Phase 2: App Integration

**Skip if:** `aws-rum-web` is already in `package.json` AND `src/lib/monitoring/rum.ts` exists.

### 8. Install aws-rum-web

Check the package manager (look for `pnpm-lock.yaml`, `yarn.lock`, or `package-lock.json`):

```bash
ls {repo-path}/pnpm-lock.yaml {repo-path}/yarn.lock {repo-path}/package-lock.json 2>&1
```

Install using the detected package manager:

```bash
cd {repo-path} && npm install aws-rum-web
```

(Substitute `pnpm add` or `yarn add` as appropriate.)

### 9. Create RUM Wrapper Module

**If `src/lib/monitoring/rum.ts` already exists:** Skip.

**If missing:** Read the reference implementation:

```bash
cat /Users/pdabney/Documents/GitHub/cleanroom/survey-apps/survey-fielding-web/src/lib/monitoring/rum.ts
```

Create `{repo-path}/src/lib/monitoring/rum.ts` with the same content. This module is app-agnostic — it reads from `import.meta.env` VITE variables and works as-is.

Ensure the `src/lib/monitoring/` directory exists first.

### 10. Wire RUM Initialization

Check where the app bootstraps (typically `main.ts` or `main.tsx`):

```bash
ls {repo-path}/src/main.ts {repo-path}/src/main.tsx 2>&1
```

Read the file. Check if `initializeRUM` is already called.

**If not called:** Show the user where to add the import and initialization call. Use AskUserQuestion to confirm before editing:

- Question: "I'll add RUM initialization to {main-file}. The import and `initializeRUM()` call should go near the top, after other imports. OK to proceed?"
- Options: "Yes, add it (Recommended)", "No, I'll add it manually"

**If yes:** Add near the top of the file:

```typescript
import { initializeRUM } from './lib/monitoring/rum'

// Initialize CloudWatch RUM (no-op in local/development)
initializeRUM()
```

### 11. Suggest API Instrumentation (Optional)

Check if the app has an API client with axios:

```bash
grep -rl "axios" {repo-path}/src/lib/api/ 2>&1 || true
```

**If found:** Show the user the pattern from survey-fielding-web's `client.ts` — how interceptors record `api_call`, `api_error`, and network errors via `recordRumEvent`/`recordRumError`.

Use AskUserQuestion:
- Question: "Want to add RUM instrumentation to the API client? This tracks API call latency, errors, and network failures as custom RUM events."
- Options: "Yes, show me how", "Skip for now"

**If yes:** Read the reference `client.ts` and show the interceptor pattern. Offer to edit the file, but confirm first — API clients vary between apps so this needs human review.

---

## Phase 3: Configuration

**Skip if:** `.env.{profile}` already has `VITE_RUM_APPLICATION_ID` populated.

### 12. Update Environment Variables

Check for existing env file:

```bash
ls {repo-path}/.env.{profile} {repo-path}/.env 2>&1
```

**If `.env.{profile}` exists:** Show what needs to be added/updated:

```
VITE_RUM_APPLICATION_ID={app-monitor-id}
VITE_RUM_IDENTITY_POOL_ID={identity-pool-id}
VITE_RUM_APPLICATION_REGION=us-east-1
VITE_RUM_APPLICATION_VERSION=1.0.0
VITE_ENVIRONMENT={profile}
```

Use AskUserQuestion:
- Question: "Should I update `.env.{profile}` with the RUM configuration?"
- Options: "Yes, update it (Recommended)", "No, I'll do it manually"

**If `.env.{profile}` doesn't exist:** Report the values and tell the user to add them wherever their env config lives (CI/CD secrets, parameter store, etc.).

### 13. Redeploy Reminder

Report: "The app needs to be redeployed for the RUM env vars to take effect. This is just a build+deploy — no infra changes needed."

If the app deploys via GitHub Actions, mention they can trigger the workflow or push a commit.

---

## Phase 4: Verification

### 14. Check RUM Console

Report the console URL:

```
View your RUM dashboard:
https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#rum:dashboard/{app-name}-{profile}
```

Note: "Events may take a few minutes to appear after the first page load. Open the app in a browser and navigate around to generate some telemetry."

### 15. Report Summary

```
RUM Setup Complete for {app-name} ({profile})

Infrastructure:
- CFN Stack: {app-name}-rum
- AppMonitor: {app-name}-{profile}
- Identity Pool: {identity-pool-id}
- Domain: {domain-name}

App Integration:
- Package: aws-rum-web {installed/already present}
- Module: src/lib/monitoring/rum.ts {created/already present}
- Initialization: {main-file} {updated/already present}
- API instrumentation: {added/skipped/already present}

Configuration:
- Env vars: .env.{profile} {updated/manual}

Telemetries enabled:
- errors — JavaScript errors and unhandled promise rejections
- performance — Page load, LCP, FID, CLS web vitals
- http — XHR/fetch request tracking (status, latency)

Next steps:
- Deploy the app if not yet done
- Open the app in a browser to generate initial telemetry
- Check the RUM dashboard for incoming events
- To set up RUM in another environment, run /core:setup-rum {other-profile}
```

## Running for Additional Environments

This skill can be re-run per environment. The CFN template and app code (Phase 2) only need to be done once — subsequent runs for other environments will fast-forward to Phase 1 (deploy stack) and Phase 3 (configure env vars).

## Cleanup

To remove RUM from an environment:

```bash
# Delete the CloudFormation stack (removes AppMonitor, Cognito pool, IAM role)
aws cloudformation delete-stack --stack-name {app-name}-rum --profile {profile}

# Remove env vars from .env.{profile}
# Optionally remove aws-rum-web from package.json if removing from all environments
```
