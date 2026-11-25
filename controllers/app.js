import { destinationFor, normalizeWorkspace, validateConfig, clampInt, cleanToken } from "../models/config.js";
import { explainError, createClient, slimPullRequest } from "../models/bitbucket.js";
import { buildClonePlan } from "../models/clone-script.js";
import { buildUpdatePlan } from "../models/update-script.js";
import { MAX_CONTEXT_CHARS, MAX_INSTRUCTIONS, PROVIDER_IDS, PROVIDERS, defaultAiConfig, loadAiConfig, normalizeModel, saveAiConfig, testAiProvider } from "../models/ai.js";
import { AgentRun } from "../models/chat-agent.js";
import { JiraClient } from "../models/jira.js";
import { showToast } from "../views/toast.js";
import { buildBitbucketContext } from "../models/bitbucket-context.js";
import { buildContextTree, findNode, leavesOf, selectedContextText } from "../models/context-tree.js";
import { filterRepos } from "../models/metrics.js";
import { clearJiraSnapshot, clearSnapshot, forgetJiraToken, forgetToken, loadBitbucketContext, loadConfig, loadContextExcluded, loadJiraConfig, loadJiraContext, loadJiraSnapshot, loadSnapshot, loadWorkspaces, saveConfig, saveContextExcluded, saveJiraConfig } from "../models/storage.js";
import { formatDate } from "../models/format.js";
import { renderShell } from "../views/shell.js";
import { renderDashboard } from "../views/dashboard.js";
import { renderPullRequests, renderPrTable, visiblePullRequests } from "../views/pull-requests.js";
import { renderRepositories, renderRepoTable } from "../views/repositories.js";
import { renderPipelines } from "../views/pipelines.js";
import { renderRunners } from "../views/runners.js";
import { cloneSelection, renderClone, renderCloneList } from "../views/clone.js";
import { renderSettings } from "../views/settings.js";
import { ROUTES } from "../views/html.js";
import { refreshReviewers, syncAll, testConnection } from "./sync.js";
import { syncJira, testJiraConnection } from "./jira-sync.js";
import { buildJiraContext } from "../models/jira-context.js";
import { buildJql, normalizeJiraSite, validateJiraConfig } from "../models/jira-config.js";
import { renderJiraDashboard, renderJiraIssues, renderJiraProjects, renderJiraTable } from "../views/jira.js";

const pages = {
  dashboard: renderDashboard,
  prs: renderPullRequests,
  repos: renderRepositories,
  pipelines: renderPipelines,
  runners: renderRunners,
  clone: renderClone,
  jira: renderJiraDashboard,
  "jira-issues": renderJiraIssues,
  "jira-projects": renderJiraProjects,
  settings: renderSettings
};

const GROUPED = { grouped: true };
const SOURCE_PREFIX = /^(bitbucket|jira)\./;
// Exclusions saved before the Jira groups existed referred to Bitbucket fields without the group prefix.
const savedExclusions = loadContextExcluded().map((path) => (SOURCE_PREFIX.test(path) ? path : `bitbucket.${path}`));

let aiConfig;
let aiConfigError = "";
try {
  aiConfig = loadAiConfig();
} catch (error) {
  aiConfig = defaultAiConfig();
  aiConfigError = error.message;
}

const state = {
  route: "dashboard",
  config: loadConfig(),
  snapshot: loadSnapshot(),
  workspaces: loadWorkspaces(),
  user: loadSnapshot()?.user || null,
  userError: "",
  jiraConfig: loadJiraConfig(),
  jiraSnapshot: loadJiraSnapshot(),
  jiraUser: loadJiraSnapshot()?.user || null,
  syncing: false,
  statusText: "",
  error: aiConfigError,
  notice: "",
  abort: null,
  ai: aiConfig,
  chat: { open: false, messages: [], draft: "", sending: false, error: "", truncated: false, useContext: false, contextData: null, contextExcluded: new Set(savedExclusions), treeOpen: new Set(), contextPreview: false, maximized: false, contextCollapsed: false, run: null, pending: null, activity: [] },
  ui: {
    prQuery: "",
    prAuthor: "",
    prRepo: "",
    prDraft: "ready",
    prReview: "all",
    prPage: 1,
    prPageSize: 10,
    repoQuery: "",
    repoLanguage: "",
    repoProject: "",
    selectedRepos: [],
    selectedPrKey: "",
    prDetail: null,
    prDetailLoading: false,
    cloneReveal: false,
    repoOperation: "clone",
    manualSlug: "",
    manualRepos: [],
    jiraQuery: "",
    jiraScope: "open",
    jiraProject: "",
    jiraStatus: "",
    jiraType: "",
    jiraAssignee: "",
    jiraPage: 1,
    jiraPageSize: 10
  }
};

