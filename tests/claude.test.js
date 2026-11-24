import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CLAUDE_MODEL, loadClaudeConfig, saveClaudeConfig, sendClaudeMessage } from "../models/claude.js";
import { renderChat } from "../views/chat.js";

const originalFetch = globalThis.fetch;
const originalStorage = globalThis.localStorage;
const config = { apiKey: "fake-api-key", model: DEFAULT_CLAUDE_MODEL };

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.localStorage = originalStorage;
});

test("Claude configuration is stored separately and can be forgotten", () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  };
  assert.deepEqual(loadClaudeConfig(), { apiKey: "", model: DEFAULT_CLAUDE_MODEL });
  saveClaudeConfig(config);
  assert.deepEqual(loadClaudeConfig(), config);
  saveClaudeConfig({ ...config, apiKey: "" });
  assert.equal(loadClaudeConfig().apiKey, "");
  storage.set("crizsopha.claude.config", "invalid");
  assert.throws(loadClaudeConfig, /Não foi possível ler/);
});

test("sends only chat messages to Claude and reads its response", async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, ...options };
    return { ok: true, json: async () => ({ content: [{ type: "text", text: "Resposta" }], stop_reason: "end_turn" }) };
  };
  const result = await sendClaudeMessage(config, [
    { role: "user", content: "Olá", privateSnapshot: "never-send" },
    { role: "assistant", content: "Olá!" },
    { role: "user", content: "Ajude-me" }
  ]);
  assert.deepEqual(result, { text: "Resposta", truncated: false });
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.headers["x-api-key"], "fake-api-key");
  assert.equal(request.headers["anthropic-dangerous-direct-browser-access"], "true");
  const body = JSON.parse(request.body);
  assert.deepEqual(body.messages, [
    { role: "user", content: "Olá" },
    { role: "assistant", content: "Olá!" },
    { role: "user", content: "Ajude-me" }
  ]);
  assert.ok(!request.body.includes("never-send"));
  assert.ok(!request.body.includes("fake-api-key"));
  assert.match(body.system, /não tem acesso ao Bitbucket/);
});

test("reports provider errors and malformed or truncated responses", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 401 });
  await assert.rejects(sendClaudeMessage(config, [{ role: "user", content: "Olá" }]), /recusou a chave/);
  globalThis.fetch = async () => ({ ok: true, json: async () => null });
  await assert.rejects(sendClaudeMessage(config, [{ role: "user", content: "Olá" }]), /sem conteúdo/);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [null, { type: "text", text: "Texto" }], stop_reason: "max_tokens" }) });
  assert.deepEqual(await sendClaudeMessage(config, [{ role: "user", content: "Olá" }]), { text: "Texto", truncated: true });
  await assert.rejects(sendClaudeMessage({ ...config, apiKey: "" }, [{ role: "user", content: "Olá" }]), /Configure a chave/);
});

test("chat escapes messages and explains the lack of Bitbucket access", () => {
  const state = {
    claude: config,
    chat: { open: true, messages: [{ role: "assistant", content: "<img src=x onerror=alert(1)>" }], draft: "</textarea>", error: "", sending: false, truncated: false }
  };
  const html = renderChat(state);
  assert.match(html, /sem acesso ao Bitbucket/);
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("&lt;/textarea&gt;"));
  state.chat.open = false;
  assert.match(renderChat(state), /Abrir chat com Claude/);
});
