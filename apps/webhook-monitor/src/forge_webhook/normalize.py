from datetime import datetime, timezone


SUPPORTED_EVENTS = {"issues", "pull_request", "issue_comment", "pull_request_review"}

EVENT_TYPE_MAP = {
    "issues": "issue",
    "pull_request": "pr",
    "issue_comment": "comment",
    "pull_request_review": "review",
}


def normalize_event(event_name: str, payload: dict) -> dict | None:
    if event_name not in SUPPORTED_EVENTS:
        return None

    action = payload.get("action", "unknown")
    prefix = EVENT_TYPE_MAP[event_name]
    event_type = f"{prefix}.{action}"

    repo = payload.get("repository", {}).get("full_name", "unknown")
    actor = payload.get("sender", {}).get("login", "unknown")

    number, labels, summary = _extract_details(event_name, action, payload)

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event_type": event_type,
        "repo": repo,
        "number": number,
        "actor": actor,
        "summary": summary,
        "raw_action": action,
        "labels": labels,
    }


def _extract_details(event_name: str, action: str, payload: dict) -> tuple[int | None, list[str], str]:
    if event_name == "issues":
        issue = payload.get("issue", {})
        number = issue.get("number")
        labels = [l.get("name", "") for l in issue.get("labels", [])]
        title = issue.get("title", "")
        summary = f"Issue #{number} {action}: {title}"
        return number, labels, summary

    if event_name == "pull_request":
        pr = payload.get("pull_request", {})
        number = pr.get("number")
        labels = [l.get("name", "") for l in pr.get("labels", [])]
        title = pr.get("title", "")
        merged = pr.get("merged", False)
        if action == "closed" and merged:
            summary = f"PR #{number} merged: {title}"
        else:
            summary = f"PR #{number} {action}: {title}"
        return number, labels, summary

    if event_name == "issue_comment":
        issue = payload.get("issue", {})
        number = issue.get("number")
        labels = [l.get("name", "") for l in issue.get("labels", [])]
        comment = payload.get("comment", {})
        author = comment.get("user", {}).get("login", "unknown")
        is_pr = "pull_request" in issue
        kind = "PR" if is_pr else "Issue"
        summary = f"{author} commented on {kind} #{number}"
        return number, labels, summary

    if event_name == "pull_request_review":
        pr = payload.get("pull_request", {})
        number = pr.get("number")
        labels = [l.get("name", "") for l in pr.get("labels", [])]
        review = payload.get("review", {})
        reviewer = review.get("user", {}).get("login", "unknown")
        state = review.get("state", "unknown")
        summary = f"{reviewer} reviewed PR #{number}: {state}"
        return number, labels, summary

    return None, [], f"{event_name}.{action}"
