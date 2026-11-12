// TRUS-2500: branch protection on main requires CI checks by name. GitHub names a
// check after the job's `name:` if it has one, otherwise after its job id (matrix
// jobs add " (<values>)"). Two pull-request jobs with the same check name make a
// required check pass when either one does. A required check that no job produces
// any more leaves every PR waiting forever. These tests catch both before merge.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../.github/workflows", import.meta.url));

// Must match Settings → Branches → main → required status checks (runbook S5).
// Matrix jobs are listed by their base name.
const REQUIRED_CHECKS = ["gitleaks", "supported-runtimes", "unsupported-runtime", "verify-discovery", "verify-scanner"];

// Does the workflow's `on:` run it for pull requests? Handles the block form
// (`on:\n  pull_request:`), the flow form (`on: [pull_request, push]`) and the
// scalar form (`on: pull_request`).
export function runsOnPullRequests(text) {
  const on = /^on:(.*(?:\n(?:[ \t].*|\s*))*)/m.exec(text)?.[1] ?? "";
  return /\bpull_request(_target)?\b/.test(on);
}

// [{ id, check }] for each job under the top-level `jobs:` block. `check` is the
// job's own `name:` (four-space indent, directly under the job), else its id.
export function jobChecks(text) {
  const body = text.split(/^jobs:\s*$/m)[1] ?? "";
  return body
    .split(/^(?= {2}[A-Za-z0-9_-]+:\s*$)/m)
    .map((chunk) => {
      const id = /^ {2}([A-Za-z0-9_-]+):\s*$/m.exec(chunk)?.[1];
      if (!id) return null;
      const name = /^ {4}name:\s*(.+?)\s*$/m.exec(chunk)?.[1]?.replace(/^(["'])(.*)\1$/, "$2");
      return { id, check: name ?? id };
    })
    .filter(Boolean);
}

// Every problem with a set of workflows, as readable strings.
export function problems(workflows, required = REQUIRED_CHECKS) {
  const errors = [];
  const seen = new Map();
  for (const { file, text } of workflows.filter(({ text }) => runsOnPullRequests(text))) {
    for (const { id, check } of jobChecks(text)) {
      if (seen.has(check)) errors.push(`check "${check}" comes from both ${seen.get(check)} and ${file} (job ${id})`);
      else seen.set(check, `${file} (job ${id})`);
    }
  }
  for (const name of required) {
    if (!seen.has(name)) errors.push(`required check "${name}" is not produced by any pull_request job`);
  }
  return errors;
}

// Workflows that produce a check main requires: what gates every merge must not change
// under us. Every action they use is pinned to a full commit SHA, and no step pipes a
// download straight into tar or a shell.
export function gateWorkflows(workflows, required = REQUIRED_CHECKS) {
  return workflows.filter(
    ({ text }) => runsOnPullRequests(text) && jobChecks(text).some(({ check }) => required.includes(check)),
  );
}

export function gateProblems(workflows, required = REQUIRED_CHECKS) {
  const errors = [];
  for (const { file, text } of gateWorkflows(workflows, required)) {
    for (const [, ref] of text.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)) {
      if (!ref.startsWith("./") && !/@[0-9a-f]{40}$/.test(ref)) errors.push(`${file}: ${ref} is not pinned to a commit SHA`);
    }
    if (/\bcurl\b[^\n]*(?:\\\n[^\n]*)*\|\s*(?:sudo\s+)?(?:tar|sh|bash)\b/.test(text)) {
      errors.push(`${file}: pipes a download straight into tar or a shell`);
    }
  }
  return errors;
}

const repoWorkflows = () =>
  readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ file: f, text: readFileSync(join(dir, f), "utf8") }));

test("ci: this repo's pull-request checks are unique and include every required check", () => {
  assert.deepEqual(problems(repoWorkflows()), []);
});

test("ci: workflows behind required checks pin every action and verify what they download", () => {
  assert.deepEqual(gateProblems(repoWorkflows()), []);
});