if (state.snapshot?.fetchedAt) state.statusText = `Cache local de ${formatDate(state.snapshot.fetchedAt)}.`;
const initialRoute = location.hash.replace(/^#/, "");
if (pages[initialRoute]) state.route = initialRoute;
else if (!state.config.token) state.route = "settings";

function render({ keepScroll = false } = {}) {
  const content = document.querySelector(".content");
  const y = keepScroll ? content?.scrollTop || 0 : 0;
  const focusId = /^(chat-draft|chat-context-toggle|chat-maximize|ctx-.*)$/.test(document.activeElement?.id || "") ? document.activeElement.id : "";
  const focused = focusId ? document.activeElement : null;
  const selection = typeof focused?.selectionStart === "number" ? [focused.selectionStart, focused.selectionEnd] : null;
  const chatLog = document.querySelector(".chat-messages");
  const chatScroll = chatLog?.scrollTop || 0;
  const wasAtBottom = !chatLog || chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 30;
  const treeScroll = document.querySelector(".chat-context-tree")?.scrollTop || 0;
  const page = pages[state.route] || renderDashboard;
  const root = document.getElementById("app");
  root.classList.remove("boot");
  root.innerHTML = renderShell(state, page(state));
  const next = document.querySelector(".content");
  if (next) next.scrollTop = y;
  const nextLog = document.querySelector(".chat-messages");
  if (nextLog) nextLog.scrollTop = wasAtBottom ? nextLog.scrollHeight : chatScroll;
  const nextTree = document.querySelector(".chat-context-tree");
  if (nextTree) nextTree.scrollTop = treeScroll;
  for (const box of document.querySelectorAll("input[data-indeterminate]")) box.indeterminate = true;
  const nextFocus = focusId ? document.getElementById(focusId) : null;
  if (nextFocus && !nextFocus.disabled) {
    nextFocus.focus();
    if (selection) nextFocus.setSelectionRange(...selection);
  }
  ensureReviewers();
  flushMessages();
}

// Errors and notices set anywhere in the controller become floating toasts, visible wherever the page is scrolled.
function flushMessages() {
  const { error, notice } = state;
  state.error = "";
  state.notice = "";
  if (error) showToast("error", error);
  if (notice) showToast("notice", notice);
}

let reviewersJob = null;

function ensureReviewers() {
  if (state.route !== "prs" || reviewersJob || !state.snapshot) return;
  const rows = visiblePullRequests(state).rows.filter((pr) => !pr.reviewersLoaded);
  if (!rows.length) return;
  reviewersJob = refreshReviewers(state, undefined, rows).then(() => {
    if (state.route === "prs") patch("pr-table", renderPrTable(state));
  }).catch(() => {}).finally(() => {
    reviewersJob = null;
    ensureReviewers();
  });
}

function patch(slot, html) {
  const node = document.querySelector(`[data-slot="${slot}"]:not([data-filter])`);
  if (node) {
    node.innerHTML = html;
    if (slot === "pr-table") ensureReviewers();
  } else render({ keepScroll: true });
}

function applyLiveFilter(control) {
  const name = control?.dataset?.filter;
  if (!name) return;
  state.ui[name] = control.value;
  if (name.startsWith("pr")) state.ui.prPage = 1;
  if (name.startsWith("jira")) state.ui.jiraPage = 1;
  const slot = control.dataset.live;
  if (slot === "pr-table") patch("pr-table", renderPrTable(state));
  if (slot === "jira-table") patch("jira-table", renderJiraTable(state));
  if (slot === "repo-table") patch("repo-table", renderRepoTable(state));
  if (slot === "clone-list") patch("clone-list", renderCloneList(state));
}

function go(route) {
  if (!pages[route]) return;
  state.route = route;
  if (location.hash !== `#${route}`) location.hash = route;
  else render();
}

function readSettingsForm() {
  const form = document.querySelector("form[data-action='save-config']");
  if (!form) return state.config;
  const data = new FormData(form);
  const previous = state.config;
  const token = cleanToken(data.get("token"));
  const authMode = String(data.get("authMode") || previous.authMode);
  state.config = {
    ...previous,
    authMode,
    email: String(data.get("email") || "").trim(),
    username: String(data.get("username") || "").trim(),
    token: token || previous.token,
    workspace: normalizeWorkspace(data.get("workspace") || ""),
    maxRepos: clampInt(data.get("maxRepos"), 10, 200, 50),
    pipelineRepos: clampInt(data.get("pipelineRepos"), 0, 40, 12),
    prState: String(data.get("prState") || "OPEN"),
    lastAuthMode: token || authMode !== previous.authMode ? "" : previous.lastAuthMode
  };
  saveConfig(state.config);
  return state.config;
}

function readJiraForm() {
  const form = document.querySelector("form[data-action='save-jira']");
  if (!form) return state.jiraConfig;
  const data = new FormData(form);
  const previous = state.jiraConfig;
  state.jiraConfig = {
    ...previous,
    site: normalizeJiraSite(data.get("site")),
    email: String(data.get("email") || "").trim(),
    token: cleanToken(data.get("token")) || previous.token,
    projects: String(data.get("projects") || "").trim(),
    scope: data.get("scope") === "recent" ? "recent" : "open",
    maxIssues: clampInt(data.get("maxIssues"), 50, 1000, 300),
    jql: String(data.get("jql") || "").trim()
  };
  saveJiraConfig(state.jiraConfig);
  return state.jiraConfig;
}

// Reads the AI form and saves it. Returns a problem description, or "" when it was saved.
function readAiForm({ applyProvider }) {
  const form = document.querySelector("form[data-action='save-ai']");
  if (!form) return "";
  const data = new FormData(form);
  const provider = applyProvider && PROVIDER_IDS.includes(data.get("provider")) ? data.get("provider") : state.ai.provider;
  const providers = {};
  const instructions = String(data.get("instructions") ?? state.ai.instructions ?? "").trim();
  let problem = "";
  if (instructions.length > MAX_INSTRUCTIONS) problem = `As instruções padrão passam de ${MAX_INSTRUCTIONS.toLocaleString("pt-BR")} caracteres (${instructions.length.toLocaleString("pt-BR")}). Reduza o texto.`;
  for (const id of PROVIDER_IDS) {
    const model = normalizeModel(data.get(`model-${id}`)) || PROVIDERS[id].defaultModel;
    const apiKey = String(data.get(`key-${id}`) || "").trim() || state.ai.providers[id].apiKey;
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(model)) problem ||= `Confira o ID do modelo do ${PROVIDERS[id].label}.`;
    if (/[\r\n]/.test(apiKey)) problem ||= `Confira a chave de API do ${PROVIDERS[id].label}.`;
    providers[id] = { apiKey, model };
  }
  if (!problem) {
    try {
      const config = { provider, instructions, providers };
      saveAiConfig(config);
      state.ai = config;
      state.error = "";
    } catch (error) {
      problem = "Não foi possível salvar a configuração da IA neste navegador.";
    }
  }
  if (problem) {
    state.error = problem;
    state.notice = "";
  }
  return problem;
}

