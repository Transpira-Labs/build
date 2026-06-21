"""SC-bench (SupChain-Bench, ACL 2026) as a DEPLOYABLE HUD v6 environment — the
golden held-out benchmark for bench-ception.

Ported from https://github.com/Damon-GSY/SC-bench (see SC-bench-LICENSE). The 8
supply-chain tools are served via an in-process MCP capability (the v6 way),
reimplemented on the stdlib csv module (no pandas). Tasks are the tool-use
questions; the grader checks the agent's answer against the structured answer key.

    hud deploy golden/sc_bench/            # build + push to the platform
    hud eval golden/sc_bench/tasks.py <model> --gateway   # run locally
"""

from __future__ import annotations

import ast
import asyncio
import contextlib
import csv
import json
import os
import re
import socket
from pathlib import Path

from hud import Environment
from hud.capabilities import Capability

DATA = Path(__file__).parent / "data"


def _load(name: str) -> list[dict]:
    with open(DATA / f"{name}.csv", newline="") as f:
        return list(csv.DictReader(f))


TRADE = _load("TradeOrders")
FULFILL = _load("FulfillmentOrders")
WARE = _load("WarehouseOrders")
ERRLOG = _load("ErrorLogs")
CANCEL = _load("CancellationContext")

env = Environment(name="sc-bench")


# --- helpers (ported from src/tool.py) -------------------------------------

def _parse_buyer(val):
    if val is None or val == "":
        return None
    for loader in (json.loads, ast.literal_eval):
        try:
            return loader(str(val).strip())
        except Exception:
            continue
    return val


def _map_status(raw) -> str:
    s = str(raw).strip().upper()
    if s in ("RECEIVING", "PICKING", "PACKING", "1"):
        return "packing_in_progress"
    if s in ("PACKED", "2"):
        return "packing_done"
    if s in ("SHIPPED", "DISPATCHED", "3"):
        return "dispatched"
    if s in ("IN_TRANSIT", "DELIVERING", "4"):
        return "in_transit"
    if s in ("DELIVERED", "5"):
        return "delivered"
    if s in ("ERROR", "FAIL", "9"):
        return "error"
    return "packing_in_progress"


def _cancel_row(fid: str):
    return next((r for r in CANCEL if r.get("entity_type") == "fulfillment_order"
                 and r.get("entity_id") == fid), None)


# --- the 8 agent-facing tools (async, for FastMCP) -------------------------

async def query_buyer_and_related(order_id: str) -> dict:
    """Given a trade_order_id, return buyer info and related fulfillment/warehouse order IDs."""
    trow = next((r for r in TRADE if r["trade_order_id"] == order_id), None)
    if not trow:
        return {"buyer_id": None, "related_item": []}
    fids = [r["fulfillment_order_id"] for r in FULFILL if r["trade_order_id"] == order_id]
    related = []
    for fid in fids:
        for w in WARE:
            if w["fulfillment_order_id"] == fid:
                related.append({"fulfillment_id": fid, "warehouse_order_id": w["warehouse_order_id"]})
    return {"buyer_id": _parse_buyer(trow.get("buyer_id")), "related_item": related}


async def get_fulfillment_status(fulfillment_id: str) -> dict:
    """Get aggregated business status for a fulfillment order."""
    frow = next((r for r in FULFILL if r["fulfillment_order_id"] == fulfillment_id), None)
    if frow:
        biz = str(frow.get("biz_status", "")).upper()
        if "CANCEL" in biz:
            return {"status": "cancelled"}
        if "ERROR" in biz:
            return {"status": "error"}
    mapped = [_map_status(w["status"]) for w in WARE if w["fulfillment_order_id"] == fulfillment_id]
    if any(s == "error" for s in mapped):
        return {"status": "error"}
    if any(s == "in_transit" for s in mapped):
        return {"status": "in_transit"}
    if any(s == "dispatched" for s in mapped):
        return {"status": "dispatched"}
    if mapped and all(s == "delivered" for s in mapped):
        return {"status": "delivered"}
    if any(s == "packing_done" for s in mapped) and not any(s == "packing_in_progress" for s in mapped):
        return {"status": "packing_done"}
    return {"status": "packing_in_progress"}


async def get_cancel_scenes(fulfillment_id: str) -> dict:
    """Get cancellation scene info (who initiated) for a fulfillment order."""
    r = _cancel_row(fulfillment_id)
    return {"cancelType": r.get("cancel_type")} if r else {"cancelType": None}


async def get_cancel_error_code(fulfillment_id: str) -> dict:
    """Get cancellation reason code and message for a fulfillment order."""
    r = _cancel_row(fulfillment_id)
    if not r:
        return {"cancelErrorCode": None, "cancelErrorMsg": None}
    return {"cancelErrorCode": r.get("reason_code"), "cancelErrorMsg": r.get("reason_text")}


async def get_error_reason(fulfillment_id: str) -> dict:
    """Get fulfillment-order-level error details (code, text)."""
    r = next((e for e in ERRLOG if e.get("entity_type") == "fulfillment_order"
              and e.get("fulfillment_order_id") == fulfillment_id), None)
    return {"code": r.get("code"), "text": r.get("text")} if r else {"code": None, "text": None}


