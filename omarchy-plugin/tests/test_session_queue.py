import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

from pomo_link.constants import QUEUE_CAPACITY
from pomo_link.queue import SessionQueue


class SessionQueueDropOldestTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "sessions.json")
        self.queue = SessionQueue(self.path)

    def tearDown(self):
        self.tmp.cleanup()

    def test_drop_oldest_when_full(self):
        for i in range(QUEUE_CAPACITY):
            self.assertTrue(
                self.queue.enqueue("id-%02d" % i, "work", 1500, 1_700_000_000 + i)
            )
        self.assertEqual(self.queue.count(), QUEUE_CAPACITY)
        self.assertEqual(self.queue.at(0)["client_id"], "id-00")
        self.assertTrue(self.queue.enqueue("id-new", "short", 300, 1_700_000_040))
        self.assertEqual(self.queue.count(), QUEUE_CAPACITY)
        self.assertEqual(self.queue.at(0)["client_id"], "id-01")
        self.assertEqual(self.queue.at(QUEUE_CAPACITY - 1)["client_id"], "id-new")

    def test_reload_keeps_cap_and_order(self):
        for i in range(QUEUE_CAPACITY + 3):
            self.queue.enqueue("id-%02d" % i, "work", 60, 1_700_000_000 + i)
        reloaded = SessionQueue(self.path)
        self.assertEqual(reloaded.count(), QUEUE_CAPACITY)
        self.assertEqual(reloaded.at(0)["client_id"], "id-03")
        self.assertEqual(reloaded.at(QUEUE_CAPACITY - 1)["client_id"], "id-%02d" % (QUEUE_CAPACITY + 2))

    def test_drop_by_client_id_accepted_and_rejected(self):
        self.queue.enqueue("keep", "work", 1500, 1_700_000_000)
        self.queue.enqueue("gone-a", "short", 300, 1_700_000_100)
        self.queue.enqueue("gone-b", "long", 900, 1_700_000_200)
        dropped = self.queue.drop_by_client_id(["gone-a", "gone-b"])
        self.assertEqual(dropped, 2)
        self.assertEqual(self.queue.count(), 1)
        self.assertEqual(self.queue.at(0)["client_id"], "keep")

    def test_strip_implausible_starts(self):
        now = 1_800_000_000
        self.queue.enqueue("old", "work", 1500, now - (15 * 24 * 60 * 60))
        self.queue.enqueue("future", "work", 1500, now + 10 * 60)
        self.queue.enqueue("ok", "work", 1500, now - 60)
        stripped = self.queue.strip_implausible_starts(now)
        self.assertEqual(stripped, 2)
        by_id = {row["client_id"]: row for row in self.queue.items}
        self.assertNotIn("start", by_id["old"])
        self.assertNotIn("start", by_id["future"])
        self.assertEqual(by_id["ok"]["start"], now - 60)


if __name__ == "__main__":
    unittest.main()
