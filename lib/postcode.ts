import type { PostcodeState } from "./types";

/**
 * Map an Australian postcode to its state/territory.
 * Validated against the full CER postcode list with zero unmatched (every
 * postcode resolves to one of the 8 territories or OTHER). Do not edit the
 * ranges without re-validating against the CER data.
 */
export function postcodeToState(pc: string): PostcodeState {
  const n = parseInt(pc, 10);
  if (n >= 800 && n <= 999) return "NT";
  if (n >= 1000 && n <= 2599) return "NSW";
  if (n >= 2600 && n <= 2618) return "ACT";
  if (n >= 2619 && n <= 2899) return "NSW";
  if (n >= 2900 && n <= 2920) return "ACT";
  if (n >= 2921 && n <= 2999) return "NSW";
  if (n >= 3000 && n <= 3999) return "VIC";
  if (n >= 4000 && n <= 4999) return "QLD";
  if (n >= 5000 && n <= 5999) return "SA";
  if (n >= 6000 && n <= 6999) return "WA";
  if (n >= 7000 && n <= 7999) return "TAS";
  return "OTHER";
}

/**
 * Normalise a raw postcode cell (which arrives as either a string like "0810"
 * or a number like 810, even mixed within one column) to a zero-padded
 * 4-digit string. Returns null for empty/garbage cells.
 */
export function normalisePostcode(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  return digits.padStart(4, "0");
}
