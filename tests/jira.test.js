import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_JIRA_CONFIG, buildJql, jiraAuthHeader, normalizeJiraSite, parseProjectKeys, validateJiraConfig } from "../models/jira-config.js";
import { JiraClient, slimJiraIssue } from "../models/jira.js";
import { buildJiraContext, buildJiraDashboard, filterJiraIssues, isOverdue, serializeJiraContext } from "../models/jira-context.js";
import { clearJiraSnapshot, loadJiraConfig, loadJiraContext, loadJiraSnapshot, saveJiraConfig, saveJiraSnapshot, forgetJiraToken } from "../models/storage.js";
import { syncJira } from "../controllers/jira-sync.js";

const originals = { fetch: globalThis.fetch, storage: globalThis.localStorage, location: globalThis.location };
afterEach(() => {
  globalThis.fetch = originals.fetch;
  globalThis.localStorage = originals.storage;
  globalThis.location = originals.location;
});

function fakeStorage() {
  const data = new Map();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: (key) => data.delete(key) };
}

const config = { ...DEFAULT_JIRA_CONFIG, site: "acme.atlassian.net", email: "me@acme.com", token: "jira-secret-token" };
const web = () => { globalThis.location = { protocol: "http:", origin: "http://127.0.0.1:8765" }; };
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

test("site, projects, validation and JQL", () => {
  assert.equal(normalizeJiraSite("Acme"), "acme.atlassian.net");
  assert.equal(normalizeJiraSite("https://Acme.atlassian.net/jira/software?x=1"), "acme.atlassian.net");
  assert.deepEqual(parseProjectKeys("abc, xyz; PQ_1\n"), ["ABC", "XYZ", "PQ_1"]);
  assert.match(validateJiraConfig({ ...config, site: "jira.empresa.com" }), /Jira Cloud/);
  assert.match(validateJiraConfig({ ...config, email: "x" }), /e-mail/);
  assert.match(validateJiraConfig({ ...config, token: " " }), /API token/);
  assert.match(validateJiraConfig({ ...config, projects: "AB; 1X" }), /inválida: 1X/);
  assert.equal(validateJiraConfig(config), "");
  assert.equal(buildJql(config), "statusCategory != Done ORDER BY updated DESC");
  assert.equal(buildJql({ ...config, projects: "abc, xyz", scope: "recent" }), "project in (ABC, XYZ) AND updated >= -90d ORDER BY updated DESC");
  assert.equal(buildJql({ ...config, jql: " assignee = currentUser() " }), "assignee = currentUser()");
  assert.equal(jiraAuthHeader(config), `Basic ${Buffer.from("me@acme.com:jira-secret-token").toString("base64")}`);
});

test("requests go through the local proxy with Basic auth and paginate with nextPageToken", async () => {
  web();
  const urls = [];
  const issue = (n) => ({ key: `ABC-${n}`, fields: { summary: `Issue ${n}` } });
  globalThis.fetch = async (url, options) => {
    urls.push({ url, headers: options.headers, method: options.method });
    return urls.length === 1
      ? json({ issues: Array.from({ length: 100 }, (_, i) => issue(i)), nextPageToken: "tok/2", isLast: false })
      : json({ issues: Array.from({ length: 50 }, (_, i) => issue(100 + i)), isLast: true });
  };
  const result = await new JiraClient(config).searchIssues("project = ABC ORDER BY updated DESC", { maxIssues: 300 });
  assert.equal(result.values.length, 150);
  assert.equal(result.truncated, false);
  assert.equal(urls.length, 2);
  assert.ok(urls[0].url.startsWith("http://127.0.0.1:8765/jira/acme.atlassian.net/rest/api/3/search/jql?jql=project%20%3D%20ABC"));
  assert.ok(urls[0].url.includes("maxResults=100") && !urls[0].url.includes("nextPageToken"));
  assert.ok(urls[1].url.includes("nextPageToken=tok%2F2"));
  assert.equal(urls[0].method, "GET");
  assert.equal(urls[0].headers.Authorization, jiraAuthHeader(config));
  assert.ok(!urls[0].url.includes("jira-secret-token"));

  urls.length = 0;
  globalThis.fetch = async (url) => {
    urls.push(url);
    return json({ issues: Array.from({ length: 100 }, (_, i) => issue(i)), nextPageToken: "more", isLast: false });
  };
  const capped = await new JiraClient(config).searchIssues("x = y", { maxIssues: 100 });
  assert.equal(capped.values.length, 100);
  assert.equal(capped.truncated, true);
  assert.equal(urls.length, 1);
});