async function runTask(label, task) {
  state.abort?.abort();
  const abort = new AbortController();
  state.abort = abort;
  state.syncing = true;
  state.error = "";
  state.notice = "";
  state.statusText = label;
  render({ keepScroll: true });
  try {
    await task(abort.signal, (text) => {
      state.statusText = text;
      const el = document.getElementById("sync-status");
      if (el) el.textContent = text;
    });
  } catch (error) {
    if (error.name !== "AbortError") {
      state.error = explainError(error);
      state.statusText = "A consulta falhou.";
    } else state.statusText = "Consulta cancelada.";
  } finally {
    state.syncing = false;
    if (state.abort === abort) state.abort = null;
    render({ keepScroll: true });
  }
}

async function openPr(key) {
  const pr = state.snapshot?.pullRequests?.find((item) => item.key === key);
  state.ui.selectedPrKey = key;
  state.ui.prDetail = null;
  state.ui.prDetailLoading = true;
  const requestRoute = state.route;
  render({ keepScroll: true });
  if (!pr?.repoSlug) {
    state.ui.prDetailLoading = false;
    state.ui.prDetail = { key, error: "Este pull request não tem repositório suficiente para o detalhe." };
    render({ keepScroll: true });
    return;
  }
  try {
    const client = createClient(state.config);
    const base = `/2.0/repositories/${encodeURIComponent(state.config.workspace)}/${encodeURIComponent(pr.repoSlug)}/pullrequests/${encodeURIComponent(pr.id)}`;
    const commentsPath = `${base}/comments`;
    const [full, comments, files] = await Promise.all([
      client.get(base),
      client.list(`${commentsPath}?sort=created_on`, { pagelen: 50, maxPages: 4, maxItems: 200 }).catch((error) => {
        if (error.status !== 400) throw error;
        return client.list(commentsPath, { pagelen: 50, maxPages: 4, maxItems: 200 });
      }),
      client.list(`${base}/diffstat`, { pagelen: 50, maxPages: 2, maxItems: 80 })
    ]);
    const detailed = slimPullRequest(full, { full_name: pr.repo, slug: pr.repoSlug });
    pr.reviewers = detailed.reviewers;
    pr.approved = detailed.approved;
    pr.reviewersLoaded = true;
    state.ui.prDetail = {
      key,
      pr: detailed,
      comments: comments.values || [],
      commentsTruncated: Boolean(comments.truncated),
      files: files.values || []
    };
  } catch (error) {
    state.ui.prDetail = { key, error: explainError(error) };
  } finally {
    state.ui.prDetailLoading = false;
    if (state.route === requestRoute && state.ui.selectedPrKey === key) render({ keepScroll: true });
  }
}

