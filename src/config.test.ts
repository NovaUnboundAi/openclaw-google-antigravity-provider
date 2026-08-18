import { describe, expect, it } from "vitest";
import { DEFAULT_PRINT_TIMEOUT, formatGoDuration } from "./config.js";

describe("formatGoDuration", () => {
  it("returns fallback for undefined/null/empty", () => {
    expect(formatGoDuration(undefined)).toBe(DEFAULT_PRINT_TIMEOUT);
    expect(formatGoDuration(undefined, "15m0s")).toBe("15m0s");
    expect(formatGoDuration("")).toBe(DEFAULT_PRINT_TIMEOUT);
    expect(formatGoDuration("   ")).toBe(DEFAULT_PRINT_TIMEOUT);
  });

  it("converts number of seconds to Go duration string", () => {
    expect(formatGoDuration(1800)).toBe("1800s");
    expect(formatGoDuration(900)).toBe("900s");
    expect(formatGoDuration(300)).toBe("300s");
  });

  it("preserves valid Go duration strings", () => {
    expect(formatGoDuration("15m0s")).toBe("15m0s");
    expect(formatGoDuration("30m")).toBe("30m");
    expect(formatGoDuration("1h")).toBe("1h");
    expect(formatGoDuration("600s")).toBe("600s");
  });

  it("parses numeric strings into seconds duration", () => {
    expect(formatGoDuration("1800")).toBe("1800s");
    expect(formatGoDuration("600")).toBe("600s");
  });
});
