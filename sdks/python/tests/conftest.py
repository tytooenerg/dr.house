"""Spawns the real Lastro server (the actual TypeScript/Express app, via tsx — same code
that runs in production) as a subprocess on an ephemeral port, for real end-to-end tests.
Not a mocked-HTTP test suite: if the SDK's request shapes ever drift from what
routes/v1.ts actually expects, these tests fail for real.
"""

import json
import os
import socket
import subprocess
import time
import urllib.request
from pathlib import Path

import pytest

SDKS_PYTHON_DIR = Path(__file__).resolve().parents[1]
SERVER_DIR = SDKS_PYTHON_DIR.parent.parent / "server"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_health(base_url: str, timeout_s: float = 20.0) -> None:
    deadline = time.time() + timeout_s
    last_err = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{base_url}/api/health", timeout=1) as resp:
                if resp.status == 200:
                    return
        except Exception as exc:  # noqa: BLE001 - keep polling until timeout
            last_err = exc
        time.sleep(0.3)
    raise RuntimeError(f"Lastro server never became healthy at {base_url}: {last_err}")


@pytest.fixture(scope="session")
def base_url():
    port = _free_port()
    env = {
        **os.environ,
        "DB_PATH": ":memory:",
        "JWT_SECRET": "python-sdk-test-secret",
        "PORT": str(port),
        "CORS_ORIGINS": "http://localhost:5173",
    }
    proc = subprocess.Popen(
        ["npx", "tsx", "src/index.ts"],
        cwd=str(SERVER_DIR),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        _wait_for_health(url)
        yield f"{url}/api/v1"
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def register_and_generate_key(internal_base_url: str, role: str, unique: str) -> str:
    """internal_base_url is the plain http://host:port, without /api/v1."""
    email = f"{role}-py-{unique}@example.com"
    body = {"nome": "Python SDK Test", "email": email, "password": "senha123", "companyName": f"{role} PY {unique}", "role": role}
    if role == "seguradora":
        body["insurerKey"] = "too"
    req = urllib.request.Request(
        f"{internal_base_url}/api/auth/register",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        reg = json.loads(resp.read())
    token = reg["token"]

    key_req = urllib.request.Request(
        f"{internal_base_url}/api/dev/keys/generate",
        data=json.dumps({"mode": "test"}).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    with urllib.request.urlopen(key_req, timeout=10) as resp:
        key_data = json.loads(resp.read())
    return key_data["rawKey"]
