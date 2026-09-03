import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

from pomo_link.waybar import format_waybar


class WaybarFormatTest(unittest.TestCase):
    def test_missing_status_is_offline_placeholder(self):
        doc = json.loads(format_waybar(None))
        self.assertIn("offline", doc["class"])
        self.assertEqual(doc["tooltip"], "pomo-link is not running")
        self.assertIn("--:--", doc["text"])

    def test_synced_running_work(self):
        doc = json.loads(
            format_waybar(
                {
                    "mode": "SYNCED",
                    "status": "running",
                    "phase": "work",
                    "remaining": 1499,
                    "completed": 2,
                    "goal": 8,
                    "has_token": True,
                    "local_owner": False,
                }
            )
        )
        self.assertEqual(doc["class"], "running work online")
        self.assertIn("24:59", doc["text"])
        self.assertEqual(doc["tooltip"], "running work - 2/8 sessions")

    def test_offline_local_timer_keeps_time(self):
        doc = json.loads(
            format_waybar(
                {
                    "mode": "OFFLINE",
                    "status": "running",
                    "phase": "work",
                    "remaining": 60,
                    "completed": 0,
                    "goal": 8,
                    "has_token": True,
                    "local_owner": True,
                }
            )
        )
        self.assertEqual(doc["class"], "running work offline")
        self.assertIn("1:00", doc["text"])
        self.assertIn("(local)", doc["tooltip"])

    def test_unpaired_uses_warning_icon_class(self):
        doc = json.loads(
            format_waybar(
                {
                    "mode": "UNPAIRED",
                    "status": "stopped",
                    "phase": "work",
                    "remaining": 1500,
                    "completed": 0,
                    "goal": 8,
                    "has_token": False,
                    "local_owner": True,
                }
            )
        )
        self.assertIn("offline", doc["class"])
        self.assertIn("", doc["text"])


if __name__ == "__main__":
    unittest.main()
