/**
 * Built-in model and judge adapters.
 *
 * Every adapter throws `InfrastructureError` for transport-level problems so the
 * runner can distinguish "the evaluation could not be completed" from "the model
 * answered wrongly" (resolution 8). An HTTP 429, a 500, or a socket reset is
 * infrastructure. A 200 response containing a refusal is not.
 */

import { InfrastructureError, ModelTruncatedError } from "./types.ts";
import { OUTPUT_LIMITS } from "./version.ts";
import type { JudgeAdapter, JudgeInput, JudgeResponse, ModelAdapter, ModelRequest, ModelResponse } from "./types.ts";
import type { Rng } from "./rng.ts";

// ---------------------------------------------------------------------------
// Oracle: a self-test adapter
// ---------------------------------------------------------------------------

export interface OracleOptions {
  /** Probability of emitting the correct answer. 1 = perfect run. */
  readonly accuracy?: number;
  /** Probability of emitting a deliberately wrong but well-formed answer. */
  readonly modelFailureRate?: number;
  readonly seed?: number;
  /**
   * Answers supplied by the harness when it can compute them. The oracle uses these
   * to simulate a model of a given accuracy without needing a real API.
   */
  readonly keyed?: ReadonlyMap<string, string>;
}

/**
 * Deterministic oracle used by the test suite and by `--dry-run`.
 *
 * It exists so the harness itself can be verified end-to-end (ordering, retries,
 * replication, scoring, thresholds) without network access or API spend.
 */
export function createOracleAdapter(options: OracleOptions = {}): ModelAdapter & {
  answerKey: Map<string, string>;
} {
  const accuracy = options.accuracy ?? 1;
  const failureRate = options.modelFailureRate ?? 0;
  const answerKey = new Map<string, string>();

  let counter = 0;

  return {
    id: "oracle",
    answerKey,
    async complete(req: ModelRequest): Promise<ModelResponse> {
      counter++;
      const deterministic = (counter * 2654435761) % 1000 / 1000;

      if (deterministic < failureRate) {
        return { text: "", promptTokens: 0, completionTokens: 0, model: "oracle" };
      }

      // The oracle answers from the key the harness populated from the instance
      // checks, which is why it can be accurate without being clever.
      const answer = answerKey.get(req.prompt);
      if (answer === undefined) {
        return { text: "I cannot answer that.", promptTokens: 10, completionTokens: 5, model: "oracle" };
      }

      if (deterministic > accuracy) {
        // Well-formed but wrong: a plausible-looking non-answer.
        return { text: "A", promptTokens: 10, completionTokens: 1, model: "oracle" };
      }

      return { text: answer, promptTokens: 20, completionTokens: 8, model: "oracle" };
    },
  };
}

/**
 * Populate an oracle's answer key from a set of instances and a generator that
 * produces reference answers. Used only for self-testing.
 */
export function primeOracle(
  oracle: { answerKey: Map<string, string> },
  instances: readonly { prompt: string; reference?: string }[],
): void {
  for (const instance of instances) {
    if (instance.reference !== undefined) oracle.answerKey.set(instance.prompt, instance.reference);
  }
}

// ---------------------------------------------------------------------------
// Judge oracle
// ---------------------------------------------------------------------------

/**
 * A judge that returns a fixed fraction, or a scripted sequence of fractions.
 *
 * Carries no opinions. Its purpose is to make the 2x2 replication protocol
 * observable in tests: with a scripted sequence you can verify that four
 * observations are collected and averaged.
 */
