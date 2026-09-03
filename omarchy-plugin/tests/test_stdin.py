import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

from pomo_link.main import Engine


class FakeStdin:
    def __init__(self, fd):
        self._fd = fd
        self.closed = False

    def fileno(self):
        return self._fd

    def close(self):
        self.closed = True


class StubWS:
    connected = False
    sock = None

    def connect(self, *args, **kwargs):
        raise OSError("no network in test")

    def close(self):
        pass

    def send_text(self, text):
        pass

    def recv_ready(self, timeout=0.0):
        return False


class StubRest:
    def __init__(self, results=None):
        self.results = list(results or [])
        self.calls = []

    def configure(self, *args):
        pass

    def request(self, method, path, **kwargs):
        self.calls.append((method, path))
        if self.results:
            return self.results.pop(0)
        return 0, ""

    def get_status(self, **kwargs):
        return self.request("GET", "/api/status")

    def get_config(self):
        return self.request("GET", "/api/config")

    def post(self, path, body=None, **kwargs):
        return self.request("POST", path)


class StdinDrainTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="pomo-stdin-")
        self._orig_stdin = sys.stdin
        self.read_fd, self.write_fd = os.pipe()
        sys.stdin = FakeStdin(self.read_fd)

    def tearDown(self):
        sys.stdin = self._orig_stdin
        os.close(self.read_fd)
        if self.write_fd is not None:
            os.close(self.write_fd)
        shutil.rmtree(self.dir, ignore_errors=True)

    def _engine(self):
        return Engine(directory=self.dir)

    def test_two_lines_in_one_read_both_process(self):
        engine = self._engine()
        seen = []
        engine.handle_line = seen.append
        os.write(self.write_fd, b'{"cmd":"ping"}\n{"cmd":"ping"}\n')
        engine._drain_stdin()
        self.assertEqual(len(seen), 2)

    def test_partial_line_then_rest(self):
        engine = self._engine()
        os.write(self.write_fd, b'{"cmd":"tog')
        engine._drain_stdin()
        self.assertIsNone(engine.pending_gesture)
        os.write(self.write_fd, b'gle"}\n')
        engine._drain_stdin()
        self.assertEqual(engine.pending_gesture, "toggle")

    def test_eof_stops_engine(self):
        engine = self._engine()
        engine.handle_line = lambda line: self.fail("no line expected")
        os.close(self.write_fd)
        self.write_fd = None
        engine._drain_stdin()
        self.assertFalse(engine.running)

    def test_multiple_reads_keep_remainder_intact(self):
        engine = self._engine()
        seen = []
        engine.handle_line = seen.append
        os.write(self.write_fd, b'{"cmd":"a"}\n{"cmd":"b"}\n{"cmd":"c"}\n{"cmd":"d')
        engine._drain_stdin()
        os.write(self.write_fd, b'"}\n{"cmd":"e"}\n')
        engine._drain_stdin()
        self.assertEqual(
            [line for line in seen if line.strip()],
            ['{"cmd":"a"}', '{"cmd":"b"}', '{"cmd":"c"}', '{"cmd":"d"}', '{"cmd":"e"}'],
        )


class GestureQueueTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="pomo-gesture-")
        self.engine = Engine(directory=self.dir)
        self.engine.client.ws = StubWS()

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_three_toggles_coalesce_to_one(self):
        for _ in range(3):
            self.engine.handle_line('{"cmd":"toggle"}')
        self.assertEqual(self.engine.pending_gesture, "toggle")
        applied = []
        self.engine.client.send_gesture = applied.append
        self.engine.client.host = "h"
        self.engine.client.port = 9876
        self.engine.client.token = "t"
        self.engine.client.set_mode("SYNCED")
        self.engine.drain_pending_gesture()
        self.assertEqual(applied, ["toggle"])
        self.assertIsNone(self.engine.pending_gesture)

    def test_gesture_held_while_busy(self):
        self.engine.handle_line('{"cmd":"skip"}')
        self.engine.client.busy = True
        applied = []
        self.engine.client.send_gesture = applied.append
        self.engine.client.host = "h"
        self.engine.client.set_mode("SYNCED")
        self.engine.drain_pending_gesture()
        self.assertEqual(applied, [])
        self.assertEqual(self.engine.pending_gesture, "skip")
        self.engine.client.busy = False
        self.engine.drain_pending_gesture()
        self.assertEqual(applied, ["skip"])

    def test_held_gesture_sets_waiting_message_then_applies_offline(self):
        engine = self.engine
        self.assertIsNone(engine.pending_gesture)
        engine.handle_line('{"cmd":"toggle"}')
        self.assertEqual(engine.client.message, "waiting to connect")
        self.engine.drain_pending_gesture()
        self.assertEqual(engine.pending_gesture, "toggle")
        engine.client.enter_offline("test")
        self.assertTrue(engine.model.local_owner)
        engine.drain_pending_gesture()
        self.assertIsNone(engine.pending_gesture)
        self.assertEqual(engine.model.status, "running")
        self.assertNotEqual(engine.client.message, "waiting to connect")

    def test_replaced_gesture_wins(self):
        engine = self.engine
        engine.handle_line('{"cmd":"toggle"}')
        engine.handle_line('{"cmd":"reset"}')
        self.assertEqual(engine.pending_gesture, "reset")

    def test_busy_exposed_in_status_payload(self):
        self.assertFalse(self.engine.status_payload()["busy"])
        self.engine.client.busy = True
        self.assertTrue(self.engine.status_payload()["busy"])


class GestureFailureTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="pomo-fail-")
        self.engine = Engine(directory=self.dir)
        self.engine.client.ws = StubWS()
        self.engine.client.rest = StubRest()

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_unreachable_phone_gesture_emits_error(self):
        engine = self.engine
        engine.client.host = "h"
        engine.client.token = "t"
        engine.client.set_mode("SYNCED")
        engine.client.send_gesture("toggle")
        errors = engine.client.drain_errors()
        self.assertEqual(len(errors), 1)
        self.assertIn("unreachable", errors[0])

    def test_success_without_state_schedules_resync(self):
        engine = self.engine
        engine.client.host = "h"
        engine.client.token = "t"
        engine.client.rest = StubRest(results=[(200, '{"success": true}')])
        engine.client.set_mode("SYNCED")
        engine.client.send_gesture("toggle")
        self.assertTrue(engine.client.resync_after_command)
        engine.client.tick()
        self.assertFalse(engine.client.resync_after_command)


class PairingNoopTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="pomo-pair-")
        self.engine = Engine(directory=self.dir)
        self.engine.client.ws = StubWS()

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def _pair(self):
        self.engine.client.apply_pairing({"host": "h", "port": 9876, "token": "tok"})

    def test_identical_pairing_is_noop(self):
        engine = self.engine
        self._pair()
        engine.client.set_mode("CONNECTING")
        calls = []
        engine.client.begin_websocket = lambda reason: calls.append(reason) or True
        result = engine.client.apply_pairing({"host": "h", "port": 9876, "token": "tok"})
        self.assertFalse(result)
        self.assertEqual(calls, [])

    def test_changed_pairing_reconnects(self):
        engine = self.engine
        self._pair()
        engine.client.set_mode("CONNECTING")
        calls = []
        engine.client.begin_websocket = lambda reason: calls.append(reason) or True
        result = engine.client.apply_pairing({"host": "h", "port": 9876, "token": "tok2"})
        self.assertTrue(result)
        self.assertEqual(calls, ["pairing changed"])


if __name__ == "__main__":
    unittest.main()
