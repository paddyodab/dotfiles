"""Compression plugin — cavemem-style tokenized compression.

Pipeline: input → tokenize → [preserved | prose] → transform prose → join → output

Tokenizer preserves: code, URLs, paths, versions, dates, numbers, identifiers, headings.
Prose transforms: remove pleasantries/hedges/fillers/articles, abbreviate, collapse whitespace.

Intensity levels: lite (gentle), full (default), ultra (aggressive).
"""

import json
import hashlib
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Tuple

logger = logging.getLogger(__name__)

# File-based compression stats log (persistent across sessions)
_COMP_LOG = Path.home() / ".hermes" / "compression.log"

def _stat_log(msg: str):
    """Append timestamped stat to ~/.hermes/compression.log."""
    from datetime import datetime
    ts = datetime.now().strftime("%H:%M:%S")
    try:
        with open(_COMP_LOG, "a") as f:
            f.write(f"[{ts}] {msg}\n")
    except Exception:
        pass

# ─────────────────────────────────────────────────────
# Lexicon loader
# ─────────────────────────────────────────────────────

_LEXICON = None

def _load_lexicon() -> dict:
    global _LEXICON
    if _LEXICON is None:
        lexicon_path = Path(__file__).parent / "lexicon.json"
        with open(lexicon_path) as f:
            _LEXICON = json.load(f)
    return _LEXICON

# ─────────────────────────────────────────────────────
# Tokenizer (ported from cavemem)
# ─────────────────────────────────────────────────────

SEGMENT_KINDS = [
    ("fence",          100, r'```[\s\S]*?```|~~~[\s\S]*?~~~'),
    ("inline_code",     90, r'`[^`\n]+`'),
    ("url",             80, r'\bhttps?://[^\s)\].,;:]+'),
    ("heading",         70, r'^#{1,6}\s[^\n]*$'),
    ("path",            60, r'(?:\.{1,2}/[A-Za-z0-9._\-/]+|~/[A-Za-z0-9._\-/]+|/[A-Za-z0-9._\-/]+|[A-Z]:\\[A-Za-z0-9._\\]+)'),
    ("date",            50, r'\b\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?\b'),
    ("version",         40, r'\bv?\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?\b'),
    ("number",          30, r'\b\d+(?:\.\d+)?\b'),
    ("identifier",      20, r'\b[A-Za-z_][A-Za-z0-9_]*[-_][A-Za-z0-9_\-]+\b|\b[a-z]+[A-Z][A-Za-z0-9]*\b'),
]

_TOKENIZER_RULES = []
for kind, priority, pattern in SEGMENT_KINDS:
    _TOKENIZER_RULES.append((kind, priority, re.compile(pattern, re.MULTILINE)))


class Segment:
    __slots__ = ("kind", "text", "preserved")
    def __init__(self, kind: str, text: str, preserved: bool):
        self.kind = kind
        self.text = text
        self.preserved = preserved


def tokenize(text: str) -> List[Segment]:
    """Split text into preserved (code/URL/path/etc) and prose segments."""
    spans = []
    for kind, priority, regex in _TOKENIZER_RULES:
        for m in regex.finditer(text):
            if m.group(0):
                spans.append((m.start(), m.end(), kind, priority))

    # Resolve overlaps: higher priority wins, earlier start wins ties
    spans.sort(key=lambda s: (s[0], -s[3], -(s[1] - s[0])))
    resolved = []
    cursor = 0
    for start, end, kind, priority in spans:
        if start < cursor:
            continue
        resolved.append((start, end, kind))
        cursor = end
    resolved.sort()

    # Build segments
    out = []
    pos = 0
    for start, end, kind in resolved:
        if start > pos:
            out.append(Segment("prose", text[pos:start], False))
        out.append(Segment(kind, text[start:end], True))
        pos = end
    if pos < len(text):
        out.append(Segment("prose", text[pos:], False))
    return out

# ─────────────────────────────────────────────────────
# Prose transforms
# ─────────────────────────────────────────────────────

def _remove_phrases(text: str, phrases: List[str]) -> str:
    if not phrases:
        return text
    sorted_phrases = sorted(phrases, key=len, reverse=True)
    escaped = [re.escape(p) for p in sorted_phrases]
    pattern = re.compile(r'\b(?:' + '|'.join(escaped) + r')\b', re.IGNORECASE)
    return pattern.sub(' ', text)


def _abbreviate(text: str, abbrevs: Dict[str, str]) -> str:
    if not abbrevs:
        return text
    sorted_items = sorted(abbrevs.items(), key=lambda x: len(x[0]), reverse=True)
    for long_form, short_form in sorted_items:
        pattern = re.compile(r'\b' + re.escape(long_form) + r'\b', re.IGNORECASE)
        def _match_case(m, target=short_form):
            s = m.group(0)
            if s == s.upper():
                return target.upper()
            if s[0].isupper():
                return target[0].upper() + target[1:]
            return target
        text = pattern.sub(_match_case, text)
    return text