function download(filename, content, shell) {
  const body = shell === "powershell" ? `\uFEFF${content}` : content;
  const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function currentRepoPlan() {
  const build = state.ui.repoOperation === "update" ? buildUpdatePlan : buildClonePlan;
  return build(cloneSelection(state), state.config);
}

function parseStored(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // A corrupted copy falls back to rebuilding from the cached snapshot.
    return null;
  }
}

function bitbucketContextData() {
  return parseStored(loadBitbucketContext()) || buildBitbucketContext(state.snapshot);
}

function jiraContextData() {
  return parseStored(loadJiraContext()) || buildJiraContext(state.jiraSnapshot);
}

// One tree for the chat: a group per source that has data.
function chatContextData() {
  const data = {};
  const bitbucket = bitbucketContextData();
  const jira = jiraContextData();
  if (bitbucket) data.bitbucket = bitbucket;
  if (jira) data.jira = jira;
  return Object.keys(data).length ? data : null;
}

function chatContextText() {
  return selectedContextText(state.chat.contextData, state.chat.contextExcluded, GROUPED);
}

function setContextLeaves(paths, selected) {
  const excluded = state.chat.contextExcluded;
  for (const path of paths) {
    if (selected) excluded.delete(path);
    else excluded.add(path);
  }
  saveContextExcluded([...excluded]);
}

function contextLeaves(path) {
  const tree = buildContextTree(state.chat.contextData, GROUPED);
  if (path === undefined) return tree.flatMap(leavesOf);
  const node = findNode(tree, path);
  return node ? leavesOf(node) : [];
}

async function sendChat() {
  const chat = state.chat;
  if (chat.sending) return;
  const text = chat.draft.trim();
  const context = chat.useContext ? chatContextText() : "";
  if (!text) {
    chat.error = "Escreva uma mensagem antes de enviar.";
    render({ keepScroll: true });
    return;
  }
  if (chat.useContext && !context) {
    chat.error = "Não há contexto selecionado. Marque campos, atualize o Bitbucket ou o Jira, ou desligue o switch.";
    render({ keepScroll: true });
    return;
  }
  if (context.length > MAX_CONTEXT_CHARS) {
    chat.error = `O contexto passa de ${MAX_CONTEXT_CHARS.toLocaleString("pt-BR")} caracteres. Desmarque campos para reduzi-lo.`;
    render({ keepScroll: true });
    return;
  }
  if ([state.config.token, state.jiraConfig.token, ...PROVIDER_IDS.map((id) => state.ai.providers[id].apiKey)].some((secret) => secret && (text.includes(secret) || context.includes(secret) || state.ai.instructions.includes(secret)))) {
    chat.error = "A mensagem, o contexto ou as instruções padrão contêm uma credencial configurada. Remova-a antes de enviar.";
    render({ keepScroll: true });
    return;
  }
  chat.messages.push(context ? { role: "user", content: text, context } : { role: "user", content: text });
  chat.draft = "";
  chat.error = "";
  chat.truncated = false;
  chat.pending = null;
  chat.activity = [];
  chat.sending = true;
  render({ keepScroll: true });
  let run = null;
  try {
    run = new AgentRun({ config: state.ai, messages: chat.messages, jira: chatJiraClient(), onActivity: addChatActivity });
    chat.run = run;
    applyChatOutcome(await run.start());
  } catch (error) {
    // Before the first model call succeeds nothing ran, so the message goes back to the draft; later failures keep it because Jira may already have changed.
    if (!run || run.steps <= 1) {
      chat.messages.pop();
      chat.draft = text;
    }
    chat.run = null;
    chat.error = error.message;
  } finally {
    if (!chat.pending) chat.sending = false;
    render({ keepScroll: true });
  }
}

