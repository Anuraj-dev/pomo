import os
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

import pomo_link.main as main_module
from pomo_link.main import Engine
from pomo_link.store import ConfigStore, wall_adjust_remaining


class RestoreRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.mkdtemp(prefix="pomo-restore-")

    def tearDown(self):
        shutil.rmtree(self.directory, ignore_errors=True)

    def _save(self, **overrides):
        snap = {
            "status": "running",
            "phase": "work",
            "remaining": 5.0,
            "duration": 60.0,
            "completed": 2,
            "start_time": 1000.0,
            "goal": 8,
            "saved_epoch": 1000,
        }
        snap.update(overrides)
        store = ConfigStore(self.directory)
        self.assertTrue(store.save_timer_snapshot(snap))

    def test_running_snapshot_at_zero_is_queued_once_and_left_idle(self):
        self._save()
        with patch.object(main_module.time, "time", return_value=1005):
            engine = Engine(directory=self.directory)
        self.assertTrue(engine.model.is_stopped())
        self.assertEqual(engine.queue.count(), 1)
        self.assertEqual(engine.queue.at(0)["type"], "work")
        self.assertEqual(engine.queue.at(0)["duration"], 60)
        self.assertEqual(engine.queue.at(0)["start"], 1000)
        self.assertFalse(os.path.exists(os.path.join(self.directory, "timer.json")))

    def test_expired_work_snapshot_completes_once_and_uses_long_break_cadence(self):
        self._save(completed=3, completed_date="2026-09-04")
        with patch.object(main_module.time, "time", return_value=1005), patch.object(
            main_module.time, "strftime", return_value="2026-09-04"
        ):
            engine = Engine(directory=self.directory)

        self.assertEqual(engine.queue.count(), 1)
        self.assertEqual(engine.model.completed, 4)
        self.assertEqual(engine.model.phase, "long")
        self.assertEqual(engine.model.duration, 15 * 60)
        self.assertEqual(engine.model.remaining, 15 * 60)
        self.assertEqual(engine.model.start_time, 0.0)
        self.assertTrue(engine.model.is_stopped())

    def test_expired_snapshot_without_start_time_does_not_complete(self):
        self._save(start_time=0.0, completed=3, completed_date="2026-09-04")
        with patch.object(main_module.time, "time", return_value=1005), patch.object(
            main_module.time, "strftime", return_value="2026-09-04"
        ):
            engine = Engine(directory=self.directory)

        self.assertEqual(engine.queue.count(), 0)
        self.assertEqual(engine.model.completed, 0)
        self.assertEqual(engine.model.phase, "work")
        self.assertTrue(engine.model.is_stopped())

    def test_expired_work_from_prior_day_stamps_today_before_counting(self):
        self._save(completed=3, completed_date="2026-09-03")
        with patch.object(main_module.time, "time", return_value=1005), patch.object(
            main_module.time, "strftime", return_value="2026-09-04"
        ):
            engine = Engine(directory=self.directory)

        self.assertEqual(engine.model.completed, 1)
        self.assertEqual(engine.model.completed_date, "2026-09-04")
        self.assertEqual(engine.model.phase, "short")

    def test_wall_clock_jump_back_does_not_inflate_remaining(self):
        snap = {"status": "running", "remaining": 10.0, "saved_epoch": 1000}
        with patch.object(main_module.time, "time", return_value=900):
            self.assertEqual(wall_adjust_remaining(snap), 10.0)


if __name__ == "__main__":
    unittest.main()
