import os
import select
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

from pomo_link.ipc import UnixCommandServer, send_command
from pomo_link.main import Engine
from pomo_link.persist import load_json


class UnixCommandServerTest(unittest.TestCase):
    def test_roundtrip(self):
        tmp = tempfile.TemporaryDirectory()
        path = os.path.join(tmp.name, "pomo.sock")
        server = UnixCommandServer(path)
        seen = []
        stop = threading.Event()

        def on_line(line):
            seen.append(line)
            return {"ok": True, "echo": line.strip()}

        def loop():
            while not stop.is_set():
                ready, _, _ = select.select(server.sockets(), [], [], 0.05)
                if ready:
                    server.pump(ready, on_line)

        thread = threading.Thread(target=loop, daemon=True)
        thread.start()
        try:
            result = send_command(path, {"cmd": "ping"})
            self.assertEqual(result["ok"], True)
            self.assertEqual(result["echo"], '{"cmd":"ping"}')
            self.assertEqual(len(seen), 1)
        finally:
            stop.set()
            thread.join(timeout=1)
            server.close()
            tmp.cleanup()


class EngineStatusFileTest(unittest.TestCase):
    def test_emit_writes_status_file(self):
        tmp = tempfile.TemporaryDirectory()
        try:
            status_path = os.path.join(tmp.name, "waybar.json")
            engine = Engine(
                directory=tmp.name,
                status_path=status_path,
                stdout_status=False,
            )
            engine.emit_status(force=True)
            data = load_json(status_path)
            self.assertEqual(data["type"], "status")
            self.assertIn(data["status"], ("stopped", "running", "paused"))
            self.assertFalse(data["has_token"])
        finally:
            tmp.cleanup()

    def test_toggle_offline_starts_local_timer(self):
        tmp = tempfile.TemporaryDirectory()
        try:
            engine = Engine(directory=tmp.name, stdout_status=False)
            engine.client.set_mode("OFFLINE")
            reply = engine.handle_line('{"cmd":"toggle"}')
            self.assertEqual(reply["status"], "running")
            self.assertEqual(reply["phase"], "work")
            self.assertGreater(reply["remaining"], 0)
        finally:
            tmp.cleanup()


if __name__ == "__main__":
    unittest.main()
