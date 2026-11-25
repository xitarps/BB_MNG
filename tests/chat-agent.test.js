import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AgentRun } from "../models/chat-agent.js";
import { defaultAiConfig } from "../models/ai.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const config = () => {
  const value = defaultAiConfig();
  value.provider = "claude";
  value.providers.claude.apiKey = "test-key";
  return value;
};
const jiraStub = () => {
  const created = [];
  return {
    created,
    host: "example.atlassian.net",
    async createIssue(fields) {
      created.push(fields);
      return { key: "PROJ-7" };
    },
    async get() {
      throw new Error("não esperado");
    }
  };
};
const reply = (data) => ({ ok: true, status: 200, json: async () => data });
// First model turn asks to create an issue; the second turn answers after seeing the tool result.
const scriptedClaude = (requests) => {
  const replies = [
    { content: [{ type: "tool_use", id: "t1", name: "jira_create_issue", input: { project: "PROJ", issue_type: "Task", summary: "Corrigir login" } }], stop_reason: "tool_use" },
    { content: [{ type: "text", text: "Pronto." }], stop_reason: "end_turn" }
  ];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return reply(replies.shift());
  };
};

test("Jira writes wait for confirmation: nothing runs before confirm, and a cancel is reported back to the model", async () => {
  const jira = jiraStub();
  const requests = [];
  scriptedClaude(requests);
  const run = new AgentRun({ config: config(), messages: [{ role: "user", content: "Crie um card" }], jira });

  const paused = await run.start();
  assert.equal(paused.pending.title.length > 0, true);
  assert.equal(jira.created.length, 0);

  const finished = await run.confirm(false);
  assert.equal(finished.done, true);
  assert.equal(finished.text, "Pronto.");
  assert.equal(jira.created.length, 0);
  assert.match(JSON.stringify(requests[1]), /cancelou esta ação/);
});

test("Jira writes run once the user confirms, and the result reaches the model", async () => {
  const jira = jiraStub();
  const requests = [];
  scriptedClaude(requests);
  const run = new AgentRun({ config: config(), messages: [{ role: "user", content: "Crie um card" }], jira });

  await run.start();
  await run.confirm(true);
  assert.deepEqual(jira.created, [{ project: { key: "PROJ" }, issuetype: { name: "Task" }, summary: "Corrigir login" }]);
  assert.match(JSON.stringify(requests[1]), /PROJ-7/);
});
