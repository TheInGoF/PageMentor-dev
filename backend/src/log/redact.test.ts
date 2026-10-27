import { describe, expect, test } from "bun:test";
import { redact, registerSecret } from "./redact";

describe("redact", () => {
  test("registrierte Werte", () => {
    registerSecret("geheimesPasswort123");
    expect(redact("Login mit geheimesPasswort123 ok")).toBe("Login mit *** ok");
  });
  test("Muster", () => {
    expect(redact("Authorization: Bearer abcdefghijklmnop")).toBe("Authorization: Bearer ***");
    expect(redact("key=sk-ant-1234567890abcdef")).toContain("***");
    expect(redact('{"apiKey":"xyz12345"}')).not.toContain("xyz12345");
    expect(redact("hf_abcdefghijklmn token")).toBe("*** token");
  });
  test("harmloser Text bleibt", () => {
    expect(redact("Kapitel 3 fertig in 12 s")).toBe("Kapitel 3 fertig in 12 s");
  });
});
