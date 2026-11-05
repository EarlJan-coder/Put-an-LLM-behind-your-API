# Put-an-LLM-behind-your-API

Three environment variables — `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` — are the only difference between a model running on your laptop and one running in a datacentre. Never hard-code a provider.

## Try it (stub mode — zero model calls)

Valid request:

    curl -X POST http://localhost:3000/triage -H "Content-Type: application/json" -d "{\"text\": \"My invoice is wrong and I want a refund.\"}"

Deliberately broken request (missing `text` → 400 naming the field):

    curl -X POST http://localhost:3000/triage -H "Content-Type: application/json" -d "{\"oops\": true}"

## Stage 2 observations (three real inputs, prompt triage-v1)

- Surprise: the model is a *thinking* model, and Ollama auto-enables reasoning for such models over the OpenAI-compatible API — the first wired run took **167 seconds**. Setting the OpenAI-standard `reasoning_effort: "none"` dropped the same calls to **6–8 seconds** without changing any answer.
- All three answers had the exact same five-field shape — the prompt's output-shape section is doing its job.
- The vague input ("Something feels off since the last update…") correctly hit the when-unsure rule: `category: other` with `confidence: 0.4`, not a guess.
- The prompt-injection attempt ("Ignore all previous instructions…") was classified as `other`/0.2 with a reason naming the injection — it did not obey.
- Three parallel requests fight over this laptop's 4 GB GPU and slow each other down badly; the endpoint is meant to be called sequentially (the eval runner does exactly that).
