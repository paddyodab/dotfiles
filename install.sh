#!/bin/bash
# Dotfiles installation script
# Sets up symlinks from home directory to this repo

set -e

DOTFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_SETS_DIR="$DOTFILES_DIR/.claude/skill-sets"

# Function to create symlink safely
link_file() {
    local src="$1"
    local dest="$2"

    # Create parent directory if needed
    mkdir -p "$(dirname "$dest")"

    # Backup existing file if it exists and isn't a symlink
    if [ -e "$dest" ] && [ ! -L "$dest" ]; then
        echo "   💾 Backing up existing: $dest"
        mv "$dest" "$dest.backup.$(date +%Y%m%d%H%M%S)"
    fi

    # Already linked correctly — skip
    if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then
        echo "   ✔ Already linked: $dest"
        return
    fi

    # Remove existing symlink
    if [ -L "$dest" ]; then
        rm "$dest"
    fi

    # Create symlink
    ln -s "$src" "$dest"
    echo "   ✅ Linked: $dest -> $src"
}

# Link all skill directories from a profile into a target skills dir.
# Skips agent-* directories — those are handled by install_claude_agents().
link_profile_skills() {
    local profile="$1"
    local target_dir="$2"
    local profile_dir="$SKILL_SETS_DIR/$profile"

    if [ ! -d "$profile_dir" ]; then
        echo "   ⚠️  Profile not found: $profile"
        return 1
    fi

    mkdir -p "$target_dir"

    local found=0
    for skill_dir in "$profile_dir"/*/; do
        [ -d "$skill_dir" ] || continue
        local skill_name="$(basename "$skill_dir")"
        # Skip agent-* skills — installed via copy+inject by install_claude_agents
        case "$skill_name" in agent-*) continue ;; esac
        link_file "$skill_dir" "$target_dir/$skill_name"
        found=1
    done

    if [ "$found" -eq 0 ]; then
        echo "   (no skills in $profile yet)"
    fi
}

# Link Pi skills from profile to target
link_profile_skills_pi() {
    local profile="$1"
    local target_dir="$2"
    local pi_skills_dir="$DOTFILES_DIR/.pi/agent/skills"
    local profile_dir="$pi_skills_dir/$profile"

    if [ ! -d "$profile_dir" ]; then
        echo "   ⚠️  Profile not found: $profile"
        return 1
    fi

    mkdir -p "$target_dir"

    local found=0
    for skill_dir in "$profile_dir"/*/; do
        [ -d "$skill_dir" ] || continue
        local skill_name="$(basename "$skill_dir")"
        link_file "$skill_dir" "$target_dir/$skill_name"
        found=1
    done

    if [ "$found" -eq 0 ]; then
        echo "   (no skills in $profile yet)"
    fi
}

# List available profiles
list_profiles() {
    echo "Available profiles:"
    echo ""
    for profile_dir in "$SKILL_SETS_DIR"/*/; do
        [ -d "$profile_dir" ] || continue
        local name="$(basename "$profile_dir")"
        [ "$name" = "universal" ] && continue
        local skills=""
        for skill in "$profile_dir"/*/; do
            [ -d "$skill" ] || continue
            skills="$skills $(basename "$skill")"
        done
        if [ -n "$skills" ]; then
            echo "   $name:$skills"
        else
            echo "   $name: (empty)"
        fi
    done
}

# ── Model tier resolution ─────────────────────────────────────────────────────
# Shared by all platform installers. Sources agent-models.env once and exposes
# resolve_model <platform_prefix> <agent_name> → model string (or empty).

MODELS_LOADED=false

load_models() {
    if [ "$MODELS_LOADED" = true ]; then return; fi
    if [ -f "$DOTFILES_DIR/agent-models.env" ]; then
        # shellcheck disable=SC1090
        source "$DOTFILES_DIR/agent-models.env"
    fi
    MODELS_LOADED=true
}

# tier_for <agent-name> → premium | mid | fast | ""
# Strips common prefixes (agent-) and suffixes (.md) to normalize.
tier_for() {
    local name="$1"
    name="$(basename "$name" .md)"       # strip .md
    name="${name#agent-}"                 # strip agent- prefix
    case "$name" in
        team-lead|reviewer|planner|puddleglum|doc-agent) echo "premium" ;;
        coder)     echo "mid" ;;
        secretary) echo "fast" ;;
        *)         echo "" ;;
    esac
}

