---
name: x-session-init
description: One-time setup to log into X/Twitter via a headed browser and save the session for future research harvesting. Run this once per machine before using harvest-x-posts.
allowed-tools:
  - Bash
  - AskUserQuestion
---

# X Session Init

Open a headed browser, navigate to X, let the user log in, then persist the session so future skills can run without re-auth.

## Instructions

### 1. Check for existing session

```bash
agent-browser --session x-research get url 2>/dev/null
```

If that returns a URL without error, a session already exists. Tell the user:
> "An x-research session already exists. If you want to re-authenticate, close the browser and re-run this skill."
Then stop.

### 2. Open headed browser

```bash
agent-browser --session x-research --headed open https://x.com/login
```

Tell the user:
> "Browser is open at x.com/login. Log in normally — including 2FA if needed. Come back here when you're fully logged in and can see your timeline."

### 3. Wait for user confirmation

Ask: "Are you logged in and can see your X timeline? (yes / no)"

If no: wait and ask again. Don't proceed until confirmed.

### 4. Verify login succeeded

```bash
agent-browser --session x-research get url
agent-browser --session x-research snapshot -c
```

Check that the URL is `x.com/home` or similar (not `x.com/login`). If it's still on the login page, tell the user and ask them to complete login.

### 5. Close browser and confirm

```bash
agent-browser --session x-research close
```

Report:
> "Session saved as 'x-research'. You can now use /harvest-x-posts without logging in again. Session persists until X invalidates it."
