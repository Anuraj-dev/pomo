import { describe, expect, test } from "bun:test";
import { pairingFromParsed, parsePairingPayload } from "../src/link/pairing";

describe("parsePairingPayload", () => {
  test("url+token pins host and port", () => {
    const parsed = parsePairingPayload({ url: "http://192.168.1.20:1234", token: "abc" });
    expect(parsed.host).toBe("192.168.1.20");
    expect(parsed.port).toBe(1234);
    expect(parsed.token).toBe("abc");
  });

  test("empty host and default port do not clobber url", () => {
    const parsed = parsePairingPayload({
      url: "http://phone.local:5555",
      token: "abc",
      host: "",
      port: 9876,
    });
    expect(parsed.host).toBe("phone.local");
    expect(parsed.port).toBe(5555);
  });

  test("empty host without url means no host", () => {
    const parsed = parsePairingPayload({ host: "", token: "abc" });
    expect(parsed.host).toBe("");
    expect(parsed.token).toBe("abc");
    expect(parsed.port).toBeUndefined();
  });

  test("nonempty host overrides url", () => {
    const parsed = parsePairingPayload({
      url: "http://phone.local:5555",
      token: "abc",
      host: "10.0.0.8",
      port: 9999,
    });
    expect(parsed.host).toBe("10.0.0.8");
    expect(parsed.port).toBe(9999);
  });

  test("url without port defaults 9876", () => {
    const parsed = parsePairingPayload({ url: "http://192.168.1.20", token: "t" });
    expect(parsed.host).toBe("192.168.1.20");
    expect(parsed.port).toBe(9876);
  });

  test("JSON string payload", () => {
    const parsed = parsePairingPayload('{"url":"http://10.0.0.2:9876","token":"tok"}');
    expect(parsed.host).toBe("10.0.0.2");
    expect(parsed.port).toBe(9876);
    expect(parsed.token).toBe("tok");
  });

  test("Chrome pairing requires host and token", () => {
    expect(pairingFromParsed(parsePairingPayload({ token: "abc" }))).toBeNull();
    expect(pairingFromParsed(parsePairingPayload({ url: "http://10.0.0.2:9876" }))).toBeNull();
    expect(pairingFromParsed(parsePairingPayload({ url: "http://10.0.0.2:9876", token: "abc" }))).toEqual({
      host: "10.0.0.2",
      port: 9876,
      token: "abc",
    });
  });
});
