import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildBitbucketContext, serializeBitbucketContext } from "../models/bitbucket-context.js";
import { clearSnapshot, loadBitbucketContext, saveSnapshot } from "../models/storage.js";

const originalStorage = globalThis.localStorage;
afterEach(() => {
  globalThis.localStorage = originalStorage;
});

function fakeStorage() {
  const data = new Map();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key)
  };
}

const pr = (id, author, extra = {}) => ({
  key: `acme/api#${id}`,
  id,
  title: `PR ${id}`,
  state: "OPEN",
  draft: false,
  created_on: "2026-11-01T10:00:00Z",
  updated_on: "2026-11-02T10:00:00Z",
  comment_count: 2,
  task_count: 0,
  author: { display_name: author, nickname: author.toLowerCase(), uuid: "{secret-uuid}", avatar: "https://avatar.example/a.png" },
  reviewers: [{ name: "Maria", nickname: "maria", uuid: "{u2}", approved: true, state: "approved" }],
  reviewersLoaded: true,
  source: "feature",
  destination: "main",
  html: `https://bitbucket.org/acme/api/pull-requests/${id}`,
  repo: "acme/api",
  repoSlug: "api",
  summary: "descrição interna do PR",
  ...extra
});

const snapshot = {
  version: 1,
  fetchedAt: "2026-11-24T18:00:00Z",
  workspace: "acme",
  prState: "OPEN",
  user: { display_name: "Eu", nickname: "eu", uuid: "{me}", account_id: "123", avatar: "https://avatar.example/me.png" },
  projects: [{ key: "P", name: "Projeto", description: "x", is_private: true, html: "https://x" }],
  repos: [{ slug: "api", name: "api", full_name: "acme/api", description: "interno", is_private: true, language: "js", updated_on: "2026-11-01", size: 10, html: "https://x", clone: [{ name: "https", href: "https://user@bitbucket.org/acme/api.git" }], project: { key: "P", name: "Projeto" }, mainbranch: "main" }],
  repoTotal: 1,
  repoTruncated: false,
  pullRequests: [pr(1, "Juliano"), pr(2, "Juliano"), pr(3, "Ana", { reviewers: [], reviewersLoaded: false })],
  pipelines: [{ repo: "acme/api", build: 7, uuid: "{p}", result: "SUCCESSFUL", branch: "main", creator: "Ana", created_on: "a", completed_on: "b", html: "https://x" }],
  runners: [{ name: "r1", status: "ONLINE", labels: ["linux"], created_on: "a", updated_on: "b" }],
  permissions: [{ full_name: "acme/api", permission: "write" }],
  probes: [],
  sectionErrors: { runners: "sem acesso" }
};

test("context keeps analysis data and drops identifiers, links and descriptions", () => {
  const context = buildBitbucketContext(snapshot);
  assert.deepEqual(context.summary.pull_requests_by_author, { Juliano: 2, Ana: 1 });
  assert.equal(context.pull_requests[0].author, "Juliano");
  assert.equal(context.pull_requests[0].reviewers[0].name, "Maria");
  assert.equal(context.pull_requests[2].reviewers_loaded, false);
  assert.equal(context.repositories[0].project_key, "P");
  assert.equal(context.warnings.runners, "sem acesso");
  const text = serializeBitbucketContext(snapshot);
  for (const leaked of ["secret-uuid", "avatar.example", "user@bitbucket.org", "descrição interna", "{u2}", "{p}", "123"]) {
    assert.ok(!text.includes(leaked), `vazou: ${leaked}`);
  }
  assert.equal(buildBitbucketContext(null), null);
  assert.equal(serializeBitbucketContext(null), "");
});

test("saving a snapshot refreshes the stored context JSON, and clearing removes it", () => {
  const storage = fakeStorage();
  globalThis.localStorage = storage;
  saveSnapshot(snapshot, "tok-123");
  assert.equal(JSON.parse(loadBitbucketContext()).summary.pull_requests_total, 3);
  saveSnapshot({ ...snapshot, pullRequests: [pr(9, "Ana")] }, "tok-123");
  assert.equal(JSON.parse(loadBitbucketContext()).summary.pull_requests_total, 1);
  clearSnapshot();
  assert.equal(loadBitbucketContext(), "");
});

test("context is not stored if it contains the access token", () => {
  const storage = fakeStorage();
  globalThis.localStorage = storage;
  saveSnapshot(snapshot, "tok-123");
  assert.ok(loadBitbucketContext());
  saveSnapshot({ ...snapshot, pullRequests: [pr(1, "Juliano", { title: "usa tok-123 aqui" })] }, "tok-123");
  assert.equal(loadBitbucketContext(), "");
});
