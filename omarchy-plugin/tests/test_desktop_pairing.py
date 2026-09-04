import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

from pomo_link.desktop_pairing import load_desktop_client_pairing


class DesktopClientPairingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "desktop-client.json")

    def tearDown(self):
        self.tmp.cleanup()

    def _write(self, doc):
        with open(self.path, "w", encoding="utf-8") as handle:
            json.dump(doc, handle)

    def test_phone_url_and_pairing_token(self):
        self._write(
            {
                "phone_url": "http://192.168.1.20:1234",
                "pairing_token": "abc",
            }
        )
        parsed = load_desktop_client_pairing(self.path)
        self.assertEqual(parsed["host"], "192.168.1.20")
        self.assertEqual(parsed["port"], 1234)
        self.assertEqual(parsed["token"], "abc")

    def test_empty_token_is_ignored(self):
        self._write({"phone_url": "http://192.168.1.20:1234", "pairing_token": ""})
        self.assertEqual(load_desktop_client_pairing(self.path), {})

    def test_missing_file_is_empty(self):
        self.assertEqual(load_desktop_client_pairing(self.path), {})

    def test_url_token_shape_also_works(self):
        self._write({"url": "http://10.0.0.8:9876", "token": "xyz"})
        parsed = load_desktop_client_pairing(self.path)
        self.assertEqual(parsed["host"], "10.0.0.8")
        self.assertEqual(parsed["port"], 9876)
        self.assertEqual(parsed["token"], "xyz")


if __name__ == "__main__":
    unittest.main()