# resolve_model <PREFIX> <agent-name> → model string or ""
# e.g. resolve_model OPENCODE coder → value of OPENCODE_MID
resolve_model() {
    local prefix="$1"
    local agent="$2"
    load_models
    local tier
    tier="$(tier_for "$agent")"
    [ -z "$tier" ] && return
    local tier_upper
    tier_upper="$(echo "$tier" | tr '[:lower:]' '[:upper:]')"
    local var="${prefix}_${tier_upper}"
    echo "${!var:-}"
}

# ── OpenCode agent installer ─────────────────────────────────────────────────
# Copies .md files with optional model injection into frontmatter.
install_opencode_agents() {
    local src_dir="$DOTFILES_DIR/.config/opencode/agents"
    local dest_dir="$HOME/.config/opencode/agents"
    mkdir -p "$dest_dir"

    # Clean out unmanaged agents before installing
    if [ -d "$dest_dir" ]; then
        echo "   🧹 Cleaning existing agents..."
        rm -f "$dest_dir"/*.md
    fi

    local found=0
    for src in "$src_dir"/*.md; do
        [ -f "$src" ] || continue
        local name
        name="$(basename "$src")"
        local dest="$dest_dir/$name"
        local model
        model="$(resolve_model OPENCODE "$name")"

        if [ -n "$model" ]; then
            awk -v m="$model" '
                NR==1 && /^---$/ { print; print "model: " m; next }
                { print }
            ' "$src" > "$dest"
            if ! head -1 "$src" | grep -q '^---$'; then
                echo "   ⚠️  $name has no frontmatter — model not injected"
            else
                echo "   ✅ Installed agent: $name (model: $model)"
            fi
        else
            cp "$src" "$dest"
            echo "   ✅ Installed agent: $name (using default model)"
        fi
        found=1
    done

    if [ "$found" -eq 0 ]; then
        echo "   (no agent files found in $src_dir)"
    fi
}

# ── Claude Code agent installer ──────────────────────────────────────────────
# Copies agent-* skill directories with optional model injection into SKILL.md
# frontmatter. Non-agent skills are still symlinked by link_profile_skills.
install_claude_agents() {
    local src_dir="$SKILL_SETS_DIR/universal"
    local dest_dir="$HOME/.claude/skills"
    mkdir -p "$dest_dir"

    local found=0
    for skill_dir in "$src_dir"/agent-*/; do
        [ -d "$skill_dir" ] || continue
        local skill_name
        skill_name="$(basename "$skill_dir")"
        local src_skill="$skill_dir/SKILL.md"
        local dest_skill_dir="$dest_dir/$skill_name"
        local dest_skill="$dest_skill_dir/SKILL.md"

        [ -f "$src_skill" ] || continue

        # Remove existing symlink if this was previously symlinked
        if [ -L "$dest_skill_dir" ]; then
            rm "$dest_skill_dir"
        fi

        mkdir -p "$dest_skill_dir"

        local model
        model="$(resolve_model CLAUDE_CODE "$skill_name")"

        if [ -n "$model" ]; then
            awk -v m="$model" '
                NR==1 && /^---$/ { print; print "model: " m; next }
                { print }
            ' "$src_skill" > "$dest_skill"
            if ! head -1 "$src_skill" | grep -q '^---$'; then
                echo "   ⚠️  $skill_name has no frontmatter — model not injected"
            else
                echo "   ✅ Installed agent: $skill_name (model: $model)"
            fi
        else
            cp "$src_skill" "$dest_skill"
            echo "   ✅ Installed agent: $skill_name (using default model)"
        fi
        found=1
    done

    if [ "$found" -eq 0 ]; then
        echo "   (no agent skills found in $src_dir)"
    fi
}

