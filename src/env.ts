/**
 * `.env` support.
 *
 * This file is deliberately small. Node reads `.env` itself, so there is no parser here;
 * the only decisions are *when* to read a file and *what wins* when a variable is defined
 * in both the environment and the file.
 *
 * A variable already present in the environment always wins. `OPENROUTER_API_KEY=x esac
 * auto` and a CI secret therefore override whatever is on disk, rather than being quietly
 * replaced by a stale `.env`.
 */

import { existsSync } from "node:fs";

/**
 * Load variables from `path` into `process.env`, leaving the existing environment alone.
 *
 * Returns true when a file was read. A missing file is not an error, and neither is a
 * malformed one: the run will name the variable it could not find, which is a more useful
 * message than a parse failure at startup.
 */
export function loadDotEnv(path = ".env"): boolean {
  if (!existsSync(path)) return false;

  const fromEnvironment = new Map(Object.entries(process.env));
  try {
    process.loadEnvFile(path);
  } catch {
    return false;
  }

  // Restore everything that was already set, so the file only fills gaps.
  for (const [key, value] of fromEnvironment) {
    if (value !== undefined) process.env[key] = value;
  }

  return true;
}
