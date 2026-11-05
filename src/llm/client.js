import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

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
  });
}

// Stage 2 shape: returns raw model text. Stage 4 refactors this to return
// { text, usage, durationMs } with timeout and retries. `messages` (used by
// the repair retry) replaces the built [system, user] pair when present.
export async function callModel({ system, user, messages }) {
  const client = createClient();
  const res = await client.chat.completions.create({
    model: process.env.LLM_MODEL,
    temperature: 0,
    messages: messages ?? [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    // OpenAI-standard field that maps to the provider's reasoning level.
    // "none" disables thinking-mode reasoning: Ollama auto-enables thinking
    // on capable models otherwise (its OpenAI-compat layer ignores the
    // native `think` field - verified). Measured 167s with thinking vs 10s
    // without, same correct answer on this hardware.
    reasoning_effort: "none",
  });
  return res.choices[0].message.content;
}
