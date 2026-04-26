#!/usr/bin/env python3
"""
Verify backend/requirements-docker-cuda.txt stays aligned with backend/requirements.txt.

Production GPU images install only requirements-docker-cuda.txt (torch/torchvision come from
Dockerfile.cuda). A missing dependency there causes import failures at startup (e.g. pillow-heif).

Run from repo root: python backend/scripts/check_requirements_cuda_sync.py
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from packaging.requirements import Requirement
except ImportError:  # pragma: no cover
    print("ERROR: install packaging (bundled with pip): pip install packaging", file=sys.stderr)
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
REQ = ROOT / "requirements.txt"
CUDA = ROOT / "requirements-docker-cuda.txt"

# Installed in Dockerfile.cuda from the PyTorch CUDA wheel index, not requirements-docker-cuda.txt
SKIP = frozenset({"torch", "torchvision"})


def _norm(name: str) -> str:
    return name.strip().lower().replace("_", "-")


def _packages(path: Path) -> set[str]:
    out: set[str] = set()
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("-"):
            continue
        try:
            req = Requirement(line)
            out.add(_norm(req.name))
        except Exception as exc:  # noqa: BLE001 — surface bad lines
            print(f"ERROR: cannot parse requirement in {path.name}: {raw!r} ({exc})", file=sys.stderr)
            raise SystemExit(2) from exc
    return out


def main() -> int:
    req = _packages(REQ) - SKIP
    cuda = _packages(CUDA)
    missing = sorted(req - cuda)
    if missing:
        print(
            "ERROR: requirements-docker-cuda.txt is missing packages that exist in requirements.txt:",
            file=sys.stderr,
        )
        for name in missing:
            print(f"  - {name}", file=sys.stderr)
        print(
            "\nAdd them to backend/requirements-docker-cuda.txt (keep pins in sync where applicable).",
            file=sys.stderr,
        )
        print(
            "torch and torchvision are omitted on purpose — Dockerfile.cuda installs them from the CUDA index.",
            file=sys.stderr,
        )
        return 1

    extra = sorted((cuda - req) - SKIP)
    if extra:
        print(
            "WARNING: requirements-docker-cuda.txt lists packages not present in requirements.txt: "
            + ", ".join(extra),
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
