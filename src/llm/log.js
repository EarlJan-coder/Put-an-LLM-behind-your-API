import fs from "node:fs";
import path from "node:path";

const LOG_DIR = "logs";

function appendJsonl(file, record) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOG_DIR, file), JSON.stringify(record) + "\n");
}

// Quarantine: model output that failed validation twice. Never guessed over,
// never shown to callers - kept with the input and error so it can be studied.
export function appendQuarantine(record) {
  appendJsonl("quarantine.jsonl", record);
}

// Cost log: one structured line per model call (wired in Stage 4).
export function appendCost(record) {
  appendJsonl("cost.jsonl", record);
}
