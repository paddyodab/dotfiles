# Dotfiles

Personal configuration files managed via symlinks.

## Installation

### 1. Clone the repo

```bash
git clone https://github.com/paddyodab/dotfiles.git ~/dotfiles
cd ~/dotfiles
```

**If you want your own fork:** Fork this repo on GitHub first, then clone your fork and set the remote:

```bash
git clone https://github.com/YOUR_USERNAME/dotfiles.git ~/dotfiles
cd ~/dotfiles
git remote add upstream https://github.com/paddyodab/dotfiles.git
```

### 2. Configure models (optional)

If you want to use specific models for different agent tiers (premium/mid/fast), configure before installing:

```bash
cp agent-models.env.example agent-models.env
# Edit agent-models.env with your preferred model IDs
```

Without this, agents use each platform's default model.

### 3. Run the installer

```bash
./install.sh
```

This creates symlinks from standard config locations (`~/.config/opencode/`, `~/.hermes/skills/`, `~/.pi/agent/`, etc.) to this repo.

### 4. Re-running install.sh

Run `./install.sh` again when:
- You update `agent-models.env` (model IDs are injected at install time)
- You pull upstream changes to agent definitions
- You add new skill profiles

The installer is idempotent — it skips symlinks that are already correct.

## What's Included

### Thought Streams - Cross-Platform Mission Management

Mission-aware workspaces that persist across sessions. Track what you're working on, switch contexts without losing state.

Works across **three AI coding agents**:

| Agent | Location | Format |
|-------|----------|--------|
| **Opencode** | `~/.config/opencode/commands/` | Command files |
| **Pi** | `~/.pi/agent/prompts/` | Prompt templates |
| **Claude Code** | `~/.claude/skills/` | Skills (separate repo) |

**Commands:**
- `/which-stream` - Show current stream status
- `/new-stream` - Create new thought stream  
- `/load-stream` - Load stream context
- `/switch-stream` - Switch between streams
- `/note-that` - Capture state before ending session

## How It Works

The `install.sh` script creates symlinks from standard config locations to this repo:

```
~/.config/opencode/commands -> ~/dotfiles/.config/opencode/commands
~/.pi/agent/prompts -> ~/dotfiles/.pi/agent/prompts
```

This keeps all config version controlled while applications see them in the standard locations.

## File Structure

```
dotfiles/
├── .config/
│   └── opencode/
│       ├── agents/                 # Agent definitions (planner, coder, reviewer, etc.)
│       ├── commands/               # Opencode thought-stream commands
│       └── AGENTS.md               # Global agent instructions
├── .claude/
│   ├── CLAUDE.md                   # Global agent instructions for Claude Code
│   └── skill-sets/
│       ├── code/                   # Code-focused skills
│       ├── infra/                  # Infrastructure skills
│       ├── researcher/             # Research skills
│       └── universal/              # Universal skills (available to all profiles)
│           ├── agent-team-lead/    # 7 agent skills for Claude Code
│           ├── agent-planner/      #   (mirrors OpenCode agent definitions
│           ├── agent-coder/        #    as Claude Code skills)
│           ├── agent-reviewer/
│           ├── agent-secretary/
│           ├── agent-puddleglum/
│           ├── agent-doc-agent/
│           ├── agent-message-bus/  # Message bus skill
│           ├── log-decision/       # Decision logging skill
│           └── ...                 # Other universal skills
├── .hermes/
│   └── skills/                    # Hermes agent skills
│       ├── agent-team-lead/       # 8 agent skills for Hermes
│       ├── agent-planner/         #   (mirrors OpenCode/Claude Code agents
│       ├── agent-coder/           #    as Hermes skills loaded via skill_view)
│       ├── agent-reviewer/
│       ├── agent-secretary/
│       ├── agent-puddleglum/
│       ├── agent-doc-agent/
│       └── agent-message-bus/     # Message bus skill
├── .pi/
│   └── agent/
│       ├── prompts/                # Pi thought-stream prompts
│       └── skills/
│           └── universal/          # Pi universal skills
├── agent/
│   ├── contracts/                  # Shared agent contracts (platform-agnostic)
│   │   ├── secretary-contract.md   # Secretary delegation contract
│   │   └── team-lead-contracts.md  # Pipeline coordination contracts
│   └── msg.js                      # Message bus CLI (inter-agent communication)
├── agent-models.env.example        # Model tier configuration template
├── install.sh                      # Setup script (symlinks config to home)
└── README.md                       # This file
```

