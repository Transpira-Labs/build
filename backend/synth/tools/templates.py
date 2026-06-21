"""
The hand-written, tested tool template library (tier 1 of synthesis).

Each `Template` is a known-good tool: its imports, a body that references its params,
a `needs_sandbox` flag (true when it runs code, hits the network, or touches the fs),
and — for safe tools only — a `sample` call used to smoke-test by actually running it.

Matching a v1 tool's English `functionality` to one of these is preferred over LLM
codegen because the result is already correct and audited.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from synth.contracts import ToolParam

_PY_TYPE = {"string": "str", "integer": "int", "number": "float", "boolean": "bool"}


@dataclass
class Template:
    key: str
    keywords: tuple[str, ...]
    description: str
    params: list[ToolParam]
    needs_sandbox: bool
    imports: tuple[str, ...]
    body: str  # 4-space indented, references param names
    sample_args: dict[str, Any] | None = None  # only used when not needs_sandbox
    expected: Any = None
    extra_keywords: tuple[str, ...] = field(default_factory=tuple)

    def render(self, name: str) -> str:
        ordered = sorted(self.params, key=lambda p: not p.required)
        sig = ", ".join(
            f"{p.name}: {_PY_TYPE.get(p.type, 'str')}"
            + ("" if p.required else " | None = None")
            for p in ordered
        )
        head = "\n".join(self.imports)
        head = (head + "\n\n\n") if head else ""
        doc = self.description.replace('"""', "'''")
        return f'{head}def {name}({sig}) -> str:\n    """{doc}"""\n{self.body.rstrip()}\n'


TEMPLATES: list[Template] = [
    Template(
        key="run_python",
        keywords=("run python", "execute python", "python script", "run code",
                  "execute code", "python interpreter", "stdout", "run a script"),
        description="Execute a Python script and return its stdout and stderr.",
        params=[ToolParam(name="code", type="string", description="python source to run")],
        needs_sandbox=True,
        imports=("import subprocess", "import sys"),
        body=(
            "    proc = subprocess.run(\n"
            "        [sys.executable, \"-c\", code],\n"
            "        capture_output=True, text=True, timeout=30,\n"
            "    )\n"
            "    return (proc.stdout + proc.stderr).strip()"
        ),
    ),
    Template(
        key="calculator",
        keywords=("calculate", "calculator", "arithmetic", "evaluate expression",
                  "compute", "math expression", "do math", "evaluate math"),
        description="Safely evaluate an arithmetic expression and return the result.",
        params=[ToolParam(name="expression", type="string", description="e.g. '2 + 3 * 4'")],
        needs_sandbox=False,
        imports=("import ast", "import operator"),
        body=(
            "    _ops = {\n"
            "        ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,\n"
            "        ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv,\n"
            "        ast.Mod: operator.mod, ast.Pow: operator.pow,\n"
            "        ast.USub: operator.neg, ast.UAdd: operator.pos,\n"
            "    }\n"
            "\n"
            "    def _ev(node):\n"
            "        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):\n"
            "            return node.value\n"
            "        if isinstance(node, ast.BinOp):\n"
            "            return _ops[type(node.op)](_ev(node.left), _ev(node.right))\n"
            "        if isinstance(node, ast.UnaryOp):\n"
            "            return _ops[type(node.op)](_ev(node.operand))\n"
            "        raise ValueError(\"unsupported expression\")\n"
            "\n"
            "    return str(_ev(ast.parse(expression, mode=\"eval\").body))"
        ),
        sample_args={"expression": "2 + 3 * 4"},
        expected="14",
    ),
    Template(
        key="web_search",
        keywords=("web search", "search the web", "search online", "google",
                  "look up", "search the internet", "find information online", "internet search"),
        description="Search the web and return a short text summary of results.",
        params=[ToolParam(name="query", type="string", description="the search query")],
        needs_sandbox=True,
        imports=("import json", "import urllib.parse", "import urllib.request"),
        body=(
            "    params = urllib.parse.urlencode({\"q\": query, \"format\": \"json\", \"no_html\": 1})\n"
            "    url = \"https://api.duckduckgo.com/?\" + params\n"
            "    req = urllib.request.Request(url, headers={\"User-Agent\": \"rl-scratch/0.1\"})\n"
            "    with urllib.request.urlopen(req, timeout=30) as resp:\n"
            "        data = json.loads(resp.read().decode(\"utf-8\", \"replace\"))\n"
            "    if data.get(\"AbstractText\"):\n"
            "        return data[\"AbstractText\"]\n"
            "    topics = [t.get(\"Text\", \"\") for t in data.get(\"RelatedTopics\", []) if t.get(\"Text\")]\n"
            "    return \"\\n\".join(topics[:5]) or \"No results.\""
        ),
    ),
    Template(
        key="http_get",
        keywords=("http get", "fetch url", "http request", "download", "fetch a url",
                  "get request", "retrieve a web page", "fetch the contents of a url"),
        description="Fetch the contents of a URL over HTTP GET and return the body text.",
        params=[ToolParam(name="url", type="string", description="the URL to fetch")],
        needs_sandbox=True,
        imports=("import urllib.request",),
        body=(
            "    req = urllib.request.Request(url, headers={\"User-Agent\": \"rl-scratch/0.1\"})\n"
            "    with urllib.request.urlopen(req, timeout=30) as resp:\n"
            "        return resp.read().decode(\"utf-8\", \"replace\")"
        ),
    ),
    Template(
        key="read_file",
        keywords=("read file", "read a file", "open file", "file contents",
                  "load file", "load a file", "get file contents"),
        description="Read a UTF-8 text file from the workspace and return its contents.",
        params=[ToolParam(name="path", type="string", description="path to the file")],
        needs_sandbox=True,
        imports=(),
        body=(
            "    with open(path, \"r\", encoding=\"utf-8\") as f:\n"
            "        return f.read()"
        ),
    ),
]


TEMPLATES_BY_KEY = {t.key: t for t in TEMPLATES}
