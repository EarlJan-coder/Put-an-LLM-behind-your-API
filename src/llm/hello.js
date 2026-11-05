import OpenAI from "openai";

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL, // Ollama: http://localhost:11434/v1/
  apiKey: process.env.LLM_API_KEY, // Ollama: the literal string "ollama" (required but ignored)
});

const res = await client.chat.completions.create({
  model: process.env.LLM_MODEL, // "qwen3.5:4b"
  messages: [{ role: "user", content: "Reply with exactly the word: ready" }],
});

console.log(res.choices[0].message.content);
