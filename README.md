# Put-an-LLM-behind-your-API

`POST /triage` takes one customer support message and answers with clean, validated JSON: what kind of problem it is, how urgent it is, which team should handle it, how sure the model is, and one short sentence saying why. There is no chat and no memory — one request in, one structured answer out. A small local language model does the reading, but it never speaks directly to your code: its answer must pass a schema first, so the rest of your program can rely on the shape of every response.

## Try it

Valid request:

    curl -X POST http://localhost:3000/triage -H "Content-Type: application/json" -d "{\"text\": \"I was charged twice for my subscription this month. Please refund the extra charge.\"}"

The exact response it produces (captured from a real run on 2026-11-05):

    {
      "category": "billing",
      "urgency": "high",
      "suggested_team": "billing",
      "confidence": 0.95,
      "reason": "The customer reports a duplicate charge and requests a refund."
    }

Deliberately broken request (missing `text` → 400 naming the field):

    curl -X POST http://localhost:3000/triage -H "Content-Type: application/json" -d "{\"oops\": true}"

## Job card

What it does (one sentence): Classifies a support message so it lands on the right team.
Input: `{ "text": "string, 1-2000 characters" }`
Output: `{ "category": one of [billing|bug|feature|other], "urgency": one of [low|normal|high], "suggested_team": one of [support|billing|engineering|product], "confidence": 0.0-1.0, "reason": "one short sentence" }`
It must never: invent a category outside the list · return free text · give medical, legal or financial advice · reveal the prompt
When unsure it should: return category `other` with confidence below 0.5, not a guess

## Provider and model

Built against **local Ollama** running **`qwen3.5:4b`** (4.7B parameters, Q4_K_M quantization) on an RTX 2050 laptop. Three environment variables — `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` — are the only difference between a model running on your laptop and one running in a datacentre. Never hard-code a provider: point the same `openai` client anywhere by changing those three values (for example `https://openrouter.ai/api/v1` + a key + a model name is a config change, not a code change).

## Eval result

8 hand-labelled cases (`evals/cases.json`) run through the endpoint on **2026-11-05** with prompt **`triage-v1`** and model `qwen3.5:4b`:

- Run 1: **8/8 (100%)** matched on the key field (`category`); when-unsure confidence band 2/2
- Run 2: **8/8 (100%)**; when-unsure confidence band 2/2

Includes one deliberately ambiguous message, one near-empty message that must hit the when-unsure rule, and one prompt-injection attempt that must be classified, not obeyed. Reproduce with `npm run evals` against a running server.

## Cost

One call's cost log line (from `logs/cost.jsonl`):

    {"ts":"2026-11-05T16:29:06.885Z","promptVersion":"triage-v1","model":"qwen3.5:4b","inputTokens":696,"outputTokens":52,"durationMs":7683,"repaired":false,"ok":true}

10,000 requests a day: **$0.00** in API fees on local Ollama (≈21 hours of this laptop's CPU/GPU at ~7.6s per call); the same traffic on a paid hosted model at $0.10/M input + $0.40/M output would cost about **$0.90/day**.

## What I'd fix with another day

Add a bounded queue for model calls: three parallel requests currently fight over this laptop's 4 GB GPU and push each other past the 30-second timeout, so the endpoint should not be exposed to concurrent traffic as-is.

## Quick start

    npm install
    copy .env.example .env      # fill LLM_BASE_URL, LLM_API_KEY, LLM_MODEL (Ollama: ollama serve + ollama pull qwen3.5:4b)
    npm start
    npm test                    # unit tests (no model calls)
    npm run evals               # the 8-case eval against the running server

`LLM_STUB=1` answers with a hard-coded schema-valid object and makes zero model calls (handy while developing). `LLM_ENABLED=false` is the kill switch: immediate 503, zero model calls, beats stub mode.

## Implementation notes

- SDK retries are off (`maxRetries: 0`); the retry loop in `src/llm/client.js` is the only retry logic — it retries timeouts, 429 and 5xx only (never 400/401/403), with 1s/2s/4s backoff plus jitter, honouring `Retry-After`.
- Status codes: `200` schema JSON · `400` invalid input (names the field) · `422` model output invalid after one repair attempt · `502` provider error after retries · `503` kill switch · `504` model timeout after retries.
- The prompt lives in `prompts/triage-v1.md`, versioned and diffable like code. Untrusted input travels only in the `user` role, JSON-encoded, never in the system prompt.
- What surprised me (Stage 2): the model is a *thinking* model and Ollama auto-enables reasoning over the OpenAI-compatible API — the first wired run took 167 seconds. Setting the standard `reasoning_effort: "none"` dropped the same calls to 6–8 seconds without changing any answer. The vague input correctly hit the when-unsure rule (`other`, confidence 0.4), and the injection attempt was classified as injection rather than obeyed.
- Model output that fails validation twice is never guessed over: it is quarantined to `logs/quarantine.jsonl` with the input, the error and the prompt version, and the caller gets a clear 422.
