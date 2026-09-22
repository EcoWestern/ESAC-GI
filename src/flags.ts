/**
 * Parsers for the run flags that carry structured values.
 *
 * Kept apart from the CLI so they can be tested directly: the CLI module runs `main()` at
 * import time, so a test that imported it would start a run. Each parser throws on
 * unusable input, and the CLI turns that message into its own error output.
 */

/** Parse an output cap. */
export function parseMaxTokens(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`must be a positive whole number (got "${raw}")`);
  }
  return value;
}

/**
 * Parse a thinking budget into the request shape that separates reasoning from answering.
 *
 * This exists because passing raw JSON through a shell is a quoting minefield, and the one
 * provider parameter worth naming is the one that stops thinking tokens competing with the
 * answer for a single allowance.
 */
export function parseThinkingTokens(raw: string): Record<string, unknown> {
  return { reasoning: { max_tokens: parseMaxTokens(raw) } };
}

/** Parse a raw JSON object to merge into each model request. */
export function parseExtraBody(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`must be a JSON object (got "${raw}")`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`must be a JSON object (got "${raw}")`);
  }
  return parsed as Record<string, unknown>;
}
