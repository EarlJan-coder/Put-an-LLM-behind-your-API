# Put-an-LLM-behind-your-API

Three environment variables — `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` — are the only difference between a model running on your laptop and one running in a datacentre. Never hard-code a provider.

## Try it (stub mode — zero model calls)

Valid request:

    curl -X POST http://localhost:3000/triage -H "Content-Type: application/json" -d "{\"text\": \"My invoice is wrong and I want a refund.\"}"

Deliberately broken request (missing `text` → 400 naming the field):

    curl -X POST http://localhost:3000/triage -H "Content-Type: application/json" -d "{\"oops\": true}"