async function confirmChatAction(approved) {
  const chat = state.chat;
  if (!chat.run || !chat.pending) return;
  chat.pending = null;
  chat.error = "";
  chat.sending = true;
  render({ keepScroll: true });
  try {
    applyChatOutcome(await chat.run.confirm(approved));
  } catch (error) {
    chat.run = null;
    chat.error = error.message;
  } finally {
    if (!chat.pending) chat.sending = false;
    render({ keepScroll: true });
  }
}

function applyChatOutcome(outcome) {
  const chat = state.chat;
  if (outcome.pending) {
    chat.pending = outcome.pending;
    return;
  }
  chat.messages.push({ role: "assistant", content: outcome.text, provider: PROVIDERS[outcome.provider].label });
  chat.truncated = outcome.truncated;
  chat.run = null;
}

function addChatActivity(line) {
  state.chat.activity.push(line);
  render({ keepScroll: true });
}

// The assistant can manage Jira whenever the Jira connection is configured, even when the context switch is off.
function chatJiraClient() {
  return validateJiraConfig(state.jiraConfig) ? null : new JiraClient(state.jiraConfig);
}

function addManualRepo() {
  const input = document.querySelector("[data-action='manual-slug']");
  const slug = (input?.value || state.ui.manualSlug || "").trim();
  const workspace = normalizeWorkspace(state.config.workspace);
  if (!workspace) {
    state.error = "Informe o workspace antes de adicionar um slug.";
    render({ keepScroll: true });
    return;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(slug)) {
    state.error = "Slug inválido. Use letras, números, ponto, _ ou -.";
    render({ keepScroll: true });
    return;
  }
  const fullName = `${workspace}/${slug}`;
  if (!state.ui.manualRepos.some((repo) => repo.full_name === fullName)) {
    state.ui.manualRepos.push({
      slug,
      name: slug,
      full_name: fullName,
      language: "",
      description: "",
      project: null,
      clone: [
        { name: "https", href: `https://bitbucket.org/${fullName}.git` },
        { name: "ssh", href: `git@bitbucket.org:${fullName}.git` }
      ]
    });
  }
  if (!state.ui.selectedRepos.includes(fullName)) state.ui.selectedRepos.push(fullName);
  state.ui.manualSlug = "";
  state.error = "";
  render({ keepScroll: true });
}

