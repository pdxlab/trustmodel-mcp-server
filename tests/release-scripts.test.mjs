// TRUS-2500: release.yml keeps its decisions in scripts/release so they can be
// tested here against stub npm / curl, without a tag or a real publish.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// fileURLToPath, not .pathname: .pathname keeps %20, so a checkout path with a
// space made every test fail with ENOENT.
const root = fileURLToPath(new URL("..", import.meta.url));
const release = join(root, "scripts/release");
const workflow = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");

const PKG = "@trustmodel/mcp-server";
const NAME = "io.github.pdxlab/trustmodel-mcp";
const REPO_ID = "1187674238";
const SHA = "2d3137164476a90a92bba1a9b7af7dfb236e6e4b";

function stubDir(stubs) {
  const dir = mkdtempSync(join(tmpdir(), "release-stub-"));
  for (const [name, body] of Object.entries(stubs)) {
    const file = join(dir, name);
    writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(file, 0o755);
  }
  return dir;
}

function run(script, args, { stubs = {}, env = {} } = {}) {
  const dir = stubDir(stubs);
  const result = spawnSync("bash", [join(release, script), ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, STUB_DIR: dir, RELEASE_SLEEP: "true", ...env },
  });
  const log = (() => {
    try {
      return readFileSync(join(dir, "calls.log"), "utf8");
    } catch {
      return "";
    }
  })();
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr, log };
}

// npm stub: logs its arguments, then answers from STUB_* env vars.
const npmStub = `echo "npm $*" >> "$STUB_DIR/calls.log"
printf '%s' "\${STUB_STDOUT:-}"
printf '%s' "\${STUB_STDERR:-}" >&2
exit "\${STUB_RC:-0}"`;

// curl stub: writes STUB_BODY to the --output file, prints STUB_STATUS as %{http_code}.
const curlStub = `echo "curl $*" >> "$STUB_DIR/calls.log"
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then out=$2; shift; fi
  shift
done
[ -n "$out" ] && printf '%s' "\${STUB_BODY:-}" > "$out"
[ "\${STUB_RC:-0}" -ne 0 ] && { echo "curl: (6) Could not resolve host" >&2; exit "$STUB_RC"; }
printf '%s' "\${STUB_STATUS:-200}"`;

const E404 = "npm error code E404\nnpm error 404 No match found for version 0.2.3\n";

// ---------- check-tag.mjs ----------

function repoFixture(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "release-tag-"));
  const files = {
    "package.json": { name: PKG, version: "0.2.3", mcpName: NAME },
    "server.json": { name: NAME, version: "0.2.3", packages: [{ identifier: PKG, version: "0.2.3" }] },
    "manifest.json": { version: "0.2.3" },
  };
  for (const [file, patch] of Object.entries(overrides)) files[file] = { ...files[file], ...patch };
  for (const [file, body] of Object.entries(files)) writeFileSync(join(dir, file), JSON.stringify(body));
  return dir;
}

function checkTag(tag, dir) {
  const result = spawnSync(process.execPath, [join(release, "check-tag.mjs"), tag, dir], { encoding: "utf8" });
  return { status: result.status, stderr: result.stderr };
}

test("check-tag: passes when every version field equals the tag", () => {
  assert.equal(checkTag("v0.2.3", repoFixture()).status, 0);
});

test("check-tag: passes for this repo at its own package.json version", () => {
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const result = checkTag(`v${version}`, root);
  assert.equal(result.status, 0, result.stderr);
});

test("check-tag: a tag that differs from the versions names all four fields", () => {
  const { status, stderr } = checkTag("v9.9.9", repoFixture());
  assert.equal(status, 1);
  for (const field of ["package.json version", "server.json version", "server.json packages[0].version", "manifest.json version"]) {
    assert.match(stderr, new RegExp(field.replace(/[.[\]]/g, "\\$&")));
  }
});

test("check-tag: one stale file is named on its own", () => {
  const { status, stderr } = checkTag("v0.2.3", repoFixture({ "manifest.json": { version: "0.2.2" } }));
  assert.equal(status, 1);
  assert.match(stderr, /manifest\.json version is "0\.2\.2"/);
  assert.doesNotMatch(stderr, /server\.json version/);
});

