# Compression Evals

Portable eval framework for testing token compression across models and machines.

## Quick Start

```bash
# Test with Anthropic
ANTHROPIC_API_KEY=sk-ant-... python eval.py --model claude-sonnet-4-20250514 --provider anthropic

# Test with OpenAI
OPENAI_API_KEY=sk-... python eval.py --model gpt-4o --provider openai

# Compare models
python eval.py --compare claude-sonnet-4-20250514,gpt-4o --provider anthropic

# Different compression levels
python eval.py --model claude-sonnet-4-20250514 --level ultra
python eval.py --model claude-sonnet-4-20250514 --level lite

# Save results for cross-machine comparison
python eval.py --model claude-sonnet-4-20250514 --save laptop-results.json
python eval.py --model claude-sonnet-4-20250514 --save work-results.json

# Load and compare
python eval.py --load laptop-results.json
python eval.py --load work-results.json --json
```

## What It Measures

- **Token savings**: % reduction in output tokens
- **Factual completeness**: % of expected facts preserved
- **Code correctness**: Syntax validity of code blocks
- **Response time**: Elapsed seconds comparison

## Supported Providers

| Provider | Env Var | Example Model |
|----------|---------|---------------|
| anthropic | `ANTHROPIC_API_KEY` | claude-sonnet-4-20250514 |
| openai | `OPENAI_API_KEY` | gpt-4o |
| openrouter | `OPENROUTER_API_KEY` | anthropic/claude-sonnet-4 |
| deepseek | `DEEPSEEK_API_KEY` | deepseek-chat |

## Cross-Machine Workflow

1. On laptop: `python eval.py --model claude-sonnet-4 --save laptop.json`
2. On work: `python eval.py --model gpt-4o --save work.json`
3. Compare: `python eval.py --load laptop.json && python eval.py --load work.json`

## Suites

- `research` — Explains concepts (SQL, CAP theorem, Docker, SOLID)
- `coding` — Writes code (validation, FastAPI, binary search, decorators, context managers)
