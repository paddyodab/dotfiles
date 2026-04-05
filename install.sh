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

    # Link opencode commands
    echo "📦 Linking opencode commands..."
    link_file "$DOTFILES_DIR/.config/opencode/commands" "$HOME/.config/opencode/commands"

    # Link Pi prompts
    echo "📦 Linking Pi prompts..."
    link_file "$DOTFILES_DIR/.pi/agent/prompts" "$HOME/.pi/agent/prompts"

    # Link Claude Code scripts
    echo "📦 Linking Claude Code scripts..."
    for script in "$DOTFILES_DIR/.claude/"*.sh; do
        [ -f "$script" ] || continue
        link_file "$script" "$HOME/.claude/$(basename "$script")"
    done

    # Link universal Claude Code skills
    echo "📦 Linking universal Claude Code skills..."
    link_profile_skills "universal" "$HOME/.claude/skills"

    # Link universal Pi skills
    echo "📦 Linking universal Pi skills..."
    link_profile_skills_pi "universal" "$HOME/.pi/agent/skills"

    echo ""
    echo "🎉 Dotfiles installed!"
    echo ""
    echo "Commands now available:"
    echo ""
    echo "Opencode:"
    echo "   /which-stream, /new-stream, /load-stream, /switch-stream, /note-that"
    echo ""
    echo "Pi:"
    echo "   /which-stream, /new-stream, /load-stream, /switch-stream, /note-that"
    echo "   Universal skills linked to ~/.pi/agent/skills/"
    echo ""
    echo "Claude Code:"
    echo "   Universal skills linked to ~/.claude/skills/"
    echo "   Activate a profile: ./install.sh activate <profile> [project-dir]"
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
