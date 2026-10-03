import socket
import tempfile
import unittest
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


if __name__ == "__main__":
    unittest.main()
