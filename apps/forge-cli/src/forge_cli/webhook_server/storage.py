import json
import os
import tempfile
from pathlib import Path

MAX_EVENTS = 500


def append_event(events_file: str, event: dict) -> None:
    path = Path(events_file)
    path.parent.mkdir(parents=True, exist_ok=True)

    lines: list[str] = []
    if path.exists():
        with open(path) as f:
            lines = f.readlines()

    lines.append(json.dumps(event) + "\n")

    if len(lines) > MAX_EVENTS:
        lines = lines[-MAX_EVENTS:]

    dir_path = path.parent
    fd, tmp_path = tempfile.mkstemp(dir=dir_path, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as tmp:
            tmp.writelines(lines)
        os.replace(tmp_path, path)
    except Exception:
        os.unlink(tmp_path)
        raise