## Adding More Dotfiles

1. Create the file/directory in this repo under the appropriate path
2. Add the link command to `install.sh`
3. Run `./install.sh` to set up symlinks
4. Commit and push

## Syncing to New Machines

Follow the [Installation](#installation) steps above. On subsequent machines, remember to:
1. Copy your `agent-models.env` if you configured custom models (not tracked in git)
2. Run `./install.sh` to set up symlinks

## Updating Commands

Edit files in `~/dotfiles/.config/opencode/commands/` or `~/dotfiles/.pi/agent/prompts/`, then:

```bash
cd ~/dotfiles
git add .
git commit -m "Update thought-stream commands"
git push
```

On other machines:
```bash
cd ~/dotfiles && git pull
```

## Cross-Platform Thought Streams

The thought stream system works identically across agents:

1. **Create a stream**: `/new-stream my-project`
2. **Work on it**: Pi/Opencode/Claude uses the stream for context
3. **Capture state**: `/note-that` before ending session
4. **Resume later**: `/load-stream` restores full context
5. **Switch projects**: `/switch-stream other-project`

Each repo gets its own `thoughts/` directory, so streams are isolated per project.

## License

MIT - Use it, modify it, share it.

## Multi-Agent Pipeline

A team-lead orchestration system with 7 specialized agents that coordinate via a message bus:

| Agent | Role |
|-------|------|
| `team-lead` | Pipeline orchestrator — drives stories through planning → implementation → review |
| `planner` | Architecture planning, task breakdown, scoping |
| `coder` | Production code implementation |
| `reviewer` | Code review, bug detection, style checking |
| `secretary` | Commits, PRs, Shortcut updates, CRs, documentation |
| `puddleglum` | Pre-mortem analysis — finds the assumption you didn't know you were making |
| `doc-agent` | Documentation authoring (ADRs, runbooks, API docs, onboarding guides) |

### Supported Platforms

| Platform | How agents are defined | Global instructions |
|----------|----------------------|---------------------|
| **OpenCode** | `.config/opencode/agents/*.md` (native agent system) | `.config/opencode/AGENTS.md` |
| **Claude Code** | `.claude/skill-sets/universal/agent-*/SKILL.md` (skills-as-agents via Task tool) | `.claude/CLAUDE.md` |
| **Hermes** | `.hermes/skills/agent-*/SKILL.md` (skills loaded via `skill_view()`, agents spawned via `delegate_task`) | N/A (skill-based) |

### Prerequisites

- **msg.js**: The message bus runtime (`~/.agent/msg.js`) is required for inter-agent communication. See [agent-hub](https://github.com/paddyodab/agent-hub) for installation.
- **OpenCode**, **Claude Code**, or **Hermes**: The agent team works on all three platforms. OpenCode has native multi-agent support; Claude Code uses skills loaded via the Task tool; Hermes uses skills loaded via `skill_view()` and agents spawned via `delegate_task()`.

### Files

- `.config/opencode/agents/*.md` — OpenCode agent definitions
- `.config/opencode/AGENTS.md` — OpenCode global agent instructions
- `.claude/skill-sets/universal/agent-*/SKILL.md` — Claude Code agent skills (7 agents)
- `.claude/CLAUDE.md` — Claude Code global agent instructions
- `.hermes/skills/agent-*/SKILL.md` — Hermes agent skills (8 skills, symlinked to ~/.hermes/skills/)
- `agent/contracts/secretary-contract.md` — Delegation contract for secretary agent
- `agent/contracts/team-lead-contracts.md` — Bus message contracts for pipeline coordination
- `.claude/skill-sets/universal/agent-message-bus/` — Message bus skill (Claude Code)
- `.hermes/skills/agent-message-bus/` — Message bus skill (Hermes)
