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
    const post = await fetch(`${proxy.base}/jira/acme.atlassian.net/rest/api/3/myself`, { method: "POST" });
    assert.notEqual(post.status, 200, "only GET is supported");
  } finally {
    proxy.stop();
  }
});
