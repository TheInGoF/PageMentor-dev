import { describe, expect, test } from "bun:test";
import { decodeOutput } from "./exec";

describe("decodeOutput", () => {
  test("UTF-16LE von wsl.exe", () => {
    const buf = Buffer.from("PageMentor-Engine\r\nUbuntu\r\n", "utf16le");
    expect(decodeOutput(buf)).toBe("PageMentor-Engine\r\nUbuntu\r\n");
  });
  test("UTF-16LE mit BOM", () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Größe", "utf16le")]);
    expect(decodeOutput(buf)).toBe("Größe");
  });
  test("UTF-8 aus Linux bleibt", () => {
    expect(decodeOutput(Buffer.from("Docker läuft\n", "utf8"))).toBe("Docker läuft\n");
  });
  test("leer", () => {
    expect(decodeOutput(Buffer.alloc(0))).toBe("");
  });
});
