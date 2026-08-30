import { describe, expect, test } from "bun:test";
import { pairingFromParsed, parsePairingPayload } from "../src/link/pairing";

describe("parsePairingPayload", (): void => {
  test("url+token pins host and port", (): void => {
    const parsed = parsePairingPayload({ url: "http://192.168.1.20:1234", token: "abc" });
    expect(parsed.host).toBe("192.168.1.20");
    expect(parsed.port).toBe(1234);
    expect(parsed.token).toBe("abc");
  });

  test("empty host does not clobber url host but explicit port overrides url port", (): void => {
    const parsed = parsePairingPayload({
      url: "http://phone.local:5555",
      token: "abc",
      host: "",
      port: 9876,
    });
    expect(parsed.host).toBe("phone.local");
    expect(parsed.port).toBe(9876);
  });

  test("empty host without url means no host", (): void => {
    const parsed = parsePairingPayload({ host: "", token: "abc" });
    expect(parsed.host).toBe("");
    expect(parsed.token).toBe("abc");
    expect(parsed.port).toBeUndefined();
  });

  test("nonempty host overrides url", (): void => {
    const parsed = parsePairingPayload({
      url: "http://phone.local:5555",
      token: "abc",
      host: "10.0.0.8",
      port: 9999,
    });
    expect(parsed.host).toBe("10.0.0.8");
    expect(parsed.port).toBe(9999);
  });

  test("url without port defaults 9876", (): void => {
    const parsed = parsePairingPayload({ url: "http://192.168.1.20", token: "t" });
    expect(parsed.host).toBe("192.168.1.20");
    expect(parsed.port).toBe(9876);
  });

  test("parses JSON string payload into host, port, and token", (): void => {
    const parsed = parsePairingPayload('{"url":"http://10.0.0.2:9876","token":"tok"}');
    expect(parsed.host).toBe("10.0.0.2");
    expect(parsed.port).toBe(9876);
    expect(parsed.token).toBe("tok");
  });

  test("Chrome pairing requires host and token", (): void => {
    expect(pairingFromParsed(parsePairingPayload({ token: "abc" }))).toBeNull();
    expect(pairingFromParsed(parsePairingPayload({ url: "http://10.0.0.2:9876" }))).toBeNull();
    expect(pairingFromParsed(parsePairingPayload({ url: "http://10.0.0.2:9876", token: "abc" }))).toEqual({
      host: "10.0.0.2",
      port: 9876,
      token: "abc",
    });
  });
});
