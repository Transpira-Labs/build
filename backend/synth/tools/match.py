"""
Match a v1 tool's English `functionality` to a template (tier 1 of synthesis).

Deliberately simple and dependency-free: score each template by the total length of
its keyword phrases that appear in the (lowercased) description, so a specific phrase
like "web search" outweighs a generic "search". Returns the best template, or None
when nothing is confidently relevant — which is the signal to fall back to the LLM.
"""

from __future__ import annotations

from synth.tools.templates import TEMPLATES, Template


def match_template(functionality: str, *, min_score: int = 3) -> Template | None:
    text = functionality.lower()
    best: Template | None = None
    best_score = 0
    for tmpl in TEMPLATES:
        score = sum(len(kw) for kw in tmpl.keywords if kw in text)
        if score > best_score:
            best, best_score = tmpl, score
    return best if best_score >= min_score else None
