"""Guardrail: CUDA requirements file must track requirements.txt (see scripts/check_requirements_cuda_sync.py)."""

import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
SCRIPT = BACKEND / "scripts" / "check_requirements_cuda_sync.py"


def test_cuda_requirements_sync_script_exits_zero():
    assert SCRIPT.is_file(), f"missing {SCRIPT}"
    proc = subprocess.run(
        [sys.executable, str(SCRIPT)],
        cwd=BACKEND.parent,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr + proc.stdout
