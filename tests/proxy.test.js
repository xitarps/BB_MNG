import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function startProxy() {
  const port = await freePort();
  const child = spawn("python3", ["server/proxy.py"], { env: { ...process.env, CRIZSOPHA_PORT: String(port) }, stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${base}/health`)).ok) return { base, stop: () => child.kill() };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  child.kill();
  throw new Error("proxy.py não subiu");
}

test("the Jira route only forwards https *.atlassian.net /rest/ paths", async () => {
  const proxy = await startProxy();
  try {
    const rejected = [
      "/jira",
      "/jira/",
      "/jira/evil.com/rest/api/3/myself",
      "/jira/acme.atlassian.net.evil.com/rest/api/3/myself",
      "/jira/acme.atlassian.net@evil.com/rest/api/3/myself",
      "/jira/ACME.atlassian.net/rest/api/3/myself",
      "/jira/acme.atlassian.net/secure/admin",
      "/jira/acme.atlassian.net?x=/rest/api",
      "/jira/localhost/rest/api/3/myself"
    ];
    for (const path of rejected) {
      const response = await fetch(`${proxy.base}${path}`);
      assert.equal(response.status, 400, path);
    }
  } finally {
    proxy.stop();
  }
});

test("Jira writes are limited to the issue routes the app uses", async () => {
  const proxy = await startProxy();
  try {
    const refused = [
      ["POST", "/jira/acme.atlassian.net/rest/api/3/myself"],
      ["POST", "/jira/acme.atlassian.net/rest/api/3/issue/PROJ-1/attachments"],
      ["POST", "/jira/acme.atlassian.net/rest/api/3/issue/proj-1/comment"],
      ["PUT", "/jira/acme.atlassian.net/rest/api/3/issue/PROJ-1/comment"],
      ["DELETE", "/jira/acme.atlassian.net/rest/api/3/issue/PROJ-1"],
      ["POST", "/jira/evil.com/rest/api/3/issue"]
    ];
    for (const [method, path] of refused) {
      const response = await fetch(`${proxy.base}${path}`, { method, body: "{}" });
      assert.ok([400, 405, 501].includes(response.status), `${method} ${path} -> ${response.status}`);
    }
    // An allowed write is forwarded upstream. Offline it fails with 502, never with 400/405.
    const allowed = await fetch(`${proxy.base}/jira/acme.atlassian.net/rest/api/3/issue/PROJ-1/comment`, { method: "POST", body: "{}" });
    assert.ok(![400, 405].includes(allowed.status), `allowed write -> ${allowed.status}`);
  } finally {
    proxy.stop();
  }
});
