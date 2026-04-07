import hashlib
import hmac
import json

from fastapi import FastAPI, Header, HTTPException, Request

from .config import get_config
from .normalize import normalize_event
from .storage import append_event
from .trigger import evaluate_triggers, load_rules

app = FastAPI(title="Forge Webhook Monitor")

_config: dict | None = None
_trigger_rules: list[dict] | None = None


def _get_config() -> dict:
    global _config
    if _config is None:
        _config = get_config()
    return _config


def _get_trigger_rules() -> list[dict]:
    global _trigger_rules
    if _trigger_rules is None:
        config = _get_config()
        rules_file = config.get("trigger_rules_file", "")
        _trigger_rules = load_rules(rules_file) if rules_file else []
    return _trigger_rules


def _verify_signature(payload: bytes, signature: str | None, secret: str) -> None:
    if not signature:
        raise HTTPException(status_code=403, detail="Missing X-Hub-Signature-256 header")

    if not signature.startswith("sha256="):
        raise HTTPException(status_code=403, detail="Invalid signature format")

    expected = "sha256=" + hmac.new(
        secret.encode(), payload, hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=403, detail="Invalid signature")


@app.post("/webhook")
async def webhook(
    request: Request,
    x_hub_signature_256: str | None = Header(None),
    x_github_event: str | None = Header(None),
):
    config = _get_config()
    body = await request.body()

    _verify_signature(body, x_hub_signature_256, config["secret"])

    if not x_github_event:
        raise HTTPException(status_code=400, detail="Missing X-GitHub-Event header")

    payload = json.loads(body)
    event = normalize_event(x_github_event, payload)

    if event is None:
        return {"status": "ignored", "event": x_github_event}

    append_event(config["events_file"], event)

    rules = _get_trigger_rules()
    repo_dir = config.get("repo_dir", "")
    if rules and repo_dir:
        evaluate_triggers(event, rules, repo_dir)

    return {"status": "accepted", "event_type": event["event_type"]}


@app.get("/health")
async def health():
    return {"status": "ok"}


def run():
    import os
    import sys

    import uvicorn

    if not os.environ.get("_FORGE_WH_INVOKED"):
        print(
            "WARNING: 'forge-webhook' is deprecated. Use 'forge wh' instead.",
            file=sys.stderr,
        )

    config = _get_config()
    uvicorn.run(
        "forge_webhook.main:app",
        host="0.0.0.0",
        port=config["port"],
        log_level="info",
    )