test("check-tag: mcpName must equal server.json name", () => {
  const { status, stderr } = checkTag("v0.2.3", repoFixture({ "package.json": { mcpName: "io.github.karlmehta/trustmodel-mcp" } }));
  assert.equal(status, 1);
  assert.match(stderr, /mcpName/);
});

test("check-tag: packages[0].identifier must equal package.json name", () => {
  const dir = repoFixture({ "server.json": { packages: [{ identifier: "@other/pkg", version: "0.2.3" }] } });
  const { status, stderr } = checkTag("v0.2.3", dir);
  assert.equal(status, 1);
  assert.match(stderr, /identifier/);
});

test("check-tag: rejects tags that are not vX.Y.Z", () => {
  for (const tag of ["0.2.3", "v0.2", "v0.2.3-test", "v0.2.3.4", ""]) {
    assert.equal(checkTag(tag, repoFixture()).status, 1, tag);
  }
});

// ---------- npm-state.sh ----------

test("npm-state: our shasum on npm is 'same'", () => {
  const r = run("npm-state.sh", [PKG, "0.2.3", SHA], { stubs: { npm: npmStub }, env: { STUB_STDOUT: SHA } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "same");
  assert.match(r.log, /view @trustmodel\/mcp-server@0\.2\.3 dist\.shasum --prefer-online/);
});

test("npm-state: E404 is 'absent'", () => {
  const r = run("npm-state.sh", [PKG, "0.2.3", SHA], { stubs: { npm: npmStub }, env: { STUB_STDERR: E404, STUB_RC: "1" } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "absent");
});

test("npm-state: different bytes under the version exit 2 with both shasums", () => {
  const r = run("npm-state.sh", [PKG, "0.2.3", SHA], { stubs: { npm: npmStub }, env: { STUB_STDOUT: "f".repeat(40) } });
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, new RegExp(`f{40}, not ${SHA}`));
});

test("npm-state: a network error is never 'absent' (TRUS-2495)", () => {
  const r = run("npm-state.sh", [PKG, "0.2.3", SHA], {
    stubs: { npm: npmStub },
    env: { STUB_STDERR: "npm error code ECONNRESET\n", STUB_RC: "1" },
  });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /ECONNRESET/);
});

test("npm-state: success with empty output is an error, not 'absent'", () => {
  const r = run("npm-state.sh", [PKG, "0.2.3", SHA], { stubs: { npm: npmStub } });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, "");
});

// ---------- npm-publish.sh ----------

test("npm-publish: publishes the local tarball with provenance and without scripts", () => {
  const r = run("npm-publish.sh", ["package/trustmodel-mcp-server-0.2.3.tgz"], { stubs: { npm: npmStub } });
  assert.equal(r.status, 0);
  assert.match(r.log, /^npm publish \.\/package\/trustmodel-mcp-server-0\.2\.3\.tgz /m);
  for (const flag of ["--access public", "--ignore-scripts", "--provenance"]) assert.ok(r.log.includes(flag), flag);
});

