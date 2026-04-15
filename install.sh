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

# Link all skill directories from a profile into a target skills dir
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

# Install agent files with optional model injection from agent-models.env.
# Copies (not symlinks) so model IDs can be injected per-machine without
# touching the source files. Re-run install.sh to pick up prompt updates.
install_agents() {
    local src_dir="$DOTFILES_DIR/.config/opencode/agents"
    local dest_dir="$HOME/.config/opencode/agents"
    mkdir -p "$dest_dir"

    # Load model tiers if present
    local premium_model="" mid_model="" fast_model=""
    if [ -f "$DOTFILES_DIR/agent-models.env" ]; then
        # shellcheck disable=SC1090
        source "$DOTFILES_DIR/agent-models.env"

        # Provider-based resolution (new format)
        if [ -n "${AGENT_PROVIDER:-}" ]; then
            local provider_upper
            provider_upper="$(echo "$AGENT_PROVIDER" | tr '[:lower:]-' '[:upper:]_')"
            eval "premium_model=\${${provider_upper}_PREMIUM:-}"
            eval "mid_model=\${${provider_upper}_MID:-}"
            eval "fast_model=\${${provider_upper}_FAST:-}"
            echo "   Using provider: $AGENT_PROVIDER"
        else
            # Legacy format (backward compatible)
            premium_model="${PREMIUM_MODEL:-}"
            mid_model="${MID_MODEL:-}"
            fast_model="${FAST_MODEL:-}"
        fi
    fi

    # tier_for <filename> → premium | mid | fast | ""
    tier_for() {
        case "$(basename "$1" .md)" in
            team-lead|reviewer|planner|puddleglum|doc-agent) echo "premium" ;;
            coder)     echo "mid" ;;
            secretary) echo "fast" ;;
            *)         echo "" ;;
        esac
    }

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
        local tier
        tier="$(tier_for "$src")"
        local model=""
        case "$tier" in
            premium) model="$premium_model" ;;
            mid)     model="$mid_model" ;;
            fast)    model="$fast_model" ;;
        esac

        if [ -n "$model" ]; then
            # Inject model line into frontmatter (after opening ---)
            awk -v m="$model" '
                NR==1 && /^---$/ { print; print "model: " m; next }
                { print }
            ' "$src" > "$dest"
            # Warn if injection failed due to missing frontmatter
            if ! head -1 "$src" | grep -q '^---$'; then
                echo "   ⚠️  $name has no frontmatter — model not injected"
            else
                echo "   ✅ Installed agent: $name (model: $model)"
            fi
        else
            cp "$src" "$dest"
            echo "   ✅ Installed agent: $name (using OpenCode default model)"
        fi
        found=1
    done

    if [ "$found" -eq 0 ]; then
        echo "   (no agent files found in $src_dir)"
    fi

    if [ -z "$premium_model" ] && [ -z "$mid_model" ] && [ -z "$fast_model" ]; then
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

    # Link opencode config
    echo "📦 Linking opencode config..."
    link_file "$DOTFILES_DIR/.config/opencode/commands"              "$HOME/.config/opencode/commands"
    link_file "$DOTFILES_DIR/.config/opencode/AGENTS.md"            "$HOME/.config/opencode/AGENTS.md"
    install_agents
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

    # Link universal Claude Code skills (includes agent-* skills)
    echo "📦 Linking universal Claude Code skills..."
    link_profile_skills "universal" "$HOME/.claude/skills"

    # Link Pi prompts and skills
    echo "📦 Linking Pi prompts and skills..."
    link_file "$DOTFILES_DIR/.pi/agent/prompts" "$HOME/.pi/agent/prompts"
    link_profile_skills_pi "universal" "$HOME/.pi/agent/skills"

    echo ""
    echo "🎉 Dotfiles installed!"
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
