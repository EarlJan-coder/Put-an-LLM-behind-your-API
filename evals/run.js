// Runs every case in evals/cases.json through POST /triage and prints how
// many matched on the key field (category), plus the failing list. Cases run
// sequentially on purpose: parallel requests fight over a small GPU.
//
//   npm run evals                (server must be running)
//   EVAL_BASE_URL=http://host:port npm run evals
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.EVAL_BASE_URL ?? "http://localhost:3000";
const casesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "cases.json");
const cases = JSON.parse(fs.readFileSync(casesPath, "utf8"));

let matched = 0;
let bandPass = 0;
let bandChecked = 0;
const failures = [];

for (const c of cases) {
  const t0 = Date.now();
  let body;
  let status;
  try {
    const res = await fetch(`${BASE}/triage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(c.input),
    });
    status = res.status;
    body = await res.json();
  } catch (err) {
    status = "ERR";
    body = { error: String(err?.message ?? err) };
  }
  const ms = Date.now() - t0;

  const ok = status === 200 && body.category === c.expected.category;
  if (ok) matched++;

  let band = "-";
  if (c.expect_confidence_below != null) {
    bandChecked++;
    const inBand = body.confidence != null && body.confidence < c.expect_confidence_below;
    if (inBand) bandPass++;
    band = inBand ? "ok" : "MISS";
  }

  console.log(
    `#${c.id} ${ok ? "MATCH" : "FAIL "} exp=${c.expected.category} got=${body.category ?? "-"} ` +
      `conf=${body.confidence ?? "-"} band=${band} ${ms}ms`
  );
  if (!ok) {
    failures.push({ id: c.id, name: c.name, expected: c.expected.category, got: body.category, text: c.input.text });
  }
}

console.log("");
console.log(`matched on category (key field): ${matched}/${cases.length} (${Math.round((matched / cases.length) * 100)}%)`);
if (bandChecked > 0) {
  console.log(`when-unsure confidence band (< 0.5): ${bandPass}/${bandChecked}`);
}
if (failures.length > 0) {
  console.log("failures:");
  for (const f of failures) {
    console.log(`  #${f.id} ${f.name}: expected "${f.expected}", got "${f.got}" - input: ${f.text}`);
  }
}