test("errors become readable messages", async () => {
  web();
  const client = new JiraClient(config);
  const failWith = async (response) => {
    globalThis.fetch = async () => response;
    return client.get("/rest/api/3/myself").then(() => null, (error) => error);
  };
  assert.match((await failWith(json({}, 401))).userMessage, /recusou o e-mail ou o API token/);
  assert.match((await failWith(json({ errorMessages: ["JQL inválida: x"] }, 400))).userMessage, /JQL inválida: x/);
  assert.match((await failWith(json("", 302))).userMessage, /redirecionamento/);
  assert.match((await failWith(json("not found", 404))).userMessage, /versão antiga/, "the local server's own 404 is not a Jira 404");
  assert.match((await failWith(json({ errorMessages: ["Issue does not exist"] }, 404))).userMessage, /endereço do site do Jira.*Issue does not exist.*\(consulta: \/rest\/api\/3\/myself\)/);
  assert.doesNotMatch((await failWith(json({}, 401))).userMessage, /consulta:/);
  assert.match((await failWith(json("<html>login</html>", 200))).userMessage, /não é JSON/);
  globalThis.fetch = async () => { throw new TypeError("failed"); };
  assert.match((await client.get("/rest/api/3/myself").catch((error) => error)).userMessage, /servidor local/);
  globalThis.location = { protocol: "file:", origin: "null" };
  assert.match((await client.get("/rest/api/3/myself").catch((error) => error)).userMessage, /iniciar\.bat/);
});

const issues = [
  { key: "ABC-1", fields: { summary: "Atrasada", status: { name: "Em andamento", statusCategory: { key: "indeterminate" } }, issuetype: { name: "Bug" }, priority: { name: "High" }, assignee: { displayName: "Juliano", accountId: "secret-account", emailAddress: "j@acme.com", avatarUrls: { "48x48": "https://avatar" } }, reporter: { displayName: "Ana" }, created: "2026-10-01T10:00:00.000+0000", updated: "2026-11-20T10:00:00.000+0000", duedate: "2026-11-10", labels: ["urgente"], project: { key: "ABC", name: "Alpha" }, description: "descrição privada" } },
  { key: "ABC-2", fields: { summary: "Sem dono", status: { name: "A fazer", statusCategory: { key: "new" } }, issuetype: { name: "Task" }, assignee: null, reporter: { displayName: "Ana" }, created: "2026-09-01T10:00:00.000+0000", updated: "2026-09-02T10:00:00.000+0000", project: { key: "ABC", name: "Alpha" } } },
  { key: "XYZ-9", fields: { summary: "Pronta", status: { name: "Concluído", statusCategory: { key: "done" } }, issuetype: { name: "Task" }, assignee: { displayName: "Juliano" }, created: "2026-08-01T10:00:00.000+0000", updated: "2026-08-05T10:00:00.000+0000", duedate: "2026-08-04", project: { key: "XYZ", name: "Zeta" } } }
].map((raw) => slimJiraIssue(raw, "acme.atlassian.net"));

test("dashboard metrics and filters", () => {
  const now = new Date("2026-11-24T12:00:00Z").getTime();
  const stats = buildJiraDashboard({ issues, projects: [{ key: "ABC" }] }, now);
  assert.equal(stats.issues, 3);
  assert.equal(stats.open, 2);
  assert.equal(stats.done, 1);
  assert.equal(stats.inProgress, 1);
  assert.equal(stats.overdue, 1, "closed issues are never overdue");
  assert.equal(stats.unassigned, 1);
  assert.equal(stats.stale, 1);
  assert.deepEqual(stats.byAssignee.map((item) => item.label).sort(), ["Juliano", "Sem responsável"]);
  assert.equal(stats.oldestOpen[0].key, "ABC-2");
  assert.equal(isOverdue(issues[2], now), false);
  assert.equal(issues[0].url, "https://acme.atlassian.net/browse/ABC-1");

  const ui = { jiraScope: "open", jiraQuery: "", jiraProject: "", jiraStatus: "", jiraType: "", jiraAssignee: "" };
  assert.deepEqual(filterJiraIssues(issues, ui).map((i) => i.key), ["ABC-1", "ABC-2"]);
  assert.equal(filterJiraIssues(issues, { ...ui, jiraScope: "all" }).length, 3);
  assert.deepEqual(filterJiraIssues(issues, { ...ui, jiraAssignee: "__none__" }).map((i) => i.key), ["ABC-2"]);
  assert.deepEqual(filterJiraIssues(issues, { ...ui, jiraScope: "all", jiraAssignee: "Juliano" }).map((i) => i.key), ["ABC-1", "XYZ-9"]);
  assert.deepEqual(filterJiraIssues(issues, { ...ui, jiraQuery: "URGENTE" }).map((i) => i.key), ["ABC-1"]);
});

