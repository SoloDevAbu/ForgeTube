import { existsSync } from "node:fs";

const CANDIDATE_WINDOWS_BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

/**
 * Finds a suitable local browser executable for Remotion rendering.
 */
export function getLocalBrowserExecutable(): string | undefined {
  for (const candidate of CANDIDATE_WINDOWS_BROWSERS) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}