test("npm-publish: 'cannot publish over' passes with a warning for the next step to judge", () => {
  const r = run("npm-publish.sh", ["package/x.tgz"], {
    stubs: { npm: npmStub },
    env: { STUB_STDERR: "npm error 403 You cannot publish over the previously published versions: 0.2.3.\n", STUB_RC: "1" },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /::warning::/);
});

test("npm-publish: any other publish error fails", () => {
  for (const error of ["npm error code E401\n", "npm error code EUSAGE\nnpm error Provenance generation in GitHub Actions requires...\n"]) {
    const r = run("npm-publish.sh", ["package/x.tgz"], { stubs: { npm: npmStub }, env: { STUB_STDERR: error, STUB_RC: "1" } });
    assert.equal(r.status, 1, error);
  }
});

// ---------- registry-state.sh ----------

const entry = (overrides = {}) =>
  JSON.stringify({
    server: {
      name: NAME,
      version: "0.2.3",
      packages: [{ identifier: PKG }],
      repository: { id: REPO_ID },
      ...overrides,
    },
  });

const registry = (env) => run("registry-state.sh", [NAME, "0.2.3", PKG, REPO_ID], { stubs: { curl: curlStub }, env });

test("registry-state: asks for the URL-encoded name and exact version", () => {
  const r = registry({ STUB_STATUS: "404" });
  assert.match(r.log, /\/v0\.1\/servers\/io\.github\.pdxlab%2Ftrustmodel-mcp\/versions\/0\.2\.3/);
});

test("registry-state: 404 is 'absent'", () => {
  const r = registry({ STUB_STATUS: "404" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "absent");
});

test("registry-state: an entry pointing at our package and repo is 'same'", () => {
  const r = registry({ STUB_STATUS: "200", STUB_BODY: entry() });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "same");
});

test("registry-state: an entry pointing at another package or repo exits 2", () => {
  for (const overrides of [{ packages: [{ identifier: "@evil/pkg" }] }, { repository: { id: "999" } }, { repository: {} }]) {
    const r = registry({ STUB_STATUS: "200", STUB_BODY: entry(overrides) });
    assert.equal(r.status, 2, JSON.stringify(overrides));
    assert.equal(r.stdout, "");
  }
});

test("registry-state: 5xx, unreachable, or an unreadable body is an error, not 'absent'", () => {
  for (const env of [{ STUB_STATUS: "503" }, { STUB_RC: "6" }, { STUB_STATUS: "200", STUB_BODY: "<html>" }, { STUB_STATUS: "200", STUB_BODY: "{}" }]) {
    const r = registry(env);
    assert.equal(r.status, 1, JSON.stringify(env));
    assert.equal(r.stdout, "");
  }
});

// ---------- wait-for.sh ----------

// A state script that answers from a list, one entry per call: "absent", "same",
// "err" (exit 1) or "diff" (exit 2). The last entry repeats.
function sequence(...answers) {
  return {
    "state.sh": `n=$(cat "$STUB_DIR/n" 2>/dev/null || echo 0); echo $((n + 1)) > "$STUB_DIR/n"
answers=(${answers.join(" ")}); i=$(( n < \${#answers[@]} ? n : \${#answers[@]} - 1 ))
case "\${answers[$i]}" in
  absent) echo absent ;;
  same) echo same ;;
  err) echo "npm error code ECONNRESET" >&2; exit 1 ;;
  diff) echo "::error::different bytes" >&2; exit 2 ;;
esac`,
  };
}

function waitFor(max, ...answers) {
  const stubs = sequence(...answers);
  const dir = stubDir(stubs);
  const result = spawnSync("bash", [join(release, "wait-for.sh"), String(max), join(dir, "state.sh")], {
    encoding: "utf8",
    env: { ...process.env, STUB_DIR: dir, RELEASE_SLEEP: "true" },
  });
  const calls = Number(readFileSync(join(dir, "n"), "utf8"));
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls };
}

test("wait-for: keeps waiting through npm's propagation delay, then passes", () => {
  // 12 'absent' answers is 310s of back-off, longer than v0.5.0's ~4-minute delay.
  const r = waitFor(600, ...Array(12).fill("absent"), "same");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.calls, 13);
});

test("wait-for: different bytes stop it at once", () => {
  const r = waitFor(600, "absent", "diff", "same");
  assert.equal(r.status, 2);
  assert.equal(r.calls, 2);
  assert.match(r.stderr, /different bytes/);
});

test("wait-for: transient errors are retried", () => {
  const r = waitFor(600, "err", "err", "same");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.calls, 3);
});

test("wait-for: gives up after the budget and shows the last error", () => {
  const r = waitFor(60, "err");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not visible after \d+s/);
  assert.match(r.stderr, /ECONNRESET/);
});

test("wait-for: never-visible fails after the budget, not before", () => {
  // Delays 10, 15, 20, 25 reach 70s; 18 more 30s waits reach 610s: 22 sleeps, 23 checks.
  const r = waitFor(600, "absent");
  assert.equal(r.status, 1);
  assert.equal(r.calls, 23);
  assert.match(r.stderr, /not visible after 610s/);
});

// ---------- release.yml guards ----------

