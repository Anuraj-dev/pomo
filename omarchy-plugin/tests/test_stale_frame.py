import os
import sys
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

from pomo_link.timer import TimerModel


class StaleFrameRejectionTest(unittest.TestCase):
    def _running(self, remaining, server_time, epoch_now=None, duration=1500.0, start=1710000000.0):
        model = TimerModel()
        if epoch_now is None:
            epoch_now = server_time
        ok = model.apply_state(
            "running",
            "work",
            remaining,
            duration,
            0,
            8,
            start_time=start,
            server_time=server_time,
            epoch_now=epoch_now,
            force=True,
        )
        self.assertTrue(ok)
        return model

    def test_older_server_time_same_session_rejected(self):
        model = self._running(remaining=1400.0, server_time=1000)
        ok = model.apply_state(
            "running",
            "work",
            1390.0,
            1500.0,
            0,
            8,
            start_time=1710000000.0,
            server_time=999,
            epoch_now=1000,
            force=False,
        )
        self.assertFalse(ok)
        self.assertEqual(model.last_server_time, 1000)

    def test_remaining_inflation_without_duration_growth_rejected(self):
        model = self._running(remaining=1200.0, server_time=1000, epoch_now=1000)
        # Local clock has ticked a little; a delayed non-extend frame with a
        # higher remaining for the same session must not rebase upward.
        model.remaining = 1100.0
        model.received_at_mono = time.monotonic()
        ok = model.apply_state(
            "running",
            "work",
            1190.0,
            1500.0,
            0,
            8,
            start_time=1710000000.0,
            server_time=1001,
            epoch_now=1001,
            force=False,
        )
        self.assertFalse(ok)
        self.assertEqual(model.remaining, 1100.0)

    def test_extend_duration_growth_allows_remaining_increase(self):
        model = self._running(remaining=1200.0, server_time=1000, epoch_now=1000)
        ok = model.apply_state(
            "running",
            "work",
            1500.0,
            1800.0,
            0,
            8,
            start_time=1710000000.0,
            server_time=1002,
            epoch_now=1002,
            force=False,
        )
        self.assertTrue(ok)
        self.assertEqual(model.duration, 1800.0)
        self.assertEqual(model.remaining, 1500.0)

    def test_lag_projection_subtracts_server_time_delay(self):
        model = self._running(remaining=1000.0, server_time=50, epoch_now=50)
        ok = model.apply_state(
            "running",
            "work",
            900.0,
            1500.0,
            0,
            8,
            start_time=1710000100.0,
            server_time=80,
            epoch_now=90,
            force=True,
        )
        self.assertTrue(ok)
        # 900 - (90-80) = 890
        self.assertEqual(model.remaining, 890.0)

    def test_force_applies_even_if_stale(self):
        model = self._running(remaining=1400.0, server_time=1000)
        ok = model.apply_state(
            "running",
            "work",
            2000.0,
            1500.0,
            1,
            8,
            start_time=1710000000.0,
            server_time=900,
            epoch_now=1000,
            force=True,
        )
        self.assertTrue(ok)
        self.assertEqual(model.completed, 1)

    def test_new_session_is_not_rejected_as_stale(self):
        model = self._running(remaining=100.0, server_time=1000, start=1.0)
        ok = model.apply_state(
            "running",
            "short",
            300.0,
            300.0,
            1,
            8,
            start_time=2.0,
            server_time=1001,
            epoch_now=1001,
            force=False,
        )
        self.assertTrue(ok)
        self.assertEqual(model.phase, "short")


if __name__ == "__main__":
    unittest.main()
