import { test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";
import { OutputSchema, STUB_OUTPUT } from "../src/llm/schema.js";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function withServer(fn) {
  const server = await listen(app);
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

function post(base, body) {
  return fetch(`${base}/triage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("POST /triage without text returns 400 naming the field", async () => {
  await withServer(async (base) => {
    const res = await post(base, {});
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.field, "text");
    assert.equal(typeof body.error, "string");
  });
});

test("POST /triage with wrong text type returns 400 naming the field", async () => {
  await withServer(async (base) => {
    const res = await post(base, { text: 42 });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).field, "text");
  });
});

test("POST /triage with 2001-character text returns 400 naming the field", async () => {
  await withServer(async (base) => {
    const res = await post(base, { text: "a".repeat(2001) });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).field, "text");
  });
});

test("LLM_STUB=1 returns 200 with a schema-valid body", async () => {
  process.env.LLM_STUB = "1";
  try {
    await withServer(async (base) => {
      const res = await post(base, { text: "My invoice is wrong and I want a refund." });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(OutputSchema.safeParse(body).success, true);
    });
  } finally {
    delete process.env.LLM_STUB;
  }
});

test("STUB_OUTPUT satisfies OutputSchema", () => {
  assert.equal(OutputSchema.safeParse(STUB_OUTPUT).success, true);
});

test("POST /triage with an unparseable JSON body returns 400, not a stack trace", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/triage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(typeof body.error, "string");
  });
});

// --- Stage 3: parse, validate, repair ---

import { parseModelOutput } from "../src/llm/parse.js";
import { buildRepairMessages } from "../src/llm/repair.js";

const GOOD = {
  category: "bug",
  urgency: "high",
  suggested_team: "engineering",
  confidence: 0.9,
  reason: "Something is broken.",
};

test("parseModelOutput parses a plain JSON object", () => {
  const result = parseModelOutput(JSON.stringify(GOOD));
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, GOOD);
});

test("parseModelOutput parses JSON wrapped in a code fence", () => {
  const result = parseModelOutput("```json\n" + JSON.stringify(GOOD) + "\n```");
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, GOOD);
});

test("parseModelOutput parses JSON preceded by prose", () => {
  const result = parseModelOutput('Sure! Here is the JSON:\n' + JSON.stringify(GOOD));
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, GOOD);
});

test("parseModelOutput rejects garbage", () => {
  const result = parseModelOutput("I cannot answer that.");
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, "string");
  assert.equal(result.raw, "I cannot answer that.");
});

test("parseModelOutput rejects a category outside the closed list", () => {
  const result = parseModelOutput(JSON.stringify({ ...GOOD, category: "banana" }));
  assert.equal(result.ok, false);
  assert.match(result.error, /category/);
});

test("parseModelOutput rejects confidence above 1", () => {
  const result = parseModelOutput(JSON.stringify({ ...GOOD, confidence: 2 }));
  assert.equal(result.ok, false);
  assert.match(result.error, /confidence/);
});

test("buildRepairMessages contains the exact validation error and the correction instruction", () => {
  const messages = buildRepairMessages({
    system: "SYSTEM PROMPT",
    user: '{"text":"hi"}',
    broken: "{not json",
    error: "category: Invalid enum value",
  });
  assert.equal(messages[0].role, "system");
  assert.equal(messages[0].content, "SYSTEM PROMPT");
  const all = JSON.stringify(messages);
  assert.match(all, /category: Invalid enum value/);
  assert.match(all, /Return only corrected JSON matching the schema\./);
});

// --- Stage 4: timeout, retry policy, cost logging, kill switch ---

import { shouldRetry } from "../src/llm/retry.js";

test("shouldRetry is true for 429, 5xx, and timeouts", () => {
  assert.equal(shouldRetry({ status: 429 }), true);
  assert.equal(shouldRetry({ status: 503 }), true);
  assert.equal(shouldRetry({ status: 500 }), true);
  assert.equal(shouldRetry({ name: "APIConnectionTimeoutError" }), true);
  assert.equal(shouldRetry({ code: "ETIMEDOUT" }), true);
});

test("shouldRetry is false for 400, 401, and 403", () => {
  assert.equal(shouldRetry({ status: 400 }), false);
  assert.equal(shouldRetry({ status: 401 }), false);
  assert.equal(shouldRetry({ status: 403 }), false);
});

test("LLM_ENABLED=false returns 503 before anything else, even with LLM_STUB=1", async () => {
  process.env.LLM_ENABLED = "false";
  process.env.LLM_STUB = "1";
  try {
    await withServer(async (base) => {
      const res = await post(base, { text: "My invoice is wrong." });
      assert.equal(res.status, 503);
    });
  } finally {
    delete process.env.LLM_ENABLED;
    delete process.env.LLM_STUB;
  }
});

// --- Final review fixes ---

test("parseModelOutput never echoes the raw model text in its error", () => {
  const raw = '{"a": XXLEAK }';
  const result = parseModelOutput(raw);
  assert.equal(result.ok, false);
  assert.ok(!result.error.includes("XXLEAK"), `error must not echo raw output: ${result.error}`);
});

test("shouldRetry never retries a 400 even when the message mentions a timeout", () => {
  assert.equal(shouldRetry({ status: 400, message: "request timed out" }), false);
  assert.equal(shouldRetry({ status: 401, message: "connect timed out" }), false);
});

test("POST /triage accepts text of exactly 2000 characters", async () => {
  process.env.LLM_STUB = "1";
  try {
    await withServer(async (base) => {
      const res = await post(base, { text: "a".repeat(2000) });
      assert.equal(res.status, 200);
    });
  } finally {
    delete process.env.LLM_STUB;
  }
});

test("oversized request body returns 413, not 500", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/triage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "a".repeat(200000) }),
    });
    assert.equal(res.status, 413);
  });
});

test("errorHandler logs unexpected errors before answering 500", async () => {
  const { errorHandler } = await import("../src/app.js");
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args);
  try {
    const res = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    errorHandler(new Error("boom"), {}, res, () => {});
    assert.equal(res.statusCode, 500);
    assert.equal(logged.length, 1);
  } finally {
    console.error = original;
  }
});