def _collapse_whitespace(text: str) -> str:
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r' ?\n ?', '\n', text)
    text = re.sub(r' +([.,;:!?])', r'\1', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def compress_prose(text: str, intensity: str) -> str:
    """Compress a prose segment."""
    lexicon = _load_lexicon()
    out = text
    out = _remove_phrases(out, lexicon.get("pleasantries", {}).get(intensity, []))
    out = _remove_phrases(out, lexicon.get("hedges", {}).get(intensity, []))
    out = _remove_phrases(out, lexicon.get("fillers", {}).get(intensity, []))
    out = _remove_phrases(out, lexicon.get("articles", {}).get(intensity, []))
    out = _abbreviate(out, lexicon.get("abbreviations", {}).get(intensity, {}))
    out = _collapse_whitespace(out)
    return out

# ─────────────────────────────────────────────────────
# Main compress/expand
# ─────────────────────────────────────────────────────

def compress(text: str, intensity: str = "full") -> str:
    """Compress text. Preserves code, URLs, paths, etc. Only compresses prose."""
    segments = tokenize(text)
    out = []
    for i, seg in enumerate(segments):
        if seg.preserved:
            # Add space before preserved segment if previous was prose (and didn't end with space/line)
            if i > 0 and not segments[i-1].preserved and out and out[-1] and not out[-1][-1].isspace():
                out.append(' ')
            out.append(seg.text)
        else:
            compressed = compress_prose(seg.text, intensity)
            # Ensure trailing space if next segment is preserved and compressed doesn't end with space
            if i + 1 < len(segments) and segments[i+1].preserved and compressed and not compressed[-1].isspace():
                compressed += ' '
            out.append(compressed)
    result = ''.join(out)
    result = re.sub(r'[ \t]+([.,;:!?])', r'\1', result)
    return _collapse_whitespace(result)


def expand(text: str) -> str:
    """Expand abbreviations back to long form. Lossy on removed filler words."""
    lexicon = _load_lexicon()
    expansions = lexicon.get("expansions", {})
    if not expansions:
        return text
    segments = tokenize(text)
    sorted_items = sorted(expansions.items(), key=lambda x: len(x[0]), reverse=True)
    out = []
    for seg in segments:
        if seg.preserved:
            out.append(seg.text)
        else:
            s = seg.text
            for short, long in sorted_items:
                pattern = re.compile(r'\b' + re.escape(short) + r'\b', re.IGNORECASE)
                def _match_case(m, target=long):
                    src = m.group(0)
                    if src == src.upper():
                        return target.upper()
                    if src[0].isupper():
                        return target[0].upper() + target[1:]
                    return target
                s = pattern.sub(_match_case, s)
            out.append(s)
    return ''.join(out)

# ─────────────────────────────────────────────────────
# Output compression rules (caveman modes)
# ─────────────────────────────────────────────────────

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

# ─────────────────────────────────────────────────────
# Plugin registration
# ─────────────────────────────────────────────────────

def _message_hash(content: str) -> str:
    return hashlib.md5(content.encode()).hexdigest()[:8]


def register(ctx):
    """Register compression plugin hooks."""
    _compressed_hashes: set = set()
    _output_logged: bool = False

    def on_pre_llm_call(
        user_message: str,
        conversation_history: List[Dict[str, Any]] = None,
        **kwargs,
    ) -> Dict[str, str]:
        # Read config
        input_enabled = True
        caveman_level = None
        try:
            from hermes_cli.config import load_config
            cfg = load_config()
            comp_cfg = cfg.get("token_compression", {})
            input_enabled = comp_cfg.get("input_enabled", True)
            caveman_level = comp_cfg.get("output_level", None)
        except Exception:
            pass

        parts = []

        # INPUT COMPRESSION
        if input_enabled and conversation_history:
            for msg in conversation_history:
                if msg.get("role") != "user":
                    continue
                content = msg.get("content", "")
                if not content or not isinstance(content, str):
                    continue
                content_hash = _message_hash(content)
                if content_hash in _compressed_hashes:
                    continue
                if "[CAVEMAN MODE:" in content or "[ULTRA COMPRESS:" in content:
                    _compressed_hashes.add(content_hash)
                    continue
                compressed = compress(content, "full")
                if compressed != content and compressed.strip():
                    savings = (1 - len(compressed) / len(content)) * 100
                    if savings >= 10:
                        msg["content"] = compressed
                        _compressed_hashes.add(_message_hash(compressed))
                        logger.debug("Compressed: %d → %d chars (%.0f%%)", len(content), len(compressed), savings)
                        _stat_log(f"Input ({savings:.0f}%): ~{len(compressed)} tok (~{len(content)-len(compressed)} saved) \"{compressed[:60]}\"")
                _compressed_hashes.add(content_hash)

        # OUTPUT COMPRESSION
        if caveman_level and caveman_level in CAVEMAN_RULES:
            parts.append(CAVEMAN_RULES[caveman_level])
            if not _output_logged:
                nonlocal _output_logged
                _output_logged = True
                _stat_log(f"Output ({caveman_level}): active")

        if parts:
            return {"context": "\n\n".join(parts)}
        return {}

    ctx.register_hook("pre_llm_call", on_pre_llm_call)
    logger.info("Compression plugin registered")
