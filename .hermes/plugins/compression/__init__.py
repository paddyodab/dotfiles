"""Compression plugin — input + output token compression.

Features:
1. INPUT COMPRESSION: Compresses verbose user messages in conversation history
   in-place. Each message compressed once, then skipped on future turns.
2. OUTPUT COMPRESSION: Appends caveman-style rules to the user message so
   the model responds tersely.

Both features are togglable via /input-compression and /output-compression
slash commands (registered in cli.py).

Architecture:
- pre_llm_call hook receives conversation_history (list of message dicts)
- The dicts are the SAME objects as in the main messages list
- Mutating conversation_history[-1]["content"] mutates the real message
- Once compressed, "compressed text" == "compressed text" → no-op on re-run
"""

import hashlib
import logging
import re
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────
# Compression Rules (agent-agnostic, no dependencies)
# ─────────────────────────────────────────────────────

# Input compression rules (lighter than defluffer — preserve readability)
INPUT_RULES = [
    (r'\b(a|an|the) ', ''),
    (r'\b(really|very|basically|actually|simply|just|quite|definitely|certainly|absolutely) ', ''),
    (r'\bis used to\b', 'used for'),
    (r'\bcan be used to\b', 'used for'),
    (r'\bmake sure to\b', 'ensure'),
    (r'\bin order to\b', 'to'),
    (r'\bdue to the fact that\b', 'because'),
    (r'\bfor the purpose of\b', 'to'),
    (r'\bhas the ability to\b', 'can'),
    (r'\bit is important to\b', 'must'),
    (r'\bit is worth noting that\b', 'note:'),
    (r'\bkeep in mind that\b', 'note:'),
    (r'\btake into consideration\b', 'consider'),
    (r'\bas well as\b', 'and'),
    (r'\bin addition to\b', 'and'),
    (r'\bwhether or not\b', 'whether'),
    (r'\bprior to\b', 'before'),
    (r'\bsubsequent to\b', 'after'),
    (r'\bin the event that\b', 'if'),
    (r'\bwith respect to\b', 'about'),
    (r'\bin relation to\b', 'about'),
    (r'\bat this point in time\b', 'now'),
    (r'\bon a regular basis\b', 'regularly'),
    (r'\bin a timely manner\b', 'promptly'),
    (r'\bfor the most part\b', 'mostly'),
    (r'\bby means of\b', 'via'),
    (r'\ba large number of\b', 'many'),
    (r'\bthe majority of\b', 'most'),
    (r'\bI was wondering if you could\b', ''),
    (r'\bI would really appreciate it if\b', ''),
    (r'\bCould you please\b', ''),
    (r'\bCan you please\b', ''),
    (r'\bI would like you to\b', ''),
    (r'\bI want you to\b', ''),
    (r'\bI need you to\b', ''),
    (r'\bIf you don\'t mind\b', ''),
    (r'\bI am trying to figure out\b', ''),
    (r'\bI have a question about\b', ''),
    (r'\bI am curious about\b', ''),
    (r'  +', ' '),
]

# Output compression rules (caveman modes)
CAVEMAN_RULES = {
    "lite": (
        "[RESPOND TERSE. Drop filler/hedging. Keep articles + full sentences. "
        "Professional but tight. No pleasantries.]"
    ),
    "full": (
        "[CAVEMAN MODE: Respond terse like smart caveman. All technical substance stay. "
        "Only fluff die. Drop: articles (a/an/the), filler (just/really/basically), "
        "pleasantries (sure/certainly/of course), hedging. Fragments OK. "
        "Short synonyms. Technical terms exact. Code unchanged. "
        "Pattern: [thing] [action] [reason]. [next step].]"
    ),
    "ultra": (
        "[ULTRA COMPRESS: Maximum abbreviation. DB/auth/config/req/res/fn/impl. "
        "Strip conjunctions. Arrows for causality (X → Y). "
        "One word when one word enough. Telegraphic.]"
    ),
}


def compress_text(text: str) -> str:
    """Apply input compression rules to text."""
    result = text
    for pattern, replacement in INPUT_RULES:
        result = re.sub(pattern, replacement, result, flags=re.IGNORECASE)
    return result.strip()


def _message_hash(content: str) -> str:
    """Short hash to identify if a message was already compressed."""
    return hashlib.md5(content.encode()).hexdigest()[:8]


# ─────────────────────────────────────────────────────
# Plugin Registration
# ─────────────────────────────────────────────────────

def register(ctx):
    """Register the compression plugin hooks."""

    # Track which messages we've already compressed (by content hash)
    _compressed_hashes: set = set()

    def on_pre_llm_call(
        user_message: str,
        conversation_history: List[Dict[str, Any]] = None,
        **kwargs,
    ) -> Dict[str, str]:
        """Compress conversation history and append output rules."""
        # Read config
        input_enabled = True
        caveman_level = None
        try:
            from hermes_cli.config import load_config
            cfg = load_config()
            comp_cfg = cfg.get("compression", {})
            input_enabled = comp_cfg.get("input_enabled", True)
            caveman_level = comp_cfg.get("output_level", None)
        except Exception:
            pass

        parts = []

        # ── 1. INPUT COMPRESSION ──
        if input_enabled and conversation_history:
            for msg in conversation_history:
                if msg.get("role") != "user":
                    continue
                content = msg.get("content", "")
                if not content or not isinstance(content, str):
                    continue

                # Skip if already compressed (check hash before and after)
                content_hash = _message_hash(content)
                if content_hash in _compressed_hashes:
                    continue

                # Skip messages that already have caveman rules appended
                if "[CAVEMAN MODE:" in content or "[ULTRA COMPRESS:" in content:
                    _compressed_hashes.add(content_hash)
                    continue

                # Compress
                compressed = compress_text(content)
                if compressed != content and compressed.strip():
                    # Only apply if meaningful savings (>10%)
                    savings = (1 - len(compressed) / len(content)) * 100
                    if savings >= 10:
                        msg["content"] = compressed
                        new_hash = _message_hash(compressed)
                        _compressed_hashes.add(new_hash)
                        logger.debug(
                            "Compressed message: %d → %d chars (%.0f%% saved)",
                            len(content), len(compressed), savings,
                        )

                # Mark original as processed
                _compressed_hashes.add(content_hash)

        # ── 2. OUTPUT COMPRESSION: append caveman rules ──
        if caveman_level and caveman_level in CAVEMAN_RULES:
            parts.append(CAVEMAN_RULES[caveman_level])

        if parts:
            return {"context": "\n\n".join(parts)}
        return {}

    ctx.register_hook("pre_llm_call", on_pre_llm_call)
    logger.info("Compression plugin registered: pre_llm_call hook")
