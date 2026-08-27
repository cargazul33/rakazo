#!/usr/bin/env python3
"""Cheap pull worker for the Rakazo serverless control plane.

Runs on any Linux VPS/PC. It claims one persistent job at a time and delegates
execution to EXECUTOR_COMMAND. The executor receives the job JSON on stdin and
may return a JSON object on stdout.
"""

from __future__ import annotations

import json
import os
import shlex
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from typing import Any

CONTROL_PLANE_URL = os.environ.get("CONTROL_PLANE_URL", "").rstrip("/")
WORKER_TOKEN = os.environ.get("WORKER_TOKEN", "")
WORKER_ID = os.environ.get("WORKER_ID", socket.gethostname())
WORKER_NAME = os.environ.get("WORKER_NAME", WORKER_ID)
CAPABILITIES = [x.strip() for x in os.environ.get("WORKER_CAPABILITIES", "research,documents,analysis,calculation,audit").split(",") if x.strip()]
EXECUTOR_COMMAND = os.environ.get("EXECUTOR_COMMAND", "").strip()
POLL_SECONDS = max(2, int(os.environ.get("POLL_SECONDS", "8")))
LEASE_SECONDS = min(3600, max(60, int(os.environ.get("LEASE_SECONDS", "900"))))
TASK_TIMEOUT_SECONDS = max(60, int(os.environ.get("TASK_TIMEOUT_SECONDS", "1800")))

stopping = False


def stop(*_: Any) -> None:
    global stopping
    stopping = True


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)


def request(path: str, method: str = "GET", payload: Any | None = None) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        CONTROL_PLANE_URL + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {WORKER_TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "rakazo-edge-worker/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {body}") from exc


def heartbeat() -> None:
    request(
        "/api/workers/heartbeat",
        "POST",
        {
            "workerId": WORKER_ID,
            "name": WORKER_NAME,
            "capabilities": CAPABILITIES,
            "metadata": {
                "host": socket.gethostname(),
                "pid": os.getpid(),
                "executor": EXECUTOR_COMMAND or None,
            },
        },
    )


def claim() -> dict[str, Any] | None:
    response = request(
        "/api/jobs/claim",
        "POST",
        {
            "workerId": WORKER_ID,
            "capabilities": CAPABILITIES,
            "leaseSeconds": LEASE_SECONDS,
        },
    )
    job = response.get("job")
    return job if isinstance(job, dict) else None


def complete(job_id: str, output: dict[str, Any]) -> None:
    result = output.get("result", output)
    stage = output.get("stage", "LISTA PARA FIRMAR")
    request(
        f"/api/jobs/{job_id}/complete",
        "POST",
        {"workerId": WORKER_ID, "stage": stage, "result": result},
    )


def fail(job_id: str, message: str, retry: bool = True) -> None:
    request(
        f"/api/jobs/{job_id}/fail",
        "POST",
        {"workerId": WORKER_ID, "error": message[-4000:], "retry": retry},
    )


def execute(job: dict[str, Any]) -> None:
    job_id = str(job["id"])
    command = shlex.split(EXECUTOR_COMMAND)
    env = os.environ.copy()
    env.update(
        {
            "ARMY_JOB_ID": job_id,
            "ARMY_WORKER_ID": WORKER_ID,
            "ARMY_CONTROL_PLANE_URL": CONTROL_PLANE_URL,
            "ARMY_WORKER_TOKEN": WORKER_TOKEN,
            "ARMY_CHECKPOINT_URL": f"{CONTROL_PLANE_URL}/api/jobs/{job_id}/checkpoint",
        }
    )
    print(f"[{WORKER_ID}] running {job_id}: {job.get('title')}", flush=True)
    try:
        proc = subprocess.run(
            command,
            input=json.dumps(job, ensure_ascii=False),
            text=True,
            capture_output=True,
            timeout=TASK_TIMEOUT_SECONDS,
            env=env,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        fail(job_id, f"executor timeout after {TASK_TIMEOUT_SECONDS}s: {exc}", retry=True)
        return
    except Exception as exc:  # noqa: BLE001
        fail(job_id, f"executor start failure: {exc}", retry=True)
        return

    if proc.returncode != 0:
        message = (proc.stderr or proc.stdout or f"executor exited {proc.returncode}").strip()
        fail(job_id, message, retry=True)
        return

    stdout = proc.stdout.strip()
    if not stdout:
        output: dict[str, Any] = {"result": {"ok": True, "message": "executor completed without JSON output"}}
    else:
        try:
            parsed = json.loads(stdout)
            output = parsed if isinstance(parsed, dict) else {"result": {"output": parsed}}
        except json.JSONDecodeError:
            output = {"result": {"output": stdout}}
    complete(job_id, output)


def main() -> int:
    if not CONTROL_PLANE_URL or not WORKER_TOKEN:
        print("CONTROL_PLANE_URL and WORKER_TOKEN are required", file=sys.stderr)
        return 2
    if not EXECUTOR_COMMAND:
        print("EXECUTOR_COMMAND is empty: worker will heartbeat but will not claim jobs", flush=True)

    failures = 0
    while not stopping:
        try:
            heartbeat()
            failures = 0
            if EXECUTOR_COMMAND:
                job = claim()
                if job:
                    execute(job)
                    continue
            time.sleep(POLL_SECONDS)
        except Exception as exc:  # noqa: BLE001
            failures += 1
            wait = min(60, POLL_SECONDS * max(1, failures))
            print(f"worker error: {exc}; retrying in {wait}s", file=sys.stderr, flush=True)
            time.sleep(wait)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
