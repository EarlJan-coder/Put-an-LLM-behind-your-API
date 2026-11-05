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