test("release.yml: no step writes a script's output straight into an echo", () => {
  // `echo "x=$(cmd)"` succeeds even when cmd fails, so a failed check would be
  // ignored. Assign to a variable first; bash -e then stops the step.
  assert.doesNotMatch(workflow, /echo\s+"[^"\n]*=\$\(\s*scripts\//);
});

test("release.yml: every action is pinned to a full commit SHA", () => {
  const uses = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((m) => m[1]);
  assert.ok(uses.length > 0);
  for (const ref of uses) assert.match(ref, /@[0-9a-f]{40}$/, ref);
});

// The text of each job under `jobs:`, keyed by job id.
const jobs = (() => {
  const body = workflow.slice(workflow.indexOf("\njobs:\n") + "\njobs:\n".length);
  const map = {};
  for (const chunk of body.split(/^  (?=[a-z-]+:\s*$)/m)) {
    const id = /^([a-z-]+):/.exec(chunk)?.[1];
    if (id) map[id] = chunk;
  }
  return map;
})();

test("release.yml: jobs holding an OIDC token run no dependency code", () => {
  const tokenJobs = Object.keys(jobs).filter((id) => /id-token:\s*write/.test(jobs[id]));
  assert.deepEqual(tokenJobs.sort(), ["publish", "publish-registry"]);
  for (const id of tokenJobs) {
    const job = jobs[id];
    assert.doesNotMatch(job, /\bnpm (ci|install|i|run|test|exec|x)\b|\bnpx\b|\bpnpm\b|\byarn\b|\bcorepack\b/, id);
    if (job.includes("actions/setup-node")) assert.match(job, /package-manager-cache: false/, id);
    // Cone mode would also check out every root file, including .npmrc, which npm reads.
    const checkouts = job.split("actions/checkout@").slice(1).map((rest) => rest.split(/\n      - /)[0]);
    assert.ok(checkouts.length > 0, id);
    for (const checkout of checkouts) {
      assert.match(checkout, /\n {10}sparse-checkout: /, id);
      assert.match(checkout, /^ {10}sparse-checkout-cone-mode: false$/m, id);
    }
  }
});

// The controls below are what make a release reviewed and tag-gated (SOC 2 CC8.1).
// Each assertion fails if the control is deleted or weakened in a later change.

test("release.yml: runs only on a pushed vX.Y.Z-shaped tag", () => {
  const on = workflow.slice(workflow.indexOf("\non:\n") + 1, workflow.indexOf("\npermissions:\n"));
  assert.equal(on.trim(), 'on:\n  push:\n    tags: ["v*.*.*"]');
});

test("release.yml: the default token is read-only; only github-release may write contents", () => {
  assert.match(workflow, /^permissions:\n  contents: read\n\n/m);
  const writers = Object.keys(jobs).filter((id) => /contents:\s*write/.test(jobs[id]));
  assert.deepEqual(writers, ["github-release"]);
});

test("release.yml: jobs run in order verify -> checksum -> publish -> publish-registry -> github-release", () => {
  const needs = Object.fromEntries(Object.entries(jobs).map(([id, job]) => [id, /^    needs: (\S+)$/m.exec(job)?.[1]]));
  assert.deepEqual(needs, {
    verify: undefined,
    checksum: "verify",
    publish: "checksum",
    "publish-registry": "publish",
    "github-release": "publish-registry",
  });
});

test("release.yml: verify refuses a tag whose commit is not on main", () => {
  assert.match(jobs.verify, /git fetch origin main\n\s+if ! git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main; then\n[^\n]*\n\s+exit 1/);
  assert.match(jobs.verify, /node scripts\/release\/check-tag\.mjs "\$GITHUB_REF_NAME"/);
});

test("release.yml: publish runs in the npm environment", () => {
  assert.match(jobs.publish, /^    environment: npm$/m);
});

test("release.yml: publish checks the tarball's sha256 before anything reads it", () => {
  const job = jobs.publish;
  const download = job.indexOf("actions/download-artifact@");
  const check = job.indexOf("| sha256sum -c -");
  assert.ok(download > 0 && check > download, "sha256sum -c after the download");
  assert.match(job, /EXPECTED: \$\{\{ needs\.checksum\.outputs\.sha256 \}\}/);
  for (const reader of ["tar -xOzf", "npm-state.sh", "npm-publish.sh"]) {
    assert.ok(job.indexOf(reader) > check, `${reader} runs after the sha256 check`);
  }
});

test("release.yml: publish fails unless npm shows a SLSA provenance attestation", () => {
  assert.match(jobs.publish, /dist\.attestations\.provenance\.predicateType/);
  assert.match(jobs.publish, /if \[ "\$predicate" != "https:\/\/slsa\.dev\/provenance\/v1" \]; then\n[^\n]*\n\s+exit 1/);
});

test("release scripts are executable", () => {
  for (const script of ["npm-state.sh", "npm-publish.sh", "registry-state.sh", "wait-for.sh"]) {
    assert.ok(statSync(join(release, script)).mode & 0o111, script);
  }
});