document.body.addEventListener("click", (event) => {
  const route = event.target.closest("[data-route]")?.dataset.route;
  if (route) {
    go(route);
    return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  const source = event.target.closest("[data-action]");
  if (!action) return;
  if (action === "open-chat" || action === "close-chat") {
    state.chat.open = action === "open-chat";
    render({ keepScroll: true });
    if (state.chat.open) document.getElementById("chat-draft")?.focus();
    else document.querySelector("[data-action='open-chat']")?.focus();
  } else if (action === "toggle-chat-maximize") {
    state.chat.maximized = !state.chat.maximized;
    render({ keepScroll: true });
  } else if (action === "toggle-context-panel") {
    state.chat.contextCollapsed = !state.chat.contextCollapsed;
    render({ keepScroll: true });
  } else if (action === "reload-chat-context") {
    if (state.chat.sending) return;
    state.chat.contextData = chatContextData();
    state.chat.error = "";
    render({ keepScroll: true });
  } else if (action === "ctx-expand") {
    const open = state.chat.treeOpen;
    if (open.has(source.dataset.path)) open.delete(source.dataset.path);
    else open.add(source.dataset.path);
    render({ keepScroll: true });
  } else if (action === "ctx-all" || action === "ctx-none") {
    if (state.chat.sending) return;
    setContextLeaves(contextLeaves(), action === "ctx-all");
    render({ keepScroll: true });
  } else if (action === "toggle-context-preview") {
    state.chat.contextPreview = !state.chat.contextPreview;
    render({ keepScroll: true });
  } else if (action === "download-bitbucket-context") {
    const data = bitbucketContextData();
    if (!data) {
      state.error = "Não há dados do Bitbucket salvos. Clique em Atualizar primeiro.";
      render({ keepScroll: true });
      return;
    }
    download("contexto-bitbucket.json", JSON.stringify(data, null, 2), "json");
  } else if (action === "confirm-chat-action") {
    confirmChatAction(source.dataset.approved === "true");
  } else if (action === "clear-chat") {
    if (state.chat.sending) return;
    state.chat.messages = [];
    state.chat.error = "";
    state.chat.truncated = false;
    render({ keepScroll: true });
  } else if (action === "test-ai") {
    const id = source.dataset.provider;
    if (!PROVIDER_IDS.includes(id) || state.chat.sending) return;
    if (readAiForm({ applyProvider: false })) {
      render({ keepScroll: true });
      return;
    }
    runTask(`Testando ${PROVIDERS[id].label}…`, async (signal, setStatus) => {
      const result = await testAiProvider(state.ai, id, signal);
      setStatus(`${result.label} respondeu.`);
      const seconds = (result.ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
      state.notice = result.answered
        ? `${result.label} está funcionando: a chave e o modelo ${result.model} foram aceitos (${seconds} s).`
        : `${result.label} aceitou a chave e o modelo ${result.model} (${seconds} s). O modelo gastou o limite do teste pensando, o que é normal em modelos de raciocínio.`;
    });
  } else if (action === "forget-ai") {
    if (state.chat.sending) return;
    const id = source.dataset.provider;
    if (!PROVIDER_IDS.includes(id)) return;
    const config = { ...state.ai, providers: { ...state.ai.providers, [id]: { ...state.ai.providers[id], apiKey: "" } } };
    try {
      saveAiConfig(config);
      state.ai = config;
      state.notice = `Chave do ${PROVIDERS[id].label} apagada deste navegador.`;
      state.error = "";
    } catch (error) {
      state.error = `Não foi possível apagar a chave do ${PROVIDERS[id].label} no navegador.`;
    }
    render({ keepScroll: true });
  } else if (action === "sync") {
    readSettingsForm();
    const problem = validateConfig(state.config, { requireWorkspace: true });
    if (problem) {
      state.error = problem;
      go("settings");
      return;
    }
    runTask("Consultando o Bitbucket…", (signal, setStatus) => syncAll(state, signal, setStatus));
  } else if (action === "pr-page") {
    state.ui.prPage = Math.max(1, (Number(state.ui.prPage) || 1) + (source.dataset.value === "next" ? 1 : -1));
    patch("pr-table", renderPrTable(state));
  } else if (action === "jira-page") {
    state.ui.jiraPage = Math.max(1, (Number(state.ui.jiraPage) || 1) + (source.dataset.value === "next" ? 1 : -1));
    patch("jira-table", renderJiraTable(state));
  } else if (action === "sync-jira") {
    readJiraForm();
    const problem = validateJiraConfig(state.jiraConfig);
    if (problem) {
      state.error = problem;
      go("settings");
      return;
    }
    runTask("Consultando o Jira…", (signal, setStatus) => syncJira(state, signal, setStatus));
  } else if (action === "test-jira") {
    readJiraForm();
    const problem = validateJiraConfig(state.jiraConfig);
    if (problem) {
      state.error = problem;
      state.notice = "";
      render({ keepScroll: true });
      return;
    }
    runTask("Testando conexão com o Jira…", async (signal, setStatus) => {
      const user = await testJiraConnection(state, signal);
      setStatus("Conexão com o Jira confirmada.");
      state.notice = `Jira aceitou as credenciais: ${user?.display_name || "conta identificada"}. Consulta que será usada: ${buildJql(state.jiraConfig)}`;
    });
  } else if (action === "forget-jira") {
    state.jiraConfig = forgetJiraToken();
    state.jiraUser = null;
    state.notice = "Token do Jira apagado deste navegador.";
    state.error = "";
    render({ keepScroll: true });
  } else if (action === "clear-jira-cache") {
    clearJiraSnapshot();
    state.jiraSnapshot = null;
    state.notice = "Cache do Jira apagado. O token continua salvo.";
    state.error = "";
    render({ keepScroll: true });
  } else if (action === "download-jira-context") {
    const data = jiraContextData();
    if (!data) {
      state.error = "Não há dados do Jira salvos. Atualize o Jira primeiro.";
      render({ keepScroll: true });
      return;
    }
    download("contexto-jira.json", JSON.stringify(data, null, 2), "json");
  } else if (action === "cancel") {
    state.abort?.abort();
  } else if (action === "test-connection") {
    readSettingsForm();
    const problem = validateConfig(state.config, { requireWorkspace: state.config.authMode === "bearer" });
    if (problem) {
      state.error = problem;
      render();
      return;
    }
    runTask("Testando conexão…", async (signal, setStatus) => {
      const result = await testConnection(state, signal, setStatus);
      const scheme = result.mode === "bearer" ? "Bearer" : "Basic";
      state.notice = result.mode === "bearer"
        ? `${scheme} aceito em /2.0/repositories/${state.config.workspace}. ${result.user ? "Conta identificada." : "Token de workspace: /2.0/user pode falhar e isso é normal."}`
        : state.workspaces.length
          ? `${scheme} aceito. Confira o workspace e clique em Atualizar.`
          : "Autenticou, mas nenhum workspace voltou na lista. Informe o slug manualmente.";
    });
  } else if (action === "forget-token") {
    state.config = forgetToken();
    state.user = null;
    state.notice = "Token apagado deste navegador.";
    render();
  } else if (action === "clear-cache") {
    clearSnapshot();
    state.snapshot = null;
    state.notice = "Cache apagado. O token continua salvo.";
    render();
  } else if (action === "open-pr") {
    state.ui.commentsOpen = false;
    openPr(source.dataset.key);
  } else if (action === "open-comments") {
    state.ui.commentsOpen = true;
    if (state.ui.prDetail?.key === source.dataset.key && !state.ui.prDetailLoading) render({ keepScroll: true });
    else openPr(source.dataset.key);
  } else if (action === "close-comments") {
    if (event.target.closest("[data-modal]") && !event.target.closest("button[data-action='close-comments']")) return;
    state.ui.commentsOpen = false;
    render({ keepScroll: true });
  } else if (action === "clone-one") {
    state.ui.selectedRepos = [source.dataset.repo];
    state.ui.repoOperation = "clone";
    go("clone");
  } else if (action === "update-one") {
    state.ui.selectedRepos = [source.dataset.repo];
    state.ui.repoOperation = "update";
    go("clone");
  } else if (action === "set-repo-operation") {
    state.ui.repoOperation = source.dataset.value === "update" ? "update" : "clone";
    state.ui.cloneReveal = false;
    render({ keepScroll: true });
  } else if (action === "set-os") {
    const os = source.dataset.value === "linux" ? "linux" : "windows";
    state.config.os = os;
    state.config.cloneDest = destinationFor(os, state.config.cloneDest);
    if (os === "linux") state.config.shell = "bash";
    if (os === "windows" && state.config.shell === "bash") state.config.shell = "powershell";
    saveConfig(state.config);
    render({ keepScroll: true });
  } else if (action === "set-shell") {
    state.config.shell = source.dataset.value === "cmd" ? "cmd" : "powershell";
    state.config.os = "windows";
    saveConfig(state.config);
    render({ keepScroll: true });
  } else if (action === "set-protocol") {
    state.config.protocol = source.dataset.value === "ssh" ? "ssh" : "https";
    saveConfig(state.config);
    render({ keepScroll: true });
  } else if (action === "select-visible") {
    const visible = filterRepos(state.snapshot?.repos || [], state.ui).map((repo) => repo.full_name);
    state.ui.selectedRepos = [...new Set([...state.ui.selectedRepos, ...visible])];
    render({ keepScroll: true });
  } else if (action === "clear-selection") {
    state.ui.selectedRepos = [];
    render({ keepScroll: true });
  } else if (action === "add-manual") {
    addManualRepo();
  } else if (action === "copy-script") {
    const plan = currentRepoPlan();
    if (!plan.script) return;
    navigator.clipboard.writeText(plan.script).then(() => {
      state.notice = (state.ui.repoOperation === "update" && state.config.protocol === "https") || (state.ui.repoOperation === "clone" && state.config.includeTokenInUrl)
        ? "Script copiado com o token. Não deixe esse texto salvo num arquivo do projeto."
        : "Script copiado.";
      state.error = "";
      render({ keepScroll: true });
    }).catch(() => {
      state.error = "A área de transferência foi bloqueada. Selecione o script e copie manualmente.";
      render({ keepScroll: true });
    });
  } else if (action === "download-script") {
    const plan = currentRepoPlan();
    if (!plan.script) return;
    download(plan.filename, plan.script, plan.shell);
    state.notice = (state.ui.repoOperation === "update" && state.config.protocol === "https") || (state.ui.repoOperation === "clone" && state.config.includeTokenInUrl)
      ? "Download gerado com credenciais. Apague o arquivo depois de usar."
      : "Script baixado.";
    render({ keepScroll: true });
  }
});

document.body.addEventListener("change", (event) => {
  const target = event.target;
  if (target.dataset.action === "set-workspace") {
    state.config.workspace = target.value;
    saveConfig(state.config);
    state.statusText = `Workspace ${state.config.workspace}. Atualize para buscar os dados dele.`;
    render({ keepScroll: true });
    return;
  }
  if (target.dataset.action === "type-workspace") {
    state.config.workspace = normalizeWorkspace(target.value);
    saveConfig(state.config);
    target.value = state.config.workspace;
    return;
  }
  if (target.dataset.action === "clone-dest") {
    state.config.cloneDest = target.value.trim() || destinationFor(state.config.os, "");
    saveConfig(state.config);
    render({ keepScroll: true });
    return;
  }
  if (target.dataset.action === "include-token") {
    state.config.includeTokenInUrl = target.checked;
    saveConfig(state.config);
    render({ keepScroll: true });
    return;
  }
  if (target.dataset.action === "chat-provider") {
    if (state.chat.sending || !PROVIDER_IDS.includes(target.value)) return;
    const config = { ...state.ai, provider: target.value };
    try {
      saveAiConfig(config);
      state.ai = config;
      state.chat.error = "";
    } catch (error) {
      state.chat.error = "Não foi possível salvar o provedor escolhido neste navegador.";
    }
    render({ keepScroll: true });
    return;
  }
  if (target.dataset.action === "chat-context-toggle") {
    state.chat.useContext = target.checked;
    state.chat.contextCollapsed = false;
    if (target.checked) state.chat.contextData = chatContextData();
    state.chat.error = "";
    render({ keepScroll: true });
    return;
  }
  if (target.dataset.action === "ctx-toggle") {
    if (!state.chat.sending) setContextLeaves(contextLeaves(target.dataset.path), target.checked);
    render({ keepScroll: true });
    return;
  }
  if (target.dataset.action === "reveal-token") {
    state.ui.cloneReveal = target.checked;
    render({ keepScroll: true });
    return;
  }
  if (target.dataset.repoCheck) {
    const set = new Set(state.ui.selectedRepos);
    if (target.checked) set.add(target.dataset.repoCheck);
    else set.delete(target.dataset.repoCheck);
    state.ui.selectedRepos = [...set];
    render({ keepScroll: true });
    return;
  }
  applyLiveFilter(target.closest("[data-filter]") || target);
});

document.body.addEventListener("input", (event) => {
  const target = event.target;
  if (target.dataset.action === "manual-slug") state.ui.manualSlug = target.value;
  if (target.dataset.action === "chat-draft") state.chat.draft = target.value;
  applyLiveFilter(target.closest("[data-filter]") || target);
});

document.body.addEventListener("submit", (event) => {
  const form = event.target.closest("form[data-action]");
  if (!form) return;
  if (form.dataset.action === "send-chat") {
    event.preventDefault();
    sendChat();
    return;
  }
  if (form.dataset.action === "save-jira") {
    event.preventDefault();
    readJiraForm();
    const problem = validateJiraConfig(state.jiraConfig);
    state.error = problem;
    state.notice = problem ? "" : "Configuração do Jira salva neste navegador.";
    render({ keepScroll: true });
    return;
  }
  if (form.dataset.action === "save-ai") {
    event.preventDefault();
    const problem = readAiForm({ applyProvider: true });
    if (!problem) state.notice = `Configuração da IA salva neste navegador. Em uso: ${PROVIDERS[state.ai.provider].label}.`;
    render({ keepScroll: true });
    return;
  }
  if (form.dataset.action !== "save-config") return;
  event.preventDefault();
  readSettingsForm();
  const problem = validateConfig(state.config);
  state.error = problem;
  state.notice = problem ? "" : "Configuração salva neste navegador.";
  render();
});

document.body.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  if (event.target.dataset?.action !== "chat-draft") return;
  event.preventDefault();
  event.target.form?.requestSubmit();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !state.ui.commentsOpen) return;
  state.ui.commentsOpen = false;
  render({ keepScroll: true });
});

window.addEventListener("hashchange", () => {
  const route = location.hash.replace(/^#/, "") || "dashboard";
  state.route = pages[route] ? route : "dashboard";
  render();
});

render();

void ROUTES;