test("context keeps analysis fields and drops identifiers, avatars and descriptions", () => {
  const snapshot = { fetchedAt: "2026-11-24", site: "acme.atlassian.net", jql: "x", user: { display_name: "Eu", email: "eu@acme.com", account_id: "acc-1" }, projects: [{ key: "ABC", name: "Alpha", type: "software", lead: "Lia", is_private: false }], issues, truncated: true, sectionErrors: {} };
  const context = buildJiraContext(snapshot);
  assert.equal(context.summary.issues_open, 2);
  assert.deepEqual(context.summary.open_issues_by_assignee, { Juliano: 1, "Sem responsável": 1 });
  assert.equal(context.sample.truncated, true);
  const text = serializeJiraContext(snapshot);
  for (const leaked of ["secret-account", "j@acme.com", "eu@acme.com", "acc-1", "avatar", "descrição privada"]) assert.ok(!text.includes(leaked), `vazou: ${leaked}`);
  assert.equal(buildJiraContext(null), null);
});

test("storage keeps Jira config, snapshot and context separate, never with the token", () => {
  globalThis.localStorage = fakeStorage();
  assert.deepEqual(loadJiraConfig(), DEFAULT_JIRA_CONFIG);
  saveJiraConfig(config);
  assert.equal(loadJiraConfig().token, "jira-secret-token");
  assert.equal(forgetJiraToken().token, "");
  assert.equal(loadJiraConfig().email, "me@acme.com");

  const snapshot = { version: 1, fetchedAt: "x", site: "acme.atlassian.net", jql: "j", user: null, projects: [], issues, truncated: false, sectionErrors: {} };
  assert.equal(saveJiraSnapshot(snapshot, "jira-secret-token"), true);
  assert.equal(loadJiraSnapshot().issues.length, 3);
  assert.equal(JSON.parse(loadJiraContext()).summary.issues_total, 3);
  assert.equal(saveJiraSnapshot({ ...snapshot, issues: issues.map((i) => ({ ...i, summary: "usa jira-secret-token" })) }, "jira-secret-token"), false);
  assert.equal(loadJiraContext(), "", "context with the token is dropped");
  clearJiraSnapshot();
  assert.equal(loadJiraSnapshot(), null);
});

test("syncJira reads account, projects and issues and stores the snapshot", async () => {
  web();
  globalThis.localStorage = fakeStorage();
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(new URL(url).pathname);
    if (url.includes("/myself")) return json({ displayName: "Eu", emailAddress: "me@acme.com", accountId: "acc-1" });
    if (url.includes("/project/search")) return json({ values: [{ key: "ABC", name: "Alpha", projectTypeKey: "software", lead: { displayName: "Lia" } }], isLast: true });
    return json({ issues: [{ key: "ABC-1", fields: { summary: "Um", status: { name: "A fazer", statusCategory: { key: "new" } }, project: { key: "ABC", name: "Alpha" } } }], isLast: true });
  };
  const statuses = [];
  const state = { jiraConfig: { ...config, maxIssues: 300 }, jiraSnapshot: null, jiraUser: null };
  const snapshot = await syncJira(state, undefined, (text) => statuses.push(text));
  assert.deepEqual(requested, ["/jira/acme.atlassian.net/rest/api/3/myself", "/jira/acme.atlassian.net/rest/api/3/project/search", "/jira/acme.atlassian.net/rest/api/3/search/jql"]);
  assert.equal(snapshot.issues[0].key, "ABC-1");
  assert.equal(snapshot.projects[0].lead, "Lia");
  assert.equal(snapshot.jql, "statusCategory != Done ORDER BY updated DESC");
  assert.equal(state.jiraSnapshot, snapshot);
  assert.equal(state.jiraUser.display_name, "Eu");
  assert.equal(loadJiraSnapshot().issues.length, 1);
  assert.match(statuses.at(-1), /1 issues/);

  globalThis.fetch = async (url) => (url.includes("/project/search") ? json({}, 403) : url.includes("/myself") ? json({ displayName: "Eu" }) : json({ issues: [], isLast: true }));
  const partial = await syncJira(state, undefined);
  assert.match(partial.sectionErrors.projects, /Sem permissão/);
});
