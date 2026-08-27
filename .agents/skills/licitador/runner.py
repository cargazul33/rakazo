#!/usr/bin/env python3
"""Persistent, resumable state runner for the LICITADOR agent.

Standard-library only. Designed to survive model/worker/browser restarts by
committing every phase transition atomically to disk.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PHASES = [
    "DETECTAR",
    "DESCARGAR",
    "EXTRAER",
    "COTIZAR_AR",
    "COTIZAR_PY",
    "COMPARAR",
    "PRECIO",
    "AUDITAR",
    "LISTA_FIRMAR",
    "COMPLETO",
]

DEFAULT_HOME = Path(os.environ.get("LICITADOR_HOME", "/home/rakazo/licitador"))


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")[:48] or "licitacion"


class Store:
    def __init__(self, root: Path):
        self.root = root
        self.state_path = root / "state.json"
        self.jobs_dir = root / "jobs"
        self.lock_path = root / ".lock"
        self.root.mkdir(parents=True, exist_ok=True)
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        self.lock_path.touch(exist_ok=True)

    def _default_state(self) -> dict[str, Any]:
        return {
            "version": 1,
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "current_job_id": None,
            "jobs": {},
        }

    def load(self) -> dict[str, Any]:
        if not self.state_path.exists():
            state = self._default_state()
            self.save(state)
            return state
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise SystemExit(f"ERROR: state.json inválido: {exc}")
        if not isinstance(data, dict):
            raise SystemExit("ERROR: state.json debe ser un objeto JSON")
        data.setdefault("version", 1)
        data.setdefault("jobs", {})
        data.setdefault("current_job_id", None)
        return data

    def save(self, state: dict[str, Any]) -> None:
        state["updated_at"] = now_iso()
        self.root.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(prefix="state-", suffix=".json", dir=self.root)
        tmp_path = Path(tmp_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(state, handle, ensure_ascii=False, indent=2, sort_keys=True)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_path, self.state_path)
        finally:
            if tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

    def locked(self):
        return open(self.lock_path, "r+")

    def job_dir(self, job_id: str) -> Path:
        return self.jobs_dir / job_id

    def current_job(self, state: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        job_id = state.get("current_job_id")
        if not job_id:
            raise SystemExit("ERROR: no hay job actual. Usá new-job primero.")
        job = state.get("jobs", {}).get(job_id)
        if not isinstance(job, dict):
            raise SystemExit(f"ERROR: job actual {job_id!r} no existe en state.json")
        return job_id, job


def ensure_job_layout(store: Store, job_id: str) -> Path:
    job_dir = store.job_dir(job_id)
    for name in ("docs", "evidence", "working", "output"):
        (job_dir / name).mkdir(parents=True, exist_ok=True)
    return job_dir


def write_checkpoint(store: Store, job_id: str, job: dict[str, Any]) -> None:
    job_dir = ensure_job_layout(store, job_id)
    checkpoint = {
        "job_id": job_id,
        "phase": job.get("phase"),
        "blocked": job.get("blocked", False),
        "block_reason": job.get("block_reason"),
        "updated_at": now_iso(),
        "source": job.get("source"),
        "title": job.get("title"),
        "url": job.get("url"),
        "fields": job.get("fields", {}),
        "evidence": job.get("evidence", []),
        "completed_phases": job.get("completed_phases", []),
    }
    path = job_dir / "checkpoint.json"
    tmp = job_dir / ".checkpoint.json.tmp"
    tmp.write_text(json.dumps(checkpoint, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def cmd_init(store: Store, _args: argparse.Namespace) -> None:
    with store.locked() as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = store.load()
        store.save(state)
    print(json.dumps({"ok": True, "home": str(store.root), "state": str(store.state_path)}, ensure_ascii=False))


def cmd_status(store: Store, _args: argparse.Namespace) -> None:
    state = store.load()
    job_id = state.get("current_job_id")
    if not job_id:
        print(json.dumps({"ok": True, "current_job_id": None, "next": "DETECTAR"}, ensure_ascii=False, indent=2))
        return
    job = state.get("jobs", {}).get(job_id, {})
    payload = {
        "ok": True,
        "current_job_id": job_id,
        "phase": job.get("phase"),
        "blocked": job.get("blocked", False),
        "block_reason": job.get("block_reason"),
        "title": job.get("title"),
        "source": job.get("source"),
        "url": job.get("url"),
        "job_dir": str(store.job_dir(job_id)),
        "completed_phases": job.get("completed_phases", []),
        "updated_at": job.get("updated_at"),
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def cmd_new_job(store: Store, args: argparse.Namespace) -> None:
    with store.locked() as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = store.load()
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        job_id = args.job_id or f"{stamp}-{slugify(args.title or args.source)}"
        if job_id in state["jobs"]:
            raise SystemExit(f"ERROR: ya existe job {job_id}")
        job = {
            "id": job_id,
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "source": args.source,
            "title": args.title,
            "url": args.url,
            "phase": "DETECTAR",
            "blocked": False,
            "block_reason": None,
            "fields": {},
            "evidence": [],
            "completed_phases": [],
        }
        state["jobs"][job_id] = job
        state["current_job_id"] = job_id
        ensure_job_layout(store, job_id)
        write_checkpoint(store, job_id, job)
        store.save(state)
    print(json.dumps({"ok": True, "job_id": job_id, "phase": "DETECTAR", "job_dir": str(store.job_dir(job_id))}, ensure_ascii=False))


def parse_value(raw: str) -> Any:
    try:
        return json.loads(raw)
    except Exception:
        return raw


def cmd_set(store: Store, args: argparse.Namespace) -> None:
    with store.locked() as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = store.load()
        job_id, job = store.current_job(state)
        job.setdefault("fields", {})[args.key] = parse_value(args.value)
        job["updated_at"] = now_iso()
        write_checkpoint(store, job_id, job)
        store.save(state)
    print(json.dumps({"ok": True, "job_id": job_id, "key": args.key, "value": job["fields"][args.key]}, ensure_ascii=False))


def cmd_add_evidence(store: Store, args: argparse.Namespace) -> None:
    with store.locked() as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = store.load()
        job_id, job = store.current_job(state)
        item = {
            "type": args.type,
            "path": args.path,
            "url": args.url,
            "note": args.note,
            "added_at": now_iso(),
        }
        job.setdefault("evidence", []).append(item)
        job["updated_at"] = now_iso()
        write_checkpoint(store, job_id, job)
        store.save(state)
    print(json.dumps({"ok": True, "job_id": job_id, "evidence_count": len(job["evidence"])}, ensure_ascii=False))


def next_phase(phase: str) -> str:
    try:
        idx = PHASES.index(phase)
    except ValueError:
        raise SystemExit(f"ERROR: fase desconocida {phase!r}")
    return PHASES[min(idx + 1, len(PHASES) - 1)]


def cmd_complete_phase(store: Store, args: argparse.Namespace) -> None:
    with store.locked() as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = store.load()
        job_id, job = store.current_job(state)
        if job.get("blocked"):
            raise SystemExit(f"ERROR: job bloqueado: {job.get('block_reason')}. Usá unblock primero.")
        phase = job.get("phase", "DETECTAR")
        if phase == "COMPLETO":
            print(json.dumps({"ok": True, "job_id": job_id, "phase": "COMPLETO", "message": "job ya completo"}, ensure_ascii=False))
            return
        completed = {
            "phase": phase,
            "completed_at": now_iso(),
            "summary": args.summary,
        }
        job.setdefault("completed_phases", []).append(completed)
        job["phase"] = next_phase(phase)
        job["updated_at"] = now_iso()
        write_checkpoint(store, job_id, job)
        store.save(state)
    print(json.dumps({"ok": True, "job_id": job_id, "completed": phase, "next_phase": job["phase"]}, ensure_ascii=False))


def cmd_block(store: Store, args: argparse.Namespace) -> None:
    with store.locked() as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = store.load()
        job_id, job = store.current_job(state)
        job["blocked"] = True
        job["block_reason"] = args.reason
        job["blocked_at"] = now_iso()
        job["updated_at"] = now_iso()
        write_checkpoint(store, job_id, job)
        store.save(state)
    print(json.dumps({"ok": True, "job_id": job_id, "blocked": True, "reason": args.reason}, ensure_ascii=False))


def cmd_unblock(store: Store, _args: argparse.Namespace) -> None:
    with store.locked() as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = store.load()
        job_id, job = store.current_job(state)
        job["blocked"] = False
        job["block_reason"] = None
        job["unblocked_at"] = now_iso()
        job["updated_at"] = now_iso()
        write_checkpoint(store, job_id, job)
        store.save(state)
    print(json.dumps({"ok": True, "job_id": job_id, "blocked": False, "phase": job.get("phase")}, ensure_ascii=False))


def cmd_resume(store: Store, _args: argparse.Namespace) -> None:
    state = store.load()
    job_id, job = store.current_job(state)
    print(json.dumps({
        "ok": True,
        "job_id": job_id,
        "phase": job.get("phase"),
        "blocked": job.get("blocked", False),
        "block_reason": job.get("block_reason"),
        "job_dir": str(store.job_dir(job_id)),
        "instruction": "Ejecutar solamente la fase indicada y persistir evidencia antes de complete-phase.",
    }, ensure_ascii=False, indent=2))


def cmd_list_jobs(store: Store, _args: argparse.Namespace) -> None:
    state = store.load()
    jobs = []
    for job_id, job in state.get("jobs", {}).items():
        jobs.append({
            "job_id": job_id,
            "title": job.get("title"),
            "source": job.get("source"),
            "phase": job.get("phase"),
            "blocked": job.get("blocked", False),
            "updated_at": job.get("updated_at"),
            "current": job_id == state.get("current_job_id"),
        })
    jobs.sort(key=lambda row: row.get("updated_at") or "", reverse=True)
    print(json.dumps({"ok": True, "jobs": jobs}, ensure_ascii=False, indent=2))


def cmd_select_job(store: Store, args: argparse.Namespace) -> None:
    with store.locked() as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        state = store.load()
        if args.job_id not in state.get("jobs", {}):
            raise SystemExit(f"ERROR: job {args.job_id!r} no existe")
        state["current_job_id"] = args.job_id
        store.save(state)
    print(json.dumps({"ok": True, "current_job_id": args.job_id}, ensure_ascii=False))


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="LICITADOR persistent runner")
    p.add_argument("--home", default=str(DEFAULT_HOME), help="Directorio persistente de LICITADOR")
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("init")
    sub.add_parser("status")
    sub.add_parser("resume")
    sub.add_parser("list-jobs")

    new = sub.add_parser("new-job")
    new.add_argument("--source", required=True)
    new.add_argument("--title", default="")
    new.add_argument("--url", default="")
    new.add_argument("--job-id", default="")

    setp = sub.add_parser("set")
    setp.add_argument("key")
    setp.add_argument("value")

    ev = sub.add_parser("add-evidence")
    ev.add_argument("--type", required=True)
    ev.add_argument("--path", default="")
    ev.add_argument("--url", default="")
    ev.add_argument("--note", default="")

    done = sub.add_parser("complete-phase")
    done.add_argument("--summary", default="")

    block = sub.add_parser("block")
    block.add_argument("--reason", required=True)

    sub.add_parser("unblock")

    sel = sub.add_parser("select-job")
    sel.add_argument("job_id")

    return p


def main() -> int:
    args = parser().parse_args()
    store = Store(Path(args.home))
    commands = {
        "init": cmd_init,
        "status": cmd_status,
        "new-job": cmd_new_job,
        "set": cmd_set,
        "add-evidence": cmd_add_evidence,
        "complete-phase": cmd_complete_phase,
        "block": cmd_block,
        "unblock": cmd_unblock,
        "resume": cmd_resume,
        "list-jobs": cmd_list_jobs,
        "select-job": cmd_select_job,
    }
    commands[args.command](store, args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
