import json
import os
import shutil
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

import pomo_link.client as client_module
from pomo_link.main import Engine

from test_stdin import FakeWorker, StubRest, StubWS, run_pending_jobs


def state_frame(server_time, remaining, start, status="running", phase="work", duration=1500.0):
    return json.dumps(
        {
            "type": "state",
            "data": {
                "status": status,
                "phase": phase,
                "remaining": remaining,
                "duration": duration,
                "completed": 0,
                "daily_goal": 8,
                "start_time": start,
                "server_time": server_time,
            },
        }
    )


class EnterSyncBase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="pomo-sync-")
        self.engine = Engine(directory=self.dir)
        self.client = self.engine.client
        self.client.ws = StubWS()
        self.client.rest = StubRest()
        self.client.worker = FakeWorker()
        self.client.host = "h"
        self.client.port = 9876
        self.client.token = "t"

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def connect_ready(self):
        self.client.set_mode("CONNECTING")


class NewestFrameWinsTest(EnterSyncBase):
    def test_newer_state_frame_during_import_is_snap_target(self):
        self.client.rest = StubRest(results=[(200, '{"accepted": ["id1"], "rejected": []}')])
        self.client.queue.enqueue("id1", "work", 60, int(time.time()) - 60, "")
        now = int(time.time())
        self.connect_ready()
        self.client.on_websocket_text(state_frame(now - 5, 100.0, 1111.0))
        self.assertTrue(self.client.entering_sync)
        self.assertEqual(len(self.client.worker.jobs), 1, "import job queued")
        # A fresher frame arrives while the import is "in flight".
        self.client.on_websocket_text(state_frame(now - 3, 90.0, 2222.0))
        run_pending_jobs(self.client)  # import ok -> desk idle -> snap
        self.assertEqual(self.client.mode, "SYNCED")
        self.assertEqual(self.client.model.start_time, 2222.0)
        self.assertFalse(self.client.entering_sync)

    def test_older_duplicate_frame_does_not_replace_pending(self):
        self.client.rest = StubRest(results=[(200, '{"accepted": ["id1"], "rejected": []}')])
        self.client.queue.enqueue("id1", "work", 60, int(time.time()) - 60, "")
        now = int(time.time())
        self.connect_ready()
        self.client.on_websocket_text(state_frame(now - 3, 90.0, 2222.0))
        self.client.on_websocket_text(state_frame(now - 5, 100.0, 1111.0))
        run_pending_jobs(self.client)
        self.assertEqual(self.client.model.start_time, 2222.0)


class ImportRetryTest(EnterSyncBase):
    def test_import_fails_three_times_then_snaps_and_syncs(self):
        self.client.queue.enqueue("id1", "work", 60, int(time.time()) - 60, "")
        now = int(time.time())
        self.connect_ready()
        self.client.on_websocket_text(state_frame(now - 3, 90.0, 2222.0))
        for _ in range(3):
            run_pending_jobs(self.client)
            if self.client.import_retry_at:
                self.client.import_retry_at -= 10.0
                self.client.tick_enter_sync()
        self.assertEqual(self.client.mode, "SYNCED")
        self.assertTrue(any("syncing anyway" in e for e in self.client.error_lines))
        self.assertEqual(self.client.queue.count(), 1, "rows retained for next reconnect")

    def test_import_success_drops_rows(self):
        self.client.rest = StubRest(results=[(200, '{"accepted": ["id1"], "rejected": []}')])
        self.client.queue.enqueue("id1", "work", 60, int(time.time()) - 60, "")
        now = int(time.time())
        self.connect_ready()
        self.client.on_websocket_text(state_frame(now - 3, 90.0, 2222.0))
        run_pending_jobs(self.client)
        self.assertEqual(self.client.mode, "SYNCED")
        self.assertTrue(self.client.queue.empty())


