import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { shouldRetry, nextBackoffMs } from "./retry.js";
import { appendCost } from "./log.js";

export const PROMPT_VERSION = "triage-v1";

const PROMPT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "prompts",
  "triage-v1.md"
);

export function loadPrompt() {
  return fs.readFileSync(PROMPT_PATH, "utf8");
}

export function createClient() {
  return new OpenAI({
    baseURL: process.env.LLM_BASE_URL,
    apiKey: process.env.LLM_API_KEY,
    // A real timeout: the SDK default is ten minutes. And the SDK must not
    // retry on its own (maxRetries: 0) - the loop in callModel is the only
    // retry logic in this codebase.
    timeout: 30000,
    maxRetries: 0,
  });
}

const MAX_RETRIES = 3; // waits of 1s, 2s, 4s between attempts

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Returns { text, usage: { inputTokens, outputTokens }, durationMs }.
// Every successful call is written to the cost log; so is a call that
// exhausted its retries.
export async function callModel({ system, user, messages, repaired = false }) {
  const built = messages ?? [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  const client = createClient();
  const model = process.env.LLM_MODEL;
  const started = Date.now();

  const log = (ok, usage) =>
    appendCost({
      ts: new Date().toISOString(),
      promptVersion: PROMPT_VERSION,
      model,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      durationMs: Date.now() - started,
      repaired,
      ok,
    });

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await client.chat.completions.create({
        model,
        temperature: 0,
        messages: built,
        // OpenAI-standard field that maps to the provider's reasoning level.
        // "none" disables thinking-mode reasoning: Ollama auto-enables
        // thinking on capable models otherwise. Measured 167s with thinking
        // vs 10s without, same correct answer on this hardware.
        reasoning_effort: "none",
      });
      const usage = {
        inputTokens: res.usage?.prompt_tokens ?? null,
        outputTokens: res.usage?.completion_tokens ?? null,
      };
      log(true, usage);
      return { text: res.choices[0].message.content, usage, durationMs: Date.now() - started };
    } catch (err) {
      lastErr = err;
      if (attempt >= MAX_RETRIES || !shouldRetry(err)) break;
      await sleep(nextBackoffMs(attempt, err));
    }
  }
  log(false, null);
  throw lastErr;
}
