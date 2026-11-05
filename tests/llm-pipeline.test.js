// Route-level tests for the paths unit tests cannot reach: the repair ->
// 422 -> quarantine flow, retry discipline, and the timeout mapping. A local
// mock LLM provider stands in for Ollama - no model calls, no quota.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import { app } from "../src/app.js";

function startMockLlm(handler) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const body = JSON.parse(data || "{}");
      hits.push(body);
      const reply = handler(body, hits.length);
      if (reply && typeof reply.then === "function") return; // never answers
      res.writeHead(reply.status ?? 200, {
        "content-type": "application/json",
        ...(reply.headers ?? {}),
      });
      res.end(JSON.stringify(reply.body));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, hits, baseURL: `http://127.0.0.1:${server.address().port}/v1` });
    });
  });
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function withSetup(env, fn) {
  const mock = await startMockLlm(env.mockHandler);
  const api = await listen(app);
  const saved = {};
  for (const [k, v] of Object.entries(env.vars)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  process.env.LLM_BASE_URL = mock.baseURL;
  process.env.LLM_MODEL = "mock-model";
  process.env.LLM_API_KEY = "test-key";
  try {
    await fn(`http://127.0.0.1:${api.address().port}`, mock);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_API_KEY;
    api.close();
    mock.server.close();
  }
}

function post(base, body) {
  return fetch(`${base}/triage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const openAiReply = (content) => ({
  body: {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  },
});

test("model output failing twice -> 422 with no raw model text, plus a quarantine line", async () => {
  const quarantinePath = "logs/quarantine.jsonl";
  const before = fs.existsSync(quarantinePath) ? fs.readFileSync(quarantinePath, "utf8").split("\n").filter(Boolean).length : 0;
  await withSetup(
    {
      vars: {},
      mockHandler: () => openAiReply('{"a": XXLEAK }'),
    },
    async (base) => {
      const res = await post(base, { text: "hello world" });
      assert.equal(res.status, 422);
      const body = await res.json();
      assert.ok(
        !JSON.stringify(body).includes("XXLEAK"),
        `422 must not echo raw model text: ${JSON.stringify(body)}`
      );
    }
  );
  const after = fs.readFileSync(quarantinePath, "utf8").split("\n").filter(Boolean).length;
  assert.equal(after, before + 1, "one quarantine line must be appended");
  const last = JSON.parse(fs.readFileSync(quarantinePath, "utf8").trim().split("\n").pop());
  assert.equal(last.promptVersion, "triage-v1");
  assert.deepEqual(last.input, { text: "hello world" });
  assert.ok(typeof last.error === "string" && last.error.length > 0);
  assert.ok(last.rawOutput.includes("XXLEAK"), "quarantine keeps the raw output");
});

test("illegal enum value twice -> 422 whose detail never echoes the model's value", async () => {
  await withSetup(
    {
      vars: {},
      mockHandler: () => openAiReply('{"category": "banana", "urgency": "high", "suggested_team": "billing", "confidence": 0.9, "reason": "x"}'),
    },
    async (base) => {
      const res = await post(base, { text: "hello world" });
      assert.equal(res.status, 422);
      const body = await res.json();
      assert.ok(!JSON.stringify(body).includes("banana"), `422 must not echo the model's value: ${JSON.stringify(body)}`);
    }
  );
});

test("401 from the provider is never retried (exactly one hit)", async () => {
  await withSetup(
    {
      vars: {},
      mockHandler: () => ({ status: 401, body: { error: "bad key" } }),
    },
    async (base, mock) => {
      const res = await post(base, { text: "hello world" });
      assert.equal(res.status, 502);
      assert.equal(mock.hits.length, 1);
    }
  );
});

test("429 with Retry-After is retried and waits for it", async () => {
  await withSetup(
    {
      vars: { LLM_MAX_RETRIES: "2" },
      mockHandler: () => ({ status: 429, headers: { "retry-after": "1" }, body: { error: "slow down" } }),
    },
    async (base, mock) => {
      const t0 = Date.now();
      const res = await post(base, { text: "hello world" });
      const elapsed = Date.now() - t0;
      assert.equal(res.status, 502);
      assert.equal(mock.hits.length, 3, "initial attempt + 2 retries");
      assert.ok(elapsed >= 2000, `Retry-After: 1 twice must take >= 2s, took ${elapsed}ms`);
    }
  );
});

test("a provider slower than the timeout ends as 504, not a hang", { timeout: 8000 }, async () => {
  await withSetup(
    {
      vars: { LLM_TIMEOUT_MS: "150", LLM_MAX_RETRIES: "1" },
      mockHandler: () => {
        return new Promise(() => {}); // never answers
      },
    },
    async (base) => {
      const t0 = Date.now();
      const res = await post(base, { text: "hello world" });
      assert.equal(res.status, 504);
      assert.ok(Date.now() - t0 < 6000, "must fail fast via LLM_TIMEOUT_MS, not the 30s default");
    }
  );
});
