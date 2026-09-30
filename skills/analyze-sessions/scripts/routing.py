#!/usr/bin/env python3
"""Summarize an opt-in Ultimate Pi routing trace (JSONL).

The trace is local. This script only reads the file you pass.
"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path


def load(path: Path):
    events = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        events.append(json.loads(line))
    return events


def main() -> int:
    parser = argparse.ArgumentParser(description="Summarize an Ultimate Pi routing trace")
    parser.add_argument("trace", type=Path, help="Path to a traces/*.jsonl file")
    args = parser.parse_args()
    if not args.trace.is_file():
        print(f"No trace file at {args.trace}", file=sys.stderr)
        return 1
    events = load(args.trace)
    tiers = Counter()
    sources = Counter()
    types = Counter()
    hops = 0
    blocks = 0
    repairs = 0
    for event in events:
        kind = event.get("type", "unknown")
        types[kind] += 1
        if kind == "jev-triage":
            tiers[event.get("tier", "unknown")] += 1
            sources[event.get("source", "unknown")] += 1
        elif kind == "quota-fallback":
            hops += 1
        elif kind == "bash-guard":
            blocks += 1
        elif kind == "review-verdict" and event.get("verdict") == "NEEDS CHANGES":
            repairs += 1
    print(f"events: {len(events)}")
    print("types: " + ", ".join(f"{name}={count}" for name, count in sorted(types.items())))
    if tiers:
        print("tiers: " + ", ".join(f"{name}={count}" for name, count in sorted(tiers.items())))
    if sources:
        print("triage sources: " + ", ".join(f"{name}={count}" for name, count in sorted(sources.items())))
    print(f"fallback hops: {hops}")
    print(f"bash blocks: {blocks}")
    print(f"review repairs: {repairs}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
