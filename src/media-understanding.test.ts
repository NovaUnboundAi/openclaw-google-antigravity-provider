import { describe, expect, it } from "vitest";
import {
  buildAntigravityMediaUnderstandingProvider,
  _test,
} from "./media-understanding.js";

describe("media-understanding helpers", () => {
  it("sanitises filenames to a safe basename", () => {
    expect(_test.safeFileName("normal.png")).toBe("normal.png");
    expect(_test.safeFileName("/etc/passwd")).toBe("_etc_passwd");
    expect(_test.safeFileName("weird name (1).jpg")).toBe("weird_name_1_.jpg");
    expect(_test.safeFileName("")).toBe("image.bin");
  });

  it("maps common image mimes to extensions and prefers an explicit filename ext", () => {
    expect(_test.extForMime("image/png")).toBe(".png");
    expect(_test.extForMime("image/jpeg")).toBe(".jpg");
    expect(_test.extForMime("image/heic")).toBe(".heic");
    expect(_test.extForMime(undefined, "cover.webp")).toBe(".webp");
    expect(_test.extForMime()).toBe(".bin");
  });

  it("extractProse reassembles agy stream-json event lines into a single prose block", () => {
    const stdout = [
      '{"type":"text_start"}',
      '{"type":"text_delta","delta":"Hello, "}',
      '{"type":"text_delta","delta":"this is an image "}',
      '{"type":"text_delta","delta":"of a red apple."}',
      '{"type":"message_end"}',
    ].join("\n");
    expect(_test.extractProse(stdout)).toBe(
      "Hello, \nthis is an image \nof a red apple.",
    );
  });

  it("extractProse falls through to plain-text stdout when agy runs in text mode", () => {
    const stdout = "A cat sits on a green couch.\nThe lighting is soft.";
    expect(_test.extractProse(stdout)).toBe(
      "A cat sits on a green couch.\nThe lighting is soft.",
    );
  });
});

describe("buildAntigravityMediaUnderstandingProvider", () => {
  it("advertises image capability with an agy-supported default vision model", () => {
    const provider = buildAntigravityMediaUnderstandingProvider();
    expect(provider.id).toBe("google-antigravity-cli");
    expect(provider.capabilities).toEqual(["image"]);
    expect(provider.defaultModels?.image).toMatch(/^gemini-/);
    expect(typeof provider.describeImage).toBe("function");
    expect(typeof provider.describeImages).toBe("function");
  });
});
