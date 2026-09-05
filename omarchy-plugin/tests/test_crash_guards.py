import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

from pomo_link.client import PomoClient, parse_pairing_payload
from pomo_link.main import Engine
from pomo_link.persist import atomic_write, load_json
from pomo_link.queue import SessionQueue
from pomo_link.store import ConfigStore
from pomo_link.timer import TimerModel


class ParseGuardTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="pomo-crash-")
        self.store = ConfigStore(self.dir)

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_garbage_start_time_does_not_raise(self):
        model = TimerModel()
        model.set_config(45, 5, 15, 4, 8)
        client = PomoClient(model, SessionQueue(self.store.sessions_path), self.store)
        ok = client.apply_phone_object(
            {"status": "running", "phase": "work", "remaining": 100.0,
             "duration": 2700.0, "completed": 1, "daily_goal": 8,
             "start_time": "garbage", "server_time": 0}
        )
        self.assertTrue(ok)
        self.assertEqual(model.start_time, 0.0)

    def test_garbage_numeric_fields_do_not_raise(self):
        model = TimerModel()
        model.set_config(45, 5, 15, 4, 5)
        client = PomoClient(model, SessionQueue(self.store.sessions_path), self.store)
        ok = client.apply_phone_object(
            {"status": "running", "phase": "work", "remaining": "nan!",
             "duration": [1], "completed": {}, "daily_goal": "soon",
             "start_time": None, "server_time": "x"}
        )
        self.assertTrue(ok)
        self.assertEqual(model.remaining, 0.0)
        self.assertEqual(model.completed, 0)

    def test_missing_goal_keeps_store_goal_not_hardcoded_eight(self):
        model = TimerModel()
        model.set_config(45, 5, 15, 4, 5)
        client = PomoClient(model, SessionQueue(self.store.sessions_path), self.store)
        client.apply_phone_object(
            {"status": "stopped", "phase": "work", "remaining": 2700.0,
             "duration": 2700.0, "completed": 0}
        )
        self.assertEqual(model.goal, 5)

    def test_pair_url_with_out_of_range_port_does_not_raise(self):
        parsed = parse_pairing_payload({"url": "http://192.168.0.5:99999", "token": "x"})
        self.assertEqual(parsed["host"], "192.168.0.5")
        self.assertEqual(parsed["port"], 9876)

    def test_pair_url_with_non_numeric_port_does_not_raise(self):
        parsed = parse_pairing_payload({"url": "http://192.168.0.5:abc", "token": "x"})
        self.assertEqual(parsed["host"], "192.168.0.5")
        self.assertEqual(parsed["port"], 9876)


class CorruptStoreTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="pomo-store-")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_corrupt_next_seq_falls_back(self):
        atomic_write(os.path.join(self.dir, "config.json"), {"next_seq": "abc", "host": "h"})
        store = ConfigStore(self.dir)
        self.assertEqual(store.next_seq, 1)
        self.assertEqual(store.host, "h")

    def test_corrupt_durations_keep_defaults(self):
        atomic_write(os.path.join(self.dir, "config.json"), {"work": "abc", "goal": "zzz"})
        store = ConfigStore(self.dir)
        self.assertEqual(store.work_minutes, 25)
        self.assertEqual(store.goal, 8)

    def test_corrupt_session_row_is_skipped(self):
        atomic_write(os.path.join(self.dir, "sessions.json"), {
            "sessions": [{"client_id": "a", "type": "work", "duration": "zzz"}]
        })
        queue = SessionQueue(os.path.join(self.dir, "sessions.json"))
        self.assertTrue(queue.empty())

    def test_set_durations_phone_garbage_keeps_current(self):
        store = ConfigStore(self.dir)
        store.set_durations(45, 5, 15, 4, 6)
        store.set_durations("boom", None, object(), "x", "y")
        self.assertEqual(store.work_minutes, 45)
        self.assertEqual(store.short_minutes, 5)
        self.assertEqual(store.long_minutes, 15)
        self.assertEqual(store.long_after, 4)
        self.assertEqual(store.goal, 6)


class PersistRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="pomo-persist-")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_atomic_write_recovers_interrupted_tmp(self):
        path = os.path.join(self.dir, "timer.json")
        # Crash between write and replace: tmp exists, main file missing.
        with open(path + ".tmp", "w", encoding="utf-8") as handle:
            handle.write('{"status": "running"}')
        self.assertEqual(load_json(path), {"status": "running"})
        self.assertFalse(os.path.exists(path + ".tmp"))

    def test_atomic_write_leaves_no_tmp_on_success(self):
        path = os.path.join(self.dir, "config.json")
        atomic_write(path, {"a": 1})
        self.assertEqual(load_json(path), {"a": 1})
        self.assertFalse(os.path.exists(path + ".tmp"))


class LoopGuardTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="pomo-loop-")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_loop_survives_repeated_body_exceptions(self):
        engine = Engine(directory=self.dir)
        calls = {"n": 0}

        def boom():
            calls["n"] += 1
            if calls["n"] < 3:
                raise RuntimeError("boom")
            engine.running = False

        engine._loop_once = boom
        engine.loop()
        self.assertEqual(calls["n"], 3)

    def test_handle_line_garbage_does_not_raise(self):
        engine = Engine(directory=self.dir)
        engine.handle_line('{"cmd": "pair", "url": "http://h:99999", "token": "t"}')
        engine.handle_line("not json at all")
        engine.handle_line('{"cmd": 123}')
        self.assertTrue(engine.running)


if __name__ == "__main__":
    unittest.main()
