import os
import shutil
import json
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

import pomo_link.main as main_module
from pomo_link.main import Engine
from pomo_link.persist import load_json


class TodayStateTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.mkdtemp(prefix="pomo-today-")
        self.engine = Engine(directory=self.directory)

    def tearDown(self):
        self.engine.client.worker.stop()
        shutil.rmtree(self.directory, ignore_errors=True)

    def test_local_midnight_resets_live_snapshot_and_persists_date(self):
        self.engine.client.enter_offline("test")
        self.engine.model.completed = 3
        self.engine.model.completed_date = "2026-09-03"
        self.engine.model.toggle()

        with patch.object(main_module.time, "strftime", return_value="2026-09-04"):
            self.assertTrue(self.engine.ensure_local_day())

        self.assertEqual(self.engine.model.completed, 0)
        self.assertEqual(self.engine.model.completed_date, "2026-09-04")
        snapshot = load_json(os.path.join(self.directory, "timer.json"))
        self.assertEqual(snapshot["completed"], 0)
        self.assertEqual(snapshot["completed_date"], "2026-09-04")

    def test_phone_date_is_exposed_against_process_local_today(self):
        self.engine.client.apply_phone_object({
            "status": "stopped",
            "phase": "work",
            "remaining": 1500,
            "duration": 1500,
            "completed": 2,
            "daily_goal": 8,
            "date": "2026-09-03",
        })
        with patch.object(main_module.time, "strftime", return_value="2026-09-04"):
            payload = self.engine.status_payload()
        self.assertEqual(payload["date"], "2026-09-03")
        self.assertEqual(payload["local_today"], "2026-09-04")

    def test_missing_phone_date_is_empty_and_does_not_add_today_word(self):
        self.engine.client.apply_phone_object({
            "status": "stopped", "phase": "work", "remaining": 1500,
            "duration": 1500, "completed": 2, "daily_goal": 8, "date": 123,
        })
        with patch.object(main_module.time, "strftime", return_value="2026-09-04"):
            payload = self.engine.status_payload()
        self.assertEqual(payload["date"], "")

    def test_same_phone_date_uses_today_label_branch(self):
        self.engine.client.apply_phone_object({
            "status": "stopped", "phase": "work", "remaining": 1500,
            "duration": 1500, "completed": 2, "daily_goal": 8,
            "date": "2026-09-04",
        })
        with patch.object(main_module.time, "strftime", return_value="2026-09-04"):
            payload = self.engine.status_payload()
        self.assertEqual(payload["date"], payload["local_today"])

    @unittest.skipUnless(shutil.which("node"), "node runtime not available")
    def test_formatter_covers_today_other_date_and_empty_date(self):
        cases = (
            ({"completed": 2, "goal": 8, "date": "2026-09-04", "localToday": "2026-09-04"}, "2 / 8 today"),
            ({"completed": 2, "goal": 8, "date": "2026-09-03", "localToday": "2026-09-04"}, "2 / 8 · 2026-09-03"),
            ({"completed": 2, "goal": 8, "date": "", "localToday": "2026-09-04"}, "2 / 8"),
            ({"completed": 2, "goal": 0, "date": "2026-09-04", "localToday": "2026-09-04"}, "2 today"),
        )
        node = shutil.which("node")
        helper = os.path.join(os.path.dirname(__file__), "..", "widget", "today.js")
        script = (
            "const fs = require('fs');"
            "const helper = require(process.argv[1]);"
            "const input = JSON.parse(fs.readFileSync(0, 'utf8'));"
            "process.stdout.write(helper.formatTodayLine(input.completed, input.goal, input.date, input.localToday));"
        )
        for values, expected in cases:
            with self.subTest(values=values):
                result = subprocess.run(
                    [node, "-e", script, helper],
                    input=json.dumps(values),
                    text=True,
                    capture_output=True,
                    check=True,
                )
                self.assertEqual(result.stdout, expected)


if __name__ == "__main__":
    unittest.main()