# ── Hermes plugins installer ──────────────────────────────────────────────────
# Symlinks plugin directories from dotfiles .hermes/plugins/ into
# ~/.hermes/plugins/. Hermes auto-discovers plugins from this directory.
install_hermes_plugins() {
    local src_dir="$DOTFILES_DIR/.hermes/plugins"
    local dest_dir="$HOME/.hermes/plugins"
    mkdir -p "$dest_dir"

    local found=0
    for plugin_dir in "$src_dir"/*/; do
        [ -d "$plugin_dir" ] || continue
        local plugin_name
        plugin_name="$(basename "$plugin_dir")"
        link_file "$plugin_dir" "$dest_dir/$plugin_name"
        found=1
    done

    if [ "$found" -eq 0 ]; then
        echo "   (no plugins found in $src_dir)"
    fi
}

# ── Hermes agent installer ────────────────────────────────────────────────────
# Symlinks agent-* skill directories from dotfiles .hermes/skills/ into
# ~/.hermes/skills/. Hermes loads skills by name via skill_view(), so symlinks
# are sufficient (no copy+inject needed — Hermes doesn't use model frontmatter).
install_hermes_agents() {
    local src_dir="$DOTFILES_DIR/.hermes/skills"
    local dest_dir="$HOME/.hermes/skills"
    mkdir -p "$dest_dir"

    local found=0
    for skill_dir in "$src_dir"/agent-*/; do
        [ -d "$skill_dir" ] || continue
        local skill_name
        skill_name="$(basename "$skill_dir")"
        link_file "$skill_dir" "$dest_dir/$skill_name"
        found=1
    done

    if [ "$found" -eq 0 ]; then
        echo "   (no agent skills found in $src_dir)"
    fi
}

# Check if any models are configured, show tip if not
check_model_tip() {
    load_models
    local has_any=false
    for var in OPENCODE_PREMIUM OPENCODE_MID OPENCODE_FAST \
               CLAUDE_CODE_PREMIUM CLAUDE_CODE_MID CLAUDE_CODE_FAST \
               HERMES_PREMIUM HERMES_MID HERMES_FAST; do
        [ -n "${!var:-}" ] && has_any=true && break
    done
    if [ "$has_any" = false ]; then
        echo ""
        echo "   💡 Tip: copy agent-models.env.example → agent-models.env and set"
        echo "      model IDs to enable cost tiering. Then re-run ./install.sh."
    fi
}

# --- Commands ---

cmd_activate() {
    local profile="$1"
    local project_dir="${2:-.}"
    project_dir="$(cd "$project_dir" && pwd)"

    echo "🔗 Activating profile '$profile' in $project_dir..."
    echo ""
    link_profile_skills "$profile" "$project_dir/.claude/skills"
    echo ""
    echo "Done. Profile '$profile' active in $project_dir"
}

