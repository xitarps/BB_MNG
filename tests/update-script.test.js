import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildUpdatePlan } from "../models/update-script.js";
import { DEFAULT_CONFIG } from "../models/config.js";

const repo = (slug) => ({ slug });
const config = { ...DEFAULT_CONFIG, os: "linux", shell: "bash", protocol: "https", username: "user", token: "secret-token" };

function git(...args) {
  return execFileSync("git", args, { stdio: "pipe", encoding: "utf8" }).trim();
}

test("HTTPS uses and masks the saved credential for each supported shell", () => {
  for (const [os, shell] of [["linux", "bash"], ["windows", "powershell"], ["windows", "cmd"]]) {
    const plan = buildUpdatePlan([repo("project")], { ...config, os, shell });
    const encoded = Buffer.from("user:secret-token").toString("base64");
    assert.ok(plan.script.includes(encoded));
    assert.ok(!plan.maskedScript.includes(encoded));
    assert.ok(!plan.maskedScript.includes("secret-token"));
    assert.match(plan.script, /pull --ff-only origin/);
    assert.match(plan.script, /http\.https:\/\/bitbucket\.org\/\.extraheader/);
  }
  assert.equal(buildUpdatePlan([repo("project")], { ...config, token: "" }).script, "");
  assert.equal(buildUpdatePlan([repo("../project")], config).script, "");
  assert.ok(buildUpdatePlan([repo("project")], { ...config, protocol: "ssh", token: "" }).script);
});

test("bash scopes the credential to Bitbucket and does not leave it in the parent shell", () => {
  const root = mkdtempSync(join(tmpdir(), "crizsopha-auth-"));
  try {
    const repoPath = join(root, "project");
    const bin = join(root, "bin");
    mkdirSync(join(repoPath, ".git"), { recursive: true });
    mkdirSync(bin);
    const fakeGit = join(bin, "git");
    writeFileSync(fakeGit, `#!/bin/sh
if [ "$3" = symbolic-ref ]; then echo main; exit 0; fi
if [ "$3" = pull ]; then
  header=$(/usr/bin/git config --get-urlmatch http.extraheader https://bitbucket.org/workspace/project)
  [ "$header" = "Authorization: Basic dXNlcjpzZWNyZXQtdG9rZW4=" ] || exit 1
  if /usr/bin/git config --get-urlmatch http.extraheader https://example.invalid/project >/dev/null; then exit 1; fi
  exit 0
fi
exit 1
`);
    chmodSync(fakeGit, 0o755);
    const plan = buildUpdatePlan([repo("project")], { ...config, cloneDest: root });
    const result = spawnSync("bash", ["-c", `${plan.script}\nstatus=$?\nprintf 'status=%s value=%s\\n' "$status" "\${GIT_CONFIG_VALUE_0-unset}"\nexit "$status"`], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_VALUE_0: "before" }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /status=0 value=before/);
    assert.ok(!result.stdout.includes("secret-token"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bash updates main and master, reports failures, and preserves origin", () => {
  const root = mkdtempSync(join(tmpdir(), "crizsopha-update-"));
  try {
    const dest = join(root, "clones");
    mkdirSync(dest);
    const source = join(root, "source");
    git("init", "--initial-branch=main", source);
    git("-C", source, "config", "user.email", "test@example.invalid");
    git("-C", source, "config", "user.name", "Test");
    writeFileSync(join(source, "file"), "first");
    git("-C", source, "add", "file");
    git("-C", source, "commit", "-m", "first");
    git("clone", source, join(dest, "main-repo"));
    git("-C", source, "branch", "master");
    git("clone", "--branch", "master", source, join(dest, "master-repo"));
    git("clone", source, join(dest, "feature-repo"));
    git("-C", join(dest, "feature-repo"), "checkout", "-b", "feature");
    writeFileSync(join(source, "file"), "second");
    git("-C", source, "commit", "-am", "second");
    git("-C", source, "branch", "-f", "master", "main");

    const plan = buildUpdatePlan(["main-repo", "master-repo", "feature-repo", "missing"].map(repo), { ...config, cloneDest: dest });
    const result = spawnSync("bash", ["-c", plan.script], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(readFileSync(join(dest, "main-repo", "file"), "utf8"), "second");
    assert.equal(readFileSync(join(dest, "master-repo", "file"), "utf8"), "second");
    assert.equal(readFileSync(join(dest, "feature-repo", "file"), "utf8"), "first");
    assert.equal(git("-C", join(dest, "main-repo"), "remote", "get-url", "origin"), source);
    assert.match(result.stderr, /Branch atual nao e main ou master/);
    assert.match(result.stderr, /Repositorio nao encontrado/);

    writeFileSync(join(dest, "main-repo", "file"), "local change");
    writeFileSync(join(source, "file"), "third");
    git("-C", source, "commit", "-am", "third");
    const failed = spawnSync("bash", ["-c", buildUpdatePlan([repo("main-repo")], { ...config, cloneDest: dest }).script], { encoding: "utf8" });
    assert.equal(failed.status, 1);
    assert.equal(readFileSync(join(dest, "main-repo", "file"), "utf8"), "local change");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
