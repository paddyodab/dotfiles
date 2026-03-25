---
description: Create a new thought stream and switch to it
---

Create a new thought stream and switch to it. Thought streams are mission-aware workspaces that persist across sessions.

## What to do

1. **Get stream name**
   - If user provided argument: use it (convert to kebab-case)
   - If no argument: AskUserQuestion "What should we call this stream?"

2. **Get mission**
   - AskUserQuestion "What's the mission for this stream?"
   - Provide contextual suggestions based on conversation

3. **Create directories**
   - Check/create `thoughts/`
   - Check/create `thoughts/streams/`

4. **Create stream file** at `thoughts/streams/{name}.md`:
   ```markdown
   # {Title}
   Updated: {YYYY-MM-DD}

   ## Mission
   {mission}

   ## Current Focus
   Getting started

   ## Decisions Made
   - (none yet)

   ## Progress
   - ✅ (none yet)
   - Blocked: (none)

   ## What We Tried
   - (nothing yet)

   ## Working Context
   - Files:
   - Branch:
   - Commands:

   ## Open Questions
   -
   ```

5. **Create/update symlink**
   - If platform supports symlinks: Create `thoughts/CURRENT.md` → `streams/{name}.md`
   - If not (Windows): Create `thoughts/CURRENT.md` with metadata pointing to active stream

6. **Confirm success**
   - Show: "Created and switched to stream: {name}"
   - Show: "Mission: {mission}"
   - Show: "Context loaded. I'm now mission aware."
   - Suggest: "Use /note-that to update progress as you work."

## Error handling

- Stream already exists → Ask if user wants to switch to it instead
- Permission denied → Report and suggest checking directory permissions
