export const DEFAULT_PRINT_TIMEOUT = "30m0s";

/**
 * Format a number (seconds) or string duration into a valid Go duration string for agy --print-timeout.
 */
export function formatGoDuration(
  value: number | string | undefined,
  fallback = DEFAULT_PRINT_TIMEOUT,
): string {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "number") {
    if (value <= 0 || !Number.isFinite(value)) {
      return fallback;
    }
    return `${Math.floor(value)}s`;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  if (/^(\d+(\.\d+)?(ns|us|µs|ms|s|m|h))+$/i.test(trimmed)) {
    return trimmed;
  }
  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric) && numeric > 0) {
    return `${Math.floor(numeric)}s`;
  }
  return fallback;
}