export function createOracleJudge(options: {
  readonly scores?: readonly number[];
  readonly fixedFraction?: number;
  readonly malformRate?: number;
} = {}): JudgeAdapter {
  let index = 0;
  const fixed = options.fixedFraction ?? 0.75;
  const malformRate = options.malformRate ?? 0;

  return {
    id: "oracle-judge",
    async score(input: JudgeInput): Promise<JudgeResponse> {
      const call = index++;
      const roll = ((call * 40503) % 100) / 100;

      if (roll < malformRate) {
        // Unparseable output, to exercise the infrastructure-retry path.
        return { raw: "I think the response is quite good overall." };
      }

      const criterionScores: Record<string, number> = {};
      for (const criterion of input.rubric.criteria) {
        const scripted = options.scores?.[call % (options.scores.length || 1)];
        const fraction = scripted ?? fixed;
        criterionScores[criterion.id] = Math.round(fraction * 4);
      }

      return { scores: criterionScores, raw: JSON.stringify(criterionScores) };
    },
  };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible HTTP adapter
// ---------------------------------------------------------------------------

export interface HttpAdapterOptions {
  readonly id: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly extraBody?: Readonly<Record<string, unknown>>;
  /** Milliseconds before the request is treated as an infrastructure failure. */
  readonly timeoutMs?: number;
}

/**
 * Any OpenAI-compatible chat-completions endpoint.
 *
 * Covers OpenAI, DeepSeek, Groq, Together, OpenRouter, vLLM, Ollama, LM Studio, and
 * llama.cpp's server, which is what makes the "no single vendor grades anyone"
 * requirement practically satisfiable: the judge can be a locally-hosted open-weight
 * model, or an open-weight model reached through an aggregator, using this same
 * adapter with no provider-specific code. An aggregator such as OpenRouter is the
 * recommended route for a hosted judge, since it serves the pinned judges and the
 * model under test behind one key.
 *
 * Retries are NOT performed here. The runner owns retry policy so that retry counts
 * are recorded uniformly across adapters.
 */
export function createHttpAdapter(options: HttpAdapterOptions): ModelAdapter & JudgeAdapter {
  const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  async function post(body: unknown, timeoutMs: number): Promise<{ status: number; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      return { status: response.status, text };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    id: options.id,

    async complete(req: ModelRequest): Promise<ModelResponse> {
      let result: { status: number; text: string };
      try {
        result = await post(
          {
            model: options.model,
            messages: [
              ...(req.system ? [{ role: "system", content: req.system }] : []),
              { role: "user", content: req.prompt },
            ],
            temperature: req.temperature,
            top_p: req.topP,
            max_tokens: req.maxTokens,
            ...(options.extraBody ?? {}),
          },
          options.timeoutMs ?? 120_000,
        );
      } catch (err) {
        // Transport-level problem: no valid response was obtained.
        throw new InfrastructureError(`model transport failure: ${String(err)}`, err);
      }

      if (result.status < 200 || result.status >= 300) {
        throw new InfrastructureError(`model returned HTTP ${result.status}: ${truncate(result.text, 300)}`);
      }

      const parsed = parseChatCompletion(result.text);
      if (parsed === null) {
        throw new InfrastructureError(`model returned an unparseable body: ${truncate(result.text, 300)}`);
      }

      // No content together with finish_reason "length" means the cap was reached while
      // the model was still working. That is a model failure, not an outage, and it is not
      // worth retrying, so it is raised as such rather than passed on as an empty answer.
      if (parsed.content.trim().length === 0 && parsed.finishReason === "length") {
        throw new ModelTruncatedError(
          `model hit the ${req.maxTokens}-token output cap before answering`,
          { promptTokens: parsed.promptTokens, completionTokens: parsed.completionTokens },
        );
      }

      return {
        text: parsed.content,
        promptTokens: parsed.promptTokens,
        completionTokens: parsed.completionTokens,
        model: options.model,
      };
    },

    async score(input: JudgeInput): Promise<JudgeResponse> {
      // Built here rather than imported so this file stays free of judge internals.
      const { renderJudgePrompt } = await import("./judge.ts");
      const prompt = renderJudgePrompt(input.rubric, input.taskPrompt, input.response);

      let result: { status: number; text: string };
      try {
        result = await post(
          {
            model: options.model,
            messages: [{ role: "user", content: prompt }],
            temperature: input.temperature,
            top_p: input.topP,
            max_tokens: OUTPUT_LIMITS.judgeTokens,
            response_format: { type: "json_object" },
            ...(options.extraBody ?? {}),
          },
          options.timeoutMs ?? 120_000,
        );
      } catch (err) {
        throw new InfrastructureError(`judge transport failure: ${String(err)}`, err);
      }

      if (result.status < 200 || result.status >= 300) {
        throw new InfrastructureError(`judge returned HTTP ${result.status}: ${truncate(result.text, 300)}`);
      }

      const parsed = parseChatCompletion(result.text);
      if (parsed === null) {
        throw new InfrastructureError(`judge returned an unparseable body: ${truncate(result.text, 300)}`);
      }

      return { raw: parsed.content };
    },
  };
}

interface ChatCompletion {
  readonly content: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Why the provider stopped, when it says so. "length" means the output cap was hit. */
  readonly finishReason: string | null;
}

function parseChatCompletion(body: string): ChatCompletion | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }

  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;

  const choices = root["choices"];
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as Record<string, unknown> | undefined;
  if (!first) return null;

  const message = first["message"] as Record<string, unknown> | undefined;
  let content: unknown = message?.["content"] ?? first["text"];

  // Some providers return content as an array of parts.
  if (Array.isArray(content)) {
    content = content
      .map((part) => (part && typeof part === "object" ? (part as Record<string, unknown>)["text"] : ""))
      .filter((t): t is string => typeof t === "string")
      .join("");
  }

  // A finished choice with no content is an empty answer, which the item grades as a
  // failure. Returning null here would instead report a well-formed response as an
  // unparseable body and retry a deterministic outcome five times.
  const text = typeof content === "string" ? content : "";

  const usage = root["usage"] as Record<string, unknown> | undefined;
  const finishReason =
    typeof first["finish_reason"] === "string" ? (first["finish_reason"] as string) : null;
  return {
    content: text,
    finishReason,
    promptTokens: typeof usage?.["prompt_tokens"] === "number" ? (usage["prompt_tokens"] as number) : 0,
    completionTokens:
      typeof usage?.["completion_tokens"] === "number" ? (usage["completion_tokens"] as number) : 0,
  };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

/** Deterministic RNG export kept for adapters that need jitter. */
export type { Rng };
