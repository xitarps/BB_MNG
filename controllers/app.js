import { destinationFor, normalizeWorkspace, validateConfig, clampInt, cleanToken } from "../models/config.js";
import { explainError, createClient, slimPullRequest } from "../models/bitbucket.js";
import { buildClonePlan } from "../models/clone-script.js";
import { filterRepos } from "../models/metrics.js";
import { clearSnapshot, forgetToken, loadConfig, loadSnapshot, loadWorkspaces, saveConfig } from "../models/storage.js";
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

const pages = {
  dashboard: renderDashboard,
  prs: renderPullRequests,
  repos: renderRepositories,
  pipelines: renderPipelines,
  runners: renderRunners,
  clone: renderClone,
  settings: renderSettings
};

const state = {
  route: "dashboard",
  config: loadConfig(),
  snapshot: loadSnapshot(),
  workspaces: loadWorkspaces(),
  user: loadSnapshot()?.user || null,
  userError: "",
  syncing: false,
  statusText: "",
  error: "",
  notice: "",
  abort: null,
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
    manualSlug: "",
    manualRepos: []
  }
};

if (state.snapshot?.fetchedAt) state.statusText = `Cache local de ${formatDate(state.snapshot.fetchedAt)}.`;
const initialRoute = location.hash.replace(/^#/, "");
if (pages[initialRoute]) state.route = initialRoute;
else if (!state.config.token) state.route = "settings";

function render({ keepScroll = false } = {}) {
  const content = document.querySelector(".content");
  const y = keepScroll ? content?.scrollTop || 0 : 0;
  const page = pages[state.route] || renderDashboard;
  const root = document.getElementById("app");
  root.classList.remove("boot");
  root.innerHTML = renderShell(state, page(state));
  const next = document.querySelector(".content");
  if (next) next.scrollTop = y;
  ensureReviewers();
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
  const slot = control.dataset.live;
  if (slot === "pr-table") patch("pr-table", renderPrTable(state));
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
    if (error.name !== "AbortError") state.error = explainError(error);
    else state.statusText = "Consulta cancelada.";
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
  if (action === "sync") {
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
    go("clone");
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
    const plan = buildClonePlan(cloneSelection(state), state.config);
    if (!plan.script) return;
    navigator.clipboard.writeText(plan.script).then(() => {
      state.notice = state.config.includeTokenInUrl
        ? "Script copiado com o token. Não deixe esse texto salvo num arquivo do projeto."
        : "Script copiado.";
      state.error = "";
      render({ keepScroll: true });
    }).catch(() => {
      state.error = "A área de transferência foi bloqueada. Selecione o script e copie manualmente.";
      render({ keepScroll: true });
    });
  } else if (action === "download-script") {
    const plan = buildClonePlan(cloneSelection(state), state.config);
    if (!plan.script) return;
    download(plan.filename, plan.script, plan.shell);
    state.notice = state.config.includeTokenInUrl
      ? "Download gerado com o token na URL. Apague o arquivo depois de clonar."
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
  applyLiveFilter(target.closest("[data-filter]") || target);
});

document.body.addEventListener("submit", (event) => {
  const form = event.target.closest("form[data-action='save-config']");
  if (!form) return;
  event.preventDefault();
  readSettingsForm();
  const problem = validateConfig(state.config);
  state.error = problem;
  state.notice = problem ? "" : "Configuração salva neste navegador.";
  render();
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
