// TRUS-2500: branch protection on main requires CI checks by name. GitHub names
// a check after its job id (plus the matrix values), so two PR workflows with the
// same job id produce two checks with one name, and a required check by that name
// passes when either one does. A renamed job leaves its required check waiting
// forever, which blocks every PR. These tests catch both before merge.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../.github/workflows", import.meta.url));

// Must match Settings → Branches → main → required status checks (runbook S5).
// Matrix jobs report as "<job id> (<value>)", so only the job id is listed here.
const REQUIRED_JOB_IDS = [
  "gitleaks",
  "supported-runtimes",
  "unsupported-runtime",
  "verify-discovery",
  "verify-scanner",
];

// Job ids are the two-space-indented keys under the top-level `jobs:` block.
function jobIds(text) {
  const body = text.split(/^jobs:\s*$/m)[1] ?? "";
  return [...body.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)].map((m) => m[1]);
}

function prWorkflows() {
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ file: f, text: readFileSync(join(dir, f), "utf8") }))
    .filter(({ text }) => /^\s{2}pull_request:/m.test(text));
}

test("ci: no job sets a display name, so the check name is the job id", () => {
  for (const { file, text } of prWorkflows()) {
    const body = text.split(/^jobs:\s*$/m)[1] ?? "";
    assert.doesNotMatch(body, /^ {4}name:/m, `${file} sets a job-level name:`);
  }
});

test("ci: every job that runs on pull requests has a unique check name", () => {
  const seen = new Map();
  for (const { file, text } of prWorkflows()) {
    for (const id of jobIds(text)) {
      assert.ok(!seen.has(id), `job "${id}" is in both ${seen.get(id)} and ${file}`);
      seen.set(id, file);
    }
  }
});

test("ci: every check main requires is produced by a pull-request workflow", () => {
  const ids = new Set(prWorkflows().flatMap(({ text }) => jobIds(text)));
  for (const id of REQUIRED_JOB_IDS) {
    assert.ok(ids.has(id), `required check "${id}" has no pull_request job`);
  }
});
