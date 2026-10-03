import socket
import tempfile
import unittest
from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import launcher


class ResourcePathTests(unittest.TestCase):
    def test_uses_launcher_directory_from_source(self):
        with patch.object(launcher, "__file__", r"C:\app\launcher.py"), patch.object(
            launcher.sys, "_MEIPASS", None, create=True
        ):
            self.assertEqual(launcher.resource_path("frontend/index.html"),
                             Path(r"C:\app") / "frontend" / "index.html")

    def test_uses_pyinstaller_bundle_root_when_frozen(self):
        with tempfile.TemporaryDirectory() as bundle_dir:
            with patch.object(launcher.sys, "_MEIPASS", bundle_dir, create=True):
                self.assertEqual(launcher.resource_path("frontend/index.html"),
                                 Path(bundle_dir) / "frontend" / "index.html")


class PortCheckTests(unittest.TestCase):
    def test_raises_actionable_error_for_occupied_port(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as occupied:
            occupied.bind(("127.0.0.1", 0))
            occupied.listen()
            port = occupied.getsockname()[1]
            with self.assertRaisesRegex(launcher.LauncherError, "already in use"):
                launcher.check_port_available(port)

    def test_accepts_an_available_port(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        launcher.check_port_available(port)


class StartupErrorTests(unittest.TestCase):
    def test_occupied_port_shows_actionable_dialog(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as occupied:
            occupied.bind(("127.0.0.1", 0))
            occupied.listen()
            port = occupied.getsockname()[1]
            stderr = StringIO()
            with patch.object(launcher, "_parse_args", return_value=launcher.argparse.Namespace(
                port=port, no_browser=True
            )), patch.object(launcher.sys, "frozen", True, create=True), \
                 patch.object(launcher.sys, "platform", "win32"), \
                 patch.object(launcher.ctypes, "windll", create=True) as windll, \
                 redirect_stderr(stderr):
                self.assertEqual(launcher.main(), 1)

            dialog_message = windll.user32.MessageBoxW.call_args.args[1]
            self.assertIn(f"Port {port} is already in use", dialog_message)
            self.assertIn("Launcher error:", stderr.getvalue())

    def test_unexpected_exception_shows_safe_dialog_and_traceback(self):
        stderr = StringIO()
        with patch.object(launcher, "run", side_effect=RuntimeError("private diagnostic")), \
             patch.object(launcher.sys, "frozen", True, create=True), \
             patch.object(launcher.sys, "platform", "win32"), \
             patch.object(launcher.ctypes, "windll", create=True) as windll, \
             redirect_stderr(stderr):
            self.assertEqual(launcher.main(), 1)

        dialog_message = windll.user32.MessageBoxW.call_args.args[1]
        self.assertIn("unexpected error", dialog_message)
        self.assertNotIn("private diagnostic", dialog_message)
        self.assertIn("Traceback", stderr.getvalue())
        self.assertIn("private diagnostic", stderr.getvalue())

    def test_source_mode_does_not_show_windows_dialog(self):
        with patch.object(launcher, "run", side_effect=launcher.LauncherError("startup failure")), \
             patch.object(launcher.sys, "frozen", False, create=True), \
             patch.object(launcher, "_show_startup_error") as show_error, \
             redirect_stderr(StringIO()):
            self.assertEqual(launcher.main(), 1)

        show_error.assert_called_once()

    def test_dialog_path_is_noop_outside_frozen_windows(self):
        with patch.object(launcher.sys, "frozen", True, create=True), \
             patch.object(launcher.sys, "platform", "linux"), \
             patch.object(launcher.ctypes, "windll", create=True) as windll:
            launcher._show_startup_error("failure")
        windll.user32.MessageBoxW.assert_not_called()


if __name__ == "__main__":
    unittest.main()
