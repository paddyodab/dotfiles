#!/usr/bin/env python3
"""
Compression Evals — Portable multi-model evaluation.

Tests compression effectiveness across any model/provider combo.
Saves results to JSON for cross-machine comparison.

Usage:
    # Single model test
    python eval.py --model claude-sonnet-4-20250514 --provider anthropic
    python eval.py --model gpt-4o --provider openai
    python eval.py --model deepseek-chat --provider deepseek

    # Compare multiple models
    python eval.py --compare claude-sonnet-4-20250514,gpt-4o,deepseek-chat
    python eval.py --compare-file models.txt

    # Specific suite/level
    python eval.py --suite coding --level full
    python eval.py --suite research --level ultra

    # Output
    python eval.py --json              # JSON to stdout
    python eval.py --save results.json # Save to file
    python eval.py --load results.json # Load and display previous results

Env vars for API keys:
    ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY,
    DEEPSEEK_API_KEY, etc.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Tuple


# ─────────────────────────────────────────────────────
# Compression Rules (self-contained, no deps)
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
# Provider Config
# ─────────────────────────────────────────────────────

PROVIDERS = {
    "anthropic": {
        "base_url": "https://api.anthropic.com/v1",
        "api_key_env": "ANTHROPIC_API_KEY",
        "call": "anthropic",
    },
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "api_key_env": "OPENAI_API_KEY",
        "call": "openai",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "api_key_env": "OPENROUTER_API_KEY",
        "call": "openai",
    },
    "deepseek": {
        "base_url": "https://api.deepseek.com/v1",
        "api_key_env": "DEEPSEEK_API_KEY",
        "call": "openai",
    },
    "opencode-zen": {
        "base_url": "https://api.opencode.ai/v1",
        "api_key_env": "OPENCODE_ZEN_API_KEY",
        "call": "openai",
    },
    "nous": {
        "base_url": "https://inference-api.nousresearch.com/v1",
        "api_key_env": "NOUS_API_KEY",
        "call": "openai",
    },
}


def get_api_key(provider: str) -> str:
    """Get API key from env vars."""
    prov = PROVIDERS.get(provider, {})
    env_var = prov.get("api_key_env", "")
    if env_var:
        key = os.environ.get(env_var, "")
        if key:
            return key
    # Fallback: try common env vars
    for var in ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "OPENCODE_ZEN_API_KEY", "NOUS_API_KEY"]:
        key = os.environ.get(var, "")
        if key:
            return key
    return ""


# ─────────────────────────────────────────────────────
# LLM Callers
# ─────────────────────────────────────────────────────

def call_anthropic(prompt: str, model: str, api_key: str, max_tokens: int = 2000) -> Tuple[str, int, float]:
    """Call Anthropic Messages API."""
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    body = {"model": model, "max_tokens": max_tokens, "messages": [{"role": "user", "content": prompt}]}
    data_bytes = json.dumps(body).encode("utf-8")
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=data_bytes, headers=headers, method="POST")
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        elapsed = time.time() - start
        text = "".join(b.get("text", "") for b in data.get("content", []))
        tokens = data.get("usage", {}).get("output_tokens", len(text) // 4)
        return text, tokens, elapsed
    except Exception as e:
        return "", 0, time.time() - start


def call_openai(prompt: str, model: str, api_key: str, base_url: str, max_tokens: int = 2000) -> Tuple[str, int, float]:
    """Call OpenAI-compatible API."""
    from openai import OpenAI
    client = OpenAI(base_url=base_url, api_key=api_key)
    start = time.time()
    try:
        response = client.chat.completions.create(model=model, messages=[{"role": "user", "content": prompt}], max_tokens=max_tokens, temperature=0.0)
        elapsed = time.time() - start
        text = response.choices[0].message.content or ""
        tokens = response.usage.completion_tokens if response.usage else len(text) // 4
        return text, tokens, elapsed
    except Exception as e:
        return "", 0, time.time() - start


def call_llm(prompt: str, model: str, provider: str, api_key: str = "", max_tokens: int = 2000) -> Tuple[str, int, float]:
    """Route to the right provider."""
    if not api_key:
        api_key = get_api_key(provider)
    if not api_key:
        print(f"  ⚠ No API key for {provider}. Set {PROVIDERS.get(provider, {}).get('api_key_env', 'API_KEY')} env var.", file=sys.stderr)
        return "", 0, 0

    prov = PROVIDERS.get(provider, PROVIDERS["openrouter"])
    call_type = prov.get("call", "openai")

    if call_type == "anthropic":
        return call_anthropic(prompt, model, api_key, max_tokens)
    else:
        base_url = prov.get("base_url", "")
        return call_openai(prompt, model, api_key, base_url, max_tokens)


# ─────────────────────────────────────────────────────
# Eval Suites
# ─────────────────────────────────────────────────────

CODING_SUITE = [
    {"id": "code-01", "prompt": "Write a Python function that validates an email address using regex. Return just the function.",
     "key_facts": ["function definition exists", "uses regex", "returns boolean"]},
    {"id": "code-02", "prompt": "Write a FastAPI POST endpoint with JSON body validation using Pydantic.",
     "key_facts": ["FastAPI app", "POST route", "Pydantic model", "request body"]},
    {"id": "code-03", "prompt": "Write a Python function that implements binary search. Return index or -1.",
     "key_facts": ["function definition", "midpoint calculation", "return index or -1"]},
    {"id": "code-04", "prompt": "Write a Python decorator that measures execution time.",
     "key_facts": ["decorator syntax", "time module", "wrapper function"]},
    {"id": "code-05", "prompt": "Write a Python context manager class for a file that auto-closes.",
     "key_facts": ["__enter__ method", "__exit__ method", "file close"]},
]

RESEARCH_SUITE = [
    {"id": "res-01", "prompt": "Explain the difference between SQL and NoSQL databases.",
     "key_facts": ["SQL structured relational", "NoSQL flexible schema", "SQL ACID transactions", "NoSQL horizontal scale"]},
    {"id": "res-02", "prompt": "What is the CAP theorem? Explain each component.",
     "key_facts": ["Consistency Availability Partition tolerance", "only two of three"]},
    {"id": "res-03", "prompt": "Explain how Docker containers differ from virtual machines.",
     "key_facts": ["containers share kernel", "VMs full OS", "containers lighter faster"]},
    {"id": "res-04", "prompt": "What are the SOLID principles in software design?",
     "key_facts": ["Single Responsibility", "Open Closed", "Liskov Substitution", "Interface Segregation", "Dependency Inversion"]},
]

ALL_SUITES = {"coding": CODING_SUITE, "research": RESEARCH_SUITE}


# ─────────────────────────────────────────────────────
# Eval Logic
# ─────────────────────────────────────────────────────

def check_facts(response: str, expected: List[str]) -> List[str]:
    """Check which expected facts appear in response."""
    found = []
    lower = response.lower()
    for fact in expected:
        words = [w for w in re.findall(r'\b[a-zA-Z_][a-zA-Z0-9_./-]+\b', fact.lower())
                 if len(w) > 2 and w not in {'the','and','for','with','that','this','has','can','use'}][:3]
        if all(w in lower for w in words):
            found.append(fact)
    return found


def extract_code_blocks(text: str) -> List[str]:
    return [b.strip() for b in re.findall(r'```(?:\w*\n)?(.*?)```', text, re.DOTALL) if b.strip()]


def check_syntax(code: str) -> bool:
    try:
        compile(code, '<eval>', 'exec')
        return True
    except SyntaxError:
        return False


def run_single_eval(prompt: str, model: str, provider: str, level: str, api_key: str = "") -> Dict:
    """Run one prompt: normal vs compressed."""
    caveman = CAVEMAN_RULES.get(level, CAVEMAN_RULES["full"])
    compressed_prompt = prompt + "\n\n" + caveman

    normal_text, normal_tokens, normal_time = call_llm(prompt, model, provider, api_key)
    comp_text, comp_tokens, comp_time = call_llm(compressed_prompt, model, provider, api_key)

    return {
        "normal": {"text": normal_text, "tokens": normal_tokens, "elapsed": round(normal_time, 2)},
        "compressed": {"text": comp_text, "tokens": comp_tokens, "elapsed": round(comp_time, 2)},
    }


def run_eval(model: str, provider: str, level: str = "full", suite: str = "research", api_key: str = "") -> Dict:
    """Run a full eval suite."""
    tests = ALL_SUITES.get(suite, RESEARCH_SUITE)
    results = []

    print(f"\n{'=' * 50}")
    print(f"Model: {model} ({provider})")
    print(f"Suite: {suite} | Level: {level}")
    print(f"{'=' * 50}")

    for test in tests:
        print(f"\n  [{test['id']}] {test['prompt'][:50]}...", flush=True)
        eval_result = run_single_eval(test["prompt"], model, provider, level, api_key)

        n = eval_result["normal"]
        c = eval_result["compressed"]

        facts_n = check_facts(n["text"], test["key_facts"])
        facts_c = check_facts(c["text"], test["key_facts"])
        completeness = len(facts_c) / len(facts_n) * 100 if facts_n else 100
        savings = (1 - c["tokens"] / n["tokens"]) * 100 if n["tokens"] > 0 else 0

        code_n = extract_code_blocks(n["text"])
        code_c = extract_code_blocks(c["text"])
        code_pass_n = sum(1 for b in code_n if check_syntax(b))
        code_pass_c = sum(1 for b in code_c if check_syntax(b))

        result = {
            "id": test["id"],
            "prompt": test["prompt"],
            "normal_tokens": n["tokens"],
            "compressed_tokens": c["tokens"],
            "token_savings_pct": round(savings, 1),
            "facts_normal": len(facts_n),
            "facts_compressed": len(facts_c),
            "factual_completeness_pct": round(completeness, 1),
            "code_pass_normal": code_pass_n,
            "code_pass_compressed": code_pass_c,
            "normal_elapsed": n["elapsed"],
            "compressed_elapsed": c["elapsed"],
        }
        results.append(result)

        print(f"    Tokens: {n['tokens']} → {c['tokens']} ({savings:.0f}%)")
        print(f"    Facts: {len(facts_c)}/{len(facts_n)} ({completeness:.0f}%)")
        print(f"    Time: {n['elapsed']:.1f}s → {c['elapsed']:.1f}s")

    # Aggregate
    agg = {
        "model": model,
        "provider": provider,
        "suite": suite,
        "level": level,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total_prompts": len(results),
        "avg_token_savings_pct": round(sum(r["token_savings_pct"] for r in results) / len(results), 1) if results else 0,
        "avg_factual_completeness_pct": round(sum(r["factual_completeness_pct"] for r in results) / len(results), 1) if results else 0,
        "avg_normal_tokens": round(sum(r["normal_tokens"] for r in results) / len(results)) if results else 0,
        "avg_compressed_tokens": round(sum(r["compressed_tokens"] for r in results) / len(results)) if results else 0,
        "results": results,
    }

    print(f"\n  SUMMARY: {agg['avg_token_savings_pct']}% savings, {agg['avg_factual_completeness_pct']}% facts preserved")

    return agg


def compare_models(models: List[str], provider: str, level: str, suite: str, api_key: str = "") -> List[Dict]:
    """Run evals for multiple models and compare."""
    all_results = []
    for model in models:
        model = model.strip()
        if not model:
            continue
        result = run_eval(model, provider, level, suite, api_key)
        all_results.append(result)
        time.sleep(1)  # Rate limit courtesy

    # Print comparison table
    print(f"\n{'=' * 70}")
    print(f"COMPARISON: {suite} suite, {level} compression")
    print(f"{'=' * 70}")
    print(f"{'Model':<35} {'Savings':>8} {'Facts':>8} {'Avg Tokens':>12}")
    print(f"{'-' * 35} {'-' * 8} {'-' * 8} {'-' * 12}")
    for r in sorted(all_results, key=lambda x: x["avg_token_savings_pct"], reverse=True):
        print(f"{r['model']:<35} {r['avg_token_savings_pct']:>7.1f}% {r['avg_factual_completeness_pct']:>7.1f}% {r['avg_normal_tokens']:>5} → {r['avg_compressed_tokens']:<5}")

    return all_results


# ─────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Compression Evals — Portable Multi-Model Testing")
    parser.add_argument("--model", default=None, help="Single model to test")
    parser.add_argument("--provider", default="anthropic", choices=list(PROVIDERS.keys()))
    parser.add_argument("--compare", default=None, help="Comma-separated models to compare")
    parser.add_argument("--suite", default="research", choices=list(ALL_SUITES.keys()))
    parser.add_argument("--level", default="full", choices=["lite", "full", "ultra"])
    parser.add_argument("--json", action="store_true", help="JSON output")
    parser.add_argument("--save", default=None, help="Save results to JSON file")
    parser.add_argument("--load", default=None, help="Load and display previous results")
    args = parser.parse_args()

    # Load previous results
    if args.load:
        with open(args.load) as f:
            data = json.load(f)
        if args.json:
            print(json.dumps(data, indent=2))
        else:
            if isinstance(data, list):
                for r in data:
                    print(f"\n{r['model']} ({r['provider']}) — {r['suite']}/{r['level']} @ {r['timestamp']}")
                    print(f"  Savings: {r['avg_token_savings_pct']}% | Facts: {r['avg_factual_completeness_pct']}%")
            else:
                print(f"\n{data['model']} ({data['provider']}) — {data['suite']}/{data['level']} @ {data['timestamp']}")
                print(f"  Savings: {data['avg_token_savings_pct']}% | Facts: {data['avg_factual_completeness_pct']}%")
        return

    # Run evals
    if args.compare:
        models = [m.strip() for m in args.compare.split(",")]
        results = compare_models(models, args.provider, args.level, args.suite)
    elif args.model:
        results = [run_eval(args.model, args.provider, args.level, args.suite)]
    else:
        print("Usage: python eval.py --model <model> --provider <provider>")
        print("       python eval.py --compare model1,model2,model3")
        print("       python eval.py --load results.json")
        sys.exit(1)

    # Save results
    if args.save:
        with open(args.save, "w") as f:
            json.dump(results, f, indent=2)
        print(f"\nSaved to {args.save}")

    if args.json:
        print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
