import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "lib"))

from pomo_link.client import parse_pairing_payload


class ParsePairingPayloadTest(unittest.TestCase):
    def test_url_token_pins_host_and_port(self):
        parsed = parse_pairing_payload(
            {"url": "http://192.168.1.20:1234", "token": "abc"}
        )
        self.assertEqual(parsed["host"], "192.168.1.20")
        self.assertEqual(parsed["port"], 1234)
        self.assertEqual(parsed["token"], "abc")

    def test_empty_host_and_default_port_do_not_clobber_url(self):
        parsed = parse_pairing_payload(
            {
                "url": "http://phone.local:5555",
                "token": "abc",
                "host": "",
                "port": 9876,
            }
        )
        self.assertEqual(parsed["host"], "phone.local")
        self.assertEqual(parsed["port"], 5555)

    def test_empty_host_without_url_means_mdns(self):
        parsed = parse_pairing_payload({"host": "", "token": "abc"})
        self.assertEqual(parsed["host"], "")
        self.assertEqual(parsed["token"], "abc")
        self.assertNotIn("port", parsed)

    def test_nonempty_host_overrides_url(self):
        parsed = parse_pairing_payload(
            {
                "url": "http://phone.local:5555",
                "token": "abc",
                "host": "10.0.0.8",
                "port": 9999,
            }
        )
        self.assertEqual(parsed["host"], "10.0.0.8")
        self.assertEqual(parsed["port"], 9999)

    def test_url_without_port_defaults_9876(self):
        parsed = parse_pairing_payload({"url": "http://192.168.1.20", "token": "t"})
        self.assertEqual(parsed["host"], "192.168.1.20")
        self.assertEqual(parsed["port"], 9876)


if __name__ == "__main__":
    unittest.main()