async def check_fake_shipping(fulfillment_id: str) -> dict:
    """Check whether the fulfillment order is flagged for fake shipping."""
    for e in ERRLOG:
        if e.get("entity_type") == "fulfillment_order" and e.get("fulfillment_order_id") == fulfillment_id:
            code = str(e.get("code", "")).upper()
            text = str(e.get("text", "")).upper()
            if "FAKE_SHIP" in code or ("FAKE" in text and "SHIP" in text):
                return {"exceptionFlag": True}
    return {"exceptionFlag": False}


async def get_warehouse_status(fulfillment_id: str, warehouse_order_id: str) -> dict:
    """Get status and error code for a specific warehouse order under a fulfillment order."""
    r = next((w for w in WARE if w["warehouse_order_id"] == warehouse_order_id
              and w["fulfillment_order_id"] == fulfillment_id), None)
    if not r:
        return {"status": None, "error": None}
    return {"status": _map_status(r.get("status")), "error": r.get("error_code") or None}


async def get_warehouse_error_details(fulfillment_id: str, warehouse_order_id: str) -> dict:
    """Get error details (code, text) for a specific warehouse order (composite key)."""
    r = next((e for e in ERRLOG if e.get("entity_type") == "warehouse_order"
              and e.get("warehouse_order_id") == warehouse_order_id
              and e.get("fulfillment_order_id") == fulfillment_id), None)
    return {"code": r.get("code"), "text": r.get("text")} if r else {"code": None, "text": None}


_TOOLS = [query_buyer_and_related, get_fulfillment_status, get_cancel_scenes,
          get_cancel_error_code, get_error_reason, check_fake_shipping,
          get_warehouse_status, get_warehouse_error_details]


# --- in-process MCP capability serving the tools ---------------------------

_MCP_PORT = 0
_MCP_TASK: "asyncio.Task | None" = None


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


async def _listening(host: str, port: int, timeout: float = 10.0) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while loop.time() < deadline:
        try:
            socket.create_connection((host, port), timeout=0.2).close()
            return
        except OSError:
            await asyncio.sleep(0.1)
    raise RuntimeError(f"sc-bench tools MCP never came up on {host}:{port}")


@env.initialize
async def _up() -> None:
    from fastmcp import FastMCP

    global _MCP_PORT, _MCP_TASK
    if _MCP_TASK is None:
        server = FastMCP(name="sc-bench-tools")
        for fn in _TOOLS:
            server.tool(fn)
        _MCP_PORT = _free_port()
        _MCP_TASK = asyncio.create_task(
            server.run_async(transport="http", host="127.0.0.1", port=_MCP_PORT, show_banner=False)
        )
        await _listening("127.0.0.1", _MCP_PORT)
    env.add_capability(Capability.mcp(name="sc-bench-tools", url=f"http://127.0.0.1:{_MCP_PORT}/mcp"))


@env.shutdown
async def _down() -> None:
    global _MCP_TASK
    if _MCP_TASK is not None:
        _MCP_TASK.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _MCP_TASK
        _MCP_TASK = None


# --- tasks + grader --------------------------------------------------------

_QUESTIONS = [json.loads(l) for l in (DATA / "tool_use_question.jsonl").read_text().splitlines() if l.strip()]
_ANSWERS = [json.loads(l) for l in (DATA / "tool_use_answers.jsonl").read_text().splitlines() if l.strip()]

_STOP = {"the", "a", "an", "and", "or", "but", "because", "had", "has", "have", "was",
         "were", "for", "with", "that", "this", "their", "they", "from", "into", "been",
         "order", "buyer", "customer", "received", "reorder", "proper", "could", "choice"}


def _flatten(ans):
    items = ans if isinstance(ans, list) else [ans]
    statuses, reasons = [], []
    for it in items:
        for fo in (it.get("fulfillments") or []):
            if fo.get("reason_text"):
                reasons.append(fo["reason_text"])
            for wo in (fo.get("warehouse_orders") or []):
                if wo.get("status"):
                    statuses.append(wo["status"])
    return statuses, reasons


def _grade(answer: str, statuses: list[str], reasons: list[str]) -> float:
    text = (answer or "").lower()
    comps = []
    if statuses:
        hit = sum(1 for s in statuses if s.lower() in text or s.replace("_", " ").lower() in text)
        comps.append(hit / len(statuses))
    if reasons:
        per = []
        for r in reasons:
            toks = {w for w in re.findall(r"[a-z]{4,}", r.lower()) if w not in _STOP}
            if not toks:
                per.append(1.0)
                continue
            present = sum(1 for w in toks if w in text)
            per.append(min(1.0, present / max(3, len(toks) * 0.4)))
        comps.append(sum(per) / len(per))
    return round(sum(comps) / len(comps), 4) if comps else 0.0


@env.template(id="tool_use")
async def tool_use(idx: int = 0):
    statuses, reasons = _flatten(_ANSWERS[idx])
    answer = yield _QUESTIONS[idx]["question"]
    yield _grade(answer, statuses, reasons)