test("ci: the gitleaks gate checks the binary's sha256 before extracting it", () => {
  const text = readFileSync(join(dir, "secrets-scan.yml"), "utf8");
  const check = text.indexOf("| sha256sum -c -");
  const extract = text.indexOf("tar -xzf");
  assert.ok(check > 0 && extract > check, "sha256sum -c before tar");
  assert.match(text, /GITLEAKS_SHA256: [0-9a-f]{64}\n/);
});

// Fixtures: the rules themselves, so a weakened rule fails here rather than passing quietly.
const wf = (file, on, jobs) => ({ file, text: `name: ${file}\n${on}\njobs:\n${jobs}` });
const PR = "on:\n  pull_request:\n  push:\n    branches: [main]\n";
const REQ = ["a"];

test("ci: a job display name is fine while check names stay unique (#49's build-and-push)", () => {
  const workflows = [
    wf("a.yml", PR, "  a:\n    runs-on: ubuntu-latest\n"),
    wf("b.yml", PR, "  image-build:\n    name: docker build + boot check\n    runs-on: ubuntu-latest\n    steps:\n      - name: step\n"),
  ];
  assert.deepEqual(problems(workflows, REQ), []);
});

test("ci: a display name that repeats another job's id is a duplicate check", () => {
  const workflows = [wf("a.yml", PR, "  a:\n    runs-on: ubuntu-latest\n"), wf("b.yml", PR, "  other:\n    name: a\n")];
  assert.equal(problems(workflows, REQ).length, 1);
});

test("ci: the same job id in two pull-request workflows is a duplicate check", () => {
  const workflows = [wf("a.yml", PR, "  a:\n    runs-on: x\n"), wf("b.yml", PR, "  a:\n    runs-on: x\n")];
  assert.equal(problems(workflows, REQ).length, 1);
});

test("ci: a step's name: or an action input called name is not a job display name", () => {
  const [job] = jobChecks(
    "jobs:\n  a:\n    steps:\n      - name: not-a-check\n        uses: actions/upload-artifact@x\n        with:\n          name: package\n",
  );
  assert.deepEqual(job, { id: "a", check: "a" });
});

test("ci: the flow and scalar forms of on: count as pull-request workflows", () => {
  assert.ok(runsOnPullRequests("on: [pull_request, push]\njobs:\n"));
  assert.ok(runsOnPullRequests("on: pull_request\njobs:\n"));
  assert.ok(!runsOnPullRequests('on:\n  push:\n    tags: ["v*.*.*"]\njobs:\n  pull_request:\n'));
});

test("ci: a required check nobody produces is reported", () => {
  assert.equal(problems([wf("a.yml", PR, "  b:\n    runs-on: x\n")], REQ).length, 1);
});

test("ci: a gate workflow with a tag-pinned action or a curl | tar is reported; a non-gate one is not", () => {
  const gate = (body) => wf("a.yml", PR, `  a:\n    runs-on: x\n    steps:\n${body}`);
  const pinned = "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0\n";
  assert.deepEqual(gateProblems([gate(pinned)], REQ), []);
  assert.equal(gateProblems([gate("      - uses: actions/checkout@v4\n")], REQ).length, 1);
  assert.equal(gateProblems([gate('      - run: |\n          curl -sSL "https://x/y.tgz" \\\n            | sudo tar -xz -C /usr/local/bin y\n')], REQ).length, 1);
  assert.equal(gateProblems([gate("      - run: curl -sSL https://x/i.sh | bash\n")], REQ).length, 1);
  // #49's build-and-push.yml: on pull_request, but produces no required check.
  assert.deepEqual(gateProblems([gate(pinned), wf("b.yml", PR, "  image-build:\n    name: docker build\n    steps:\n      - uses: actions/checkout@v4\n")], REQ), []);
});

test("ci: tag-only workflows (release.yml) don't count towards pull-request checks", () => {
  const workflows = [wf("a.yml", PR, "  a:\n    runs-on: x\n"), wf("release.yml", 'on:\n  push:\n    tags: ["v*.*.*"]\n', "  a:\n    runs-on: x\n")];
  assert.deepEqual(problems(workflows, REQ), []);
});