cmd_deactivate() {
    local profile="$1"
    local project_dir="${2:-.}"
    project_dir="$(cd "$project_dir" && pwd)"
    local profile_dir="$SKILL_SETS_DIR/$profile"

    if [ ! -d "$profile_dir" ]; then
        echo "⚠️  Profile not found: $profile"
        return 1
    fi

    echo "🔗 Deactivating profile '$profile' from $project_dir..."
    echo ""

    for skill_dir in "$profile_dir"/*/; do
        [ -d "$skill_dir" ] || continue
        local skill_name="$(basename "$skill_dir")"
        local link="$project_dir/.claude/skills/$skill_name"
        if [ -L "$link" ]; then
            rm "$link"
            echo "   ❌ Removed: $link"
        fi
    done

    echo ""
    echo "Done. Profile '$profile' deactivated from $project_dir"
}

cmd_install() {
    echo "🔗 Installing dotfiles..."
    echo ""

    # Link shared agent infrastructure
    echo "📦 Linking agent infrastructure..."
    link_file "$DOTFILES_DIR/agent/msg.js" "$HOME/.agent/msg.js"
    link_file "$DOTFILES_DIR/agent/contracts/secretary-contract.md" "$HOME/.agent/contracts/secretary-contract.md"
    link_file "$DOTFILES_DIR/agent/contracts/team-lead-contracts.md" "$HOME/.agent/contracts/team-lead-contracts.md"
    link_file "$DOTFILES_DIR/agent/plan-completeness-routing.md" "$HOME/.agent/plan-completeness-routing.md"
    link_file "$DOTFILES_DIR/agent/incremental-review-commit-ranges.md" "$HOME/.agent/incremental-review-commit-ranges.md"

    # Link opencode config
    echo "📦 Linking opencode config..."
    link_file "$DOTFILES_DIR/.config/opencode/commands"              "$HOME/.config/opencode/commands"
    link_file "$DOTFILES_DIR/.config/opencode/AGENTS.md"            "$HOME/.config/opencode/AGENTS.md"
    install_opencode_agents
    # OpenCode contracts — symlink to shared location
    link_file "$DOTFILES_DIR/agent/contracts/secretary-contract.md" "$HOME/.config/opencode/secretary-contract.md"
    link_file "$DOTFILES_DIR/agent/contracts/team-lead-contracts.md" "$HOME/.config/opencode/team-lead-contracts.md"

    # Link Claude Code global config
    echo "📦 Linking Claude Code config..."
    link_file "$DOTFILES_DIR/.claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
    for script in "$DOTFILES_DIR/.claude/"*.sh; do
        [ -f "$script" ] || continue
        link_file "$script" "$HOME/.claude/$(basename "$script")"
    done

    # Install Claude Code agent skills (copy + model injection)
    echo "📦 Installing Claude Code agent skills..."
    install_claude_agents

    # Link non-agent universal Claude Code skills
    echo "📦 Linking universal Claude Code skills..."
    link_profile_skills "universal" "$HOME/.claude/skills"

    # Link Hermes plugins
    echo "📦 Installing Hermes plugins..."
    install_hermes_plugins

    # Link Hermes compression evals
    local evals_src="$DOTFILES_DIR/.hermes/compression-evals"
    local evals_dest="$HOME/.hermes/compression-evals"
    if [ -d "$evals_src" ]; then
        link_file "$evals_src" "$evals_dest"
    fi

    # Link Hermes agent skills
    echo "📦 Installing Hermes agent skills..."
    install_hermes_agents

    # Link Pi prompts and skills
    echo "📦 Linking Pi prompts and skills..."
    link_file "$DOTFILES_DIR/.pi/agent/prompts" "$HOME/.pi/agent/prompts"
    link_profile_skills_pi "universal" "$HOME/.pi/agent/skills"

    echo ""
    echo "🎉 Dotfiles installed!"
    check_model_tip
    echo ""
    echo "Platforms configured:"
    echo ""
    echo "  OpenCode:"
    echo "    Agents: ~/.config/opencode/agents/ (7 agents with model tiering)"
    echo "    Commands: /which-stream, /new-stream, /load-stream, /switch-stream, /note-that"
    echo ""
    echo "  Claude Code:"
    echo "    Global instructions: ~/.claude/CLAUDE.md"
    echo "    Agent skills: agent-team-lead, agent-planner, agent-coder, agent-reviewer,"
    echo "                  agent-secretary, agent-puddleglum, agent-doc-agent"
    echo "    Skills: ~/.claude/skills/"
    echo "    Activate a profile: ./install.sh activate <profile> [project-dir]"
    echo ""
  echo "  Hermes:"
  echo "    Agent skills: ~/.hermes/skills/ (symlinked)"
  echo "    Plugins: ~/.hermes/plugins/ (symlinked)"
  echo "    Compression: /output-compression full (or set compression.output_level in config.yaml)"
  echo "    Evals: ~/.hermes/compression-evals/eval.py (symlinked)"
  echo "    Usage: ANTHROPIC_API_KEY=... python eval.py --model claude-sonnet-4"
    echo "    Agents: agent-team-lead, agent-planner, agent-coder, agent-reviewer,"
    echo "            agent-secretary, agent-puddleglum, agent-doc-agent, agent-message-bus"
    echo "    Load via: skill_view(name='agent-team-lead')"
    echo ""
    echo "  Pi:"
    echo "    Prompts: ~/.pi/agent/prompts/"
    echo "    Skills: ~/.pi/agent/skills/"
    echo ""
    echo "  Shared:"
    echo "    Message bus: ~/.agent/msg.js"
    echo "    Contracts: ~/.agent/contracts/"
    echo ""
    list_profiles
}

# --- Main ---

case "${1:-}" in
    activate)
        [ -z "${2:-}" ] && echo "Usage: $0 activate <profile> [project-dir]" && exit 1
        cmd_activate "$2" "${3:-}"
        ;;
    deactivate)
        [ -z "${2:-}" ] && echo "Usage: $0 deactivate <profile> [project-dir]" && exit 1
        cmd_deactivate "$2" "${3:-}"
        ;;
    profiles)
        list_profiles
        ;;
    *)
        cmd_install
        ;;
esac