class AdoptPipelineTest(EnterSyncBase):
    def _desk_live(self):
        self.client.enter_offline("test")
        self.client.model.set_config(45, 5, 15, 4, 8)
        self.client.model.toggle()
        self.client.model.set_start_time(1710000000.0)

    def test_desk_idle_snaps_latest_pending(self):
        now = int(time.time())
        self.connect_ready()
        self.client.on_websocket_text(state_frame(now - 3, 90.0, 2222.0))
        run_pending_jobs(self.client)
        self.assertEqual(self.client.mode, "SYNCED")
        self.assertEqual(self.client.model.start_time, 2222.0)

    def test_adopt_409_applies_phone_state_without_pending_snap(self):
        self._desk_live()
        now = int(time.time())
        phone_state = {
            "status": "running", "phase": "work", "remaining": 500.0,
            "duration": 1500.0, "completed": 3, "daily_goal": 8,
            "start_time": 9999.0, "server_time": now,
        }
        self.client.rest = StubRest(results=[(409, json.dumps({"state": phone_state}))])
        self.connect_ready()
        self.client.on_websocket_text(state_frame(now - 3, 90.0, 2222.0))
        # queue empty -> import skipped -> adopt job queued
        self.assertEqual(len(self.client.worker.jobs), 1)
        self.assertEqual(self.client.worker.jobs[0][0], "adopt")
        run_pending_jobs(self.client)
        self.assertEqual(self.client.mode, "SYNCED")
        self.assertEqual(self.client.model.start_time, 9999.0)
        self.assertEqual(self.client.model.remaining, 500.0)
        self.assertEqual(self.client.model.completed, 3)

    def test_adopt_transport_fail_phone_stopped_goes_offline(self):
        self._desk_live()
        now = int(time.time())
        self.connect_ready()
        self.client.on_websocket_text(state_frame(now - 3, 90.0, 2222.0, status="stopped"))
        self.client.rest = StubRest(results=[(0, "")])
        run_pending_jobs(self.client)
        self.assertEqual(self.client.mode, "OFFLINE")

    def test_adopt_transport_fail_phone_active_snaps(self):
        self._desk_live()
        now = int(time.time())
        self.connect_ready()
        self.client.on_websocket_text(state_frame(now - 3, 90.0, 2222.0))
        self.client.rest = StubRest(results=[(0, "")])
        run_pending_jobs(self.client)
        self.assertEqual(self.client.mode, "SYNCED")
        self.assertEqual(self.client.model.start_time, 2222.0)


class GestureDuringPipelineTest(EnterSyncBase):
    def test_stdin_toggle_during_import_is_held_then_applied(self):
        self.client.rest = StubRest(results=[(200, '{"accepted": ["id1"], "rejected": []}')])
        self.client.queue.enqueue("id1", "work", 60, int(time.time()) - 60, "")
        now = int(time.time())
        self.connect_ready()
        self.engine.handle_line('{"cmd":"toggle"}')
        self.engine.handle_line('{"cmd":"toggle"}')
        self.client.on_websocket_text(state_frame(now - 3, 90.0, 2222.0))
        self.engine.drain_pending_gesture()
        self.assertEqual(self.engine.pending_gesture, "toggle", "held during pipeline")
        run_pending_jobs(self.client)
        self.assertEqual(self.client.mode, "SYNCED")
        self.engine.drain_pending_gesture()
        self.assertIsNone(self.engine.pending_gesture)
        self.assertTrue(self.client.busy, "phone-path gesture in flight")
        self.assertEqual(self.client.worker.jobs[-1][0], "toggle")
        run_pending_jobs(self.client)
        self.assertFalse(self.client.busy)


class DiscoveryAsyncTest(EnterSyncBase):
    def test_discovery_job_probes_candidates_and_picks(self):
        self.client.store.host = ""
        self.client.rest = StubRest(results=[(200, "")])
        self.client.set_mode("DISCOVERING")
        self.client.retry_delay_s = 0
        orig_browse = client_module.browse_pomo
        # The patch must stay active while the deferred job executes, not
        # just while it is queued.
        client_module.browse_pomo = lambda timeout=4.0: [
            {"host": "1.2.3.4", "port": 9876, "proto": "IPv4"}
        ]
        try:
            self.client.tick_discovery()
            run_pending_jobs(self.client)
        finally:
            client_module.browse_pomo = orig_browse
        self.assertEqual(self.client.host, "1.2.3.4")
        self.assertEqual(self.client.worker.jobs[-1][0], "connect", "handshake queued off-loop")

    def test_pinned_host_skips_mdns(self):
        self.client.store.host = "5.6.7.8"
        self.client.set_mode("DISCOVERING")
        self.client.retry_delay_s = 0
        self.client.tick_discovery()
        tags = [tag for tag, _func in self.client.worker.jobs]
        self.assertEqual(tags, ["connect"], "no discover job for pinned host")


class OfflineProbeTest(EnterSyncBase):
    def test_offline_poll_result_200_moves_to_discovering(self):
        self.client.rest = StubRest(results=[(200, "")])
        self.client.enter_offline("test")
        self.client.tick_offline()
        run_pending_jobs(self.client)
        self.assertEqual(self.client.mode, "DISCOVERING")
        self.assertTrue(self.client.prefer_known_host)


if __name__ == "__main__":
    unittest.main()
