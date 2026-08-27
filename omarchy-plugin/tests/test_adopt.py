import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

from pomo_link.adopt import can_adopt, is_same_session


def phone(**kwargs):
    state = {
        "status": "stopped",
        "phase": "work",
        "remaining": 1500.0,
        "duration": 1500.0,
        "start_time": 0.0,
    }
    state.update(kwargs)
    return state


def payload(**kwargs):
    state = {
        "status": "running",
        "phase": "work",
        "remaining": 1200.0,
        "duration": 1500.0,
        "start_time": 1710000000.0,
    }
    state.update(kwargs)
    return state


class LeastRemainingAdoptTest(unittest.TestCase):
    def test_phone_stopped_always_adopts(self):
        self.assertTrue(
            can_adopt(
                phone(status="stopped", remaining=1500.0, start_time=0.0),
                payload(remaining=1400.0, start_time=1710000000.0),
            )
        )

    def test_same_session_always_adopts_even_if_payload_remaining_is_larger(self):
        current = phone(
            status="running",
            phase="work",
            remaining=1100.0,
            start_time=1710000000.0,
        )
        desk = payload(
            status="running",
            phase="work",
            remaining=1300.0,
            start_time=1710000000.0,
        )
        self.assertTrue(is_same_session(current, desk))
        self.assertTrue(can_adopt(current, desk))

    def test_example_laptop_20m_beats_phone_23m(self):
        # 25m timer: laptop 20m remaining, phone 23m remaining -> laptop wins.
        current = phone(
            status="running",
            phase="work",
            remaining=23 * 60,
            start_time=100.0,
        )
        desk = payload(
            status="running",
            phase="work",
            remaining=20 * 60,
            duration=25 * 60,
            start_time=200.0,
        )
        self.assertFalse(is_same_session(current, desk))
        self.assertTrue(can_adopt(current, desk))

    def test_both_live_different_session_desk_strictly_less(self):
        current = phone(status="running", remaining=900.0, start_time=1.0, phase="work")
        desk = payload(status="paused", remaining=899.0, start_time=2.0, phase="work")
        self.assertTrue(can_adopt(current, desk))

    def test_equal_remaining_on_different_sessions_is_busy(self):
        current = phone(status="running", remaining=800.0, start_time=1.0, phase="work")
        desk = payload(status="running", remaining=800.0, start_time=2.0, phase="work")
        self.assertFalse(can_adopt(current, desk))

    def test_desk_longer_remaining_on_different_session_is_busy(self):
        current = phone(status="running", remaining=700.0, start_time=1.0, phase="work")
        desk = payload(status="running", remaining=701.0, start_time=2.0, phase="work")
        self.assertFalse(can_adopt(current, desk))

    def test_zero_start_time_is_not_same_session(self):
        current = phone(status="running", remaining=500.0, start_time=0.0, phase="work")
        desk = payload(status="running", remaining=100.0, start_time=0.0, phase="work")
        self.assertFalse(is_same_session(current, desk))
        self.assertTrue(can_adopt(current, desk))  # desk remaining strictly less

    def test_non_live_payload_while_phone_live_is_busy(self):
        current = phone(status="running", remaining=500.0, start_time=1.0, phase="work")
        desk = payload(status="stopped", remaining=0.0, start_time=2.0, phase="work")
        self.assertFalse(can_adopt(current, desk))


if __name__ == "__main__":
    unittest.main()
