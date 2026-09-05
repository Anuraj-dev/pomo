"""Single background worker for blocking phone I/O (REST, mDNS, WS connect).

The engine's select loop must never block: stdin lines queue up while the
loop is frozen and then burst-execute (the multi-press root cause). All
blocking phone calls run here, one job at a time; the main loop drains
(tag, result) pairs from `results` and applies them in submission order.

`func` is a closure capturing everything it needs (host/port/token, body) so
later mutations of client state cannot race a job already queued. A raised
exception is returned as the result — the applier decides what it means.
"""

from __future__ import annotations

import queue
import threading


class RestWorker:
    def __init__(self):
        self.jobs = queue.Queue()
        self.results = queue.Queue()
        self.thread = threading.Thread(target=self._run, daemon=True, name="pomo-rest-worker")
        self.thread.start()

    def submit(self, tag, func):
        self.jobs.put((tag, func))

    def stop(self):
        self.jobs.put((None, None))

    def _run(self):
        while True:
            tag, func = self.jobs.get()
            if func is None:
                return
            try:
                result = func()
            except Exception as exc:  # returned, never raised into the loop
                result = exc
            self.results.put((tag, result))
