"""Windows desktop launcher for the locally hosted geometry-learning app."""
from __future__ import annotations

import argparse
import os
import signal
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

import uvicorn
import main as app_module


DEFAULT_PORT = 8000
STARTUP_TIMEOUT_SECONDS = 30.0


class LauncherError(RuntimeError):
    """An actionable launcher startup error."""


def resource_path(relative_path: str) -> Path:
    """Resolve a bundled resource from source or a PyInstaller distribution."""
    bundle_root = getattr(sys, "_MEIPASS", None)
    root = Path(bundle_root) if bundle_root else Path(__file__).resolve().parent
    return root / relative_path


def check_port_available(port: int, host: str = "127.0.0.1") -> None:
    """Raise a clear error if the local address cannot be bound."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind((host, port))
        except OSError as exc:
            raise LauncherError(
                f"Port {port} is already in use or unavailable on {host}. "
                "Close the other app or start this launcher with --port <number>."
            ) from exc


def _wait_for_startup(server: uvicorn.Server, thread: threading.Thread, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if server.started:
            return
        if not thread.is_alive():
            raise LauncherError("The local web server stopped before it was ready.")
        time.sleep(0.1)
    server.should_exit = True
    thread.join(timeout=5)
    raise LauncherError(f"The local web server did not start within {timeout:.0f} seconds.")


def _health_check(url: str) -> bool:
    try:
        with urlopen(url, timeout=1) as response:
            return response.status == 200
    except (URLError, TimeoutError, OSError):
        return False


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start geometry-learning-app locally.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Local HTTP port (default: 8000).")
    parser.add_argument("--no-browser", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535.")
    return args


def _handle_ctrl_break(_signum: int, _frame: object) -> None:
    raise KeyboardInterrupt


def run(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    frontend_index = resource_path("frontend/index.html")
    if not frontend_index.is_file():
        raise LauncherError(f"Packaged frontend is missing: {frontend_index}")

    check_port_available(args.port)
    os.environ.pop("AUTO_SHUTDOWN", None)
    sigbreak = getattr(signal, "SIGBREAK", None)
    if sigbreak is not None:
        signal.signal(sigbreak, _handle_ctrl_break)
    url = f"http://127.0.0.1:{args.port}"
    config = uvicorn.Config(app_module.app, host="127.0.0.1", port=args.port, log_level="info")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, name="geometry-learning-server", daemon=True)
    thread.start()

    try:
        _wait_for_startup(server, thread, STARTUP_TIMEOUT_SECONDS)
        if not _health_check(f"{url}/api/health"):
            raise LauncherError("The local web server started but its health check failed.")
        print(f"Geometry Learning App is running at {url}")
        print("Keep this window open. Press Ctrl+C here to stop the server.")
        if not args.no_browser:
            webbrowser.open(url)
        while thread.is_alive():
            thread.join(timeout=0.25)
        if server.should_exit:
            return 0
        raise LauncherError("The local web server stopped unexpectedly.")
    except KeyboardInterrupt:
        print("\nStopping the local web server...")
        return 0
    finally:
        server.should_exit = True
        if thread.is_alive():
            thread.join(timeout=30)
        if thread.is_alive():
            print("Warning: the server did not stop within 30 seconds.", file=sys.stderr)


def main() -> int:
    try:
        return run()
    except LauncherError as exc:
        print(f"Launcher error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
