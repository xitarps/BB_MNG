import { cleanToken } from "../models/config.js";
import {
  connect,
  createClient,
  explainError,
  mapPool,
  slimPipeline,
  slimProject,
  slimPullRequest,
  slimRepo,
  slimRunner,
  slimComment,
  workspaceSlug
} from "../models/bitbucket.js";
import { saveConfig, saveSnapshot, saveWorkspaces } from "../models/storage.js";

export async function testConnection(state, signal, onStatus) {
  const result = await connect(state.config, signal, (mode) => onStatus?.(`Testando ${mode}…`));
  state.config.lastAuthMode = result.mode;
  state.user = result.user;
  state.userError = result.userError || "";
  state.workspaces = result.workspaces;
  saveWorkspaces(result.workspaces);
  if (!workspaceSlug(state.config) && result.workspaces.length === 1) {
    state.config.workspace = result.workspaces[0].slug;
  }
  saveConfig(state.config);
  return result;
}

function encodeWs(config) {
  return encodeURIComponent(workspaceSlug(config));
}

const PR_FIELDS = encodeURIComponent("+values.reviewers,+values.participants");
const COMMENT_PR_LIMIT = 100;
const COMMENTS_PER_PR = 200;
const COMMENT_BUDGET_CHARS = 400000;

async function commentsFor(client, workspace, pr) {
  const base = `/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(pr.repoSlug)}/pullrequests/${encodeURIComponent(pr.id)}/comments`;
  let page;
  try {
    page = await client.list(`${base}?sort=-created_on`, { pagelen: 50, maxPages: 4, maxItems: COMMENTS_PER_PR });
  } catch (error) {
    if (error.name === "AbortError" || error.status !== 400) throw error;
    const all = await client.list(base, { pagelen: 50, maxPages: 4 });
    page = { values: all.values.slice(-COMMENTS_PER_PR), truncated: all.truncated || all.values.length > COMMENTS_PER_PR };
  }
  return { comments: (page.values || []).filter((comment) => !comment.deleted).reverse().map(slimComment), truncated: Boolean(page.truncated) };
}

// Fills pr.comments for PRs that have comments, keeping the snapshot inside the browser storage budget.
async function enrichComments(client, workspace, prs) {
  const candidates = prs.filter((pr) => pr.comment_count > 0 && pr.repoSlug).slice(0, COMMENT_PR_LIMIT);
  const fetched = await mapPool(candidates, 4, async (pr) => {
    try {
      return await commentsFor(client, workspace, pr);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      return null;
    }
  });
  let used = 0;
  let skipped = 0;
  let failed = 0;
  candidates.forEach((pr, index) => {
    const result = fetched[index];
    if (!result) {
      failed += 1;
      return;
    }
    const size = JSON.stringify(result.comments).length;
    if (used + size > COMMENT_BUDGET_CHARS) {
      skipped += 1;
      return;
    }
    used += size;
    pr.comments = result.comments;
    pr.commentsTruncated = result.truncated;
    pr.commentsLoaded = true;
  });
  return { failed, skipped, overLimit: Math.max(0, prs.filter((pr) => pr.comment_count > 0).length - candidates.length) };
}

async function pullRequestsFor(client, workspace, repo, prState) {
  const path = `/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo.slug)}/pullrequests?state=${encodeURIComponent(prState)}&fields=${PR_FIELDS}`;
  const page = await client.list(path, { pagelen: 50, maxPages: 3, maxItems: 100 });
  return page.values.map((pr) => slimPullRequest(pr, repo));
}

async function pipelinesFor(client, workspace, repo) {
  const base = `/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo.slug)}/pipelines/`;
  try {
    const data = await client.get(`${base}?pagelen=5&sort=-created_on`);
    return (data.values || []).map((item) => slimPipeline(item, repo));
  } catch (error) {
    if (error.status !== 400) throw error;
    const data = await client.get(`${base}?pagelen=5`);
    return (data.values || []).map((item) => slimPipeline(item, repo));
  }
}

export async function refreshReviewers(state, signal, prs) {
  const workspace = workspaceSlug(state.config);
  const pending = (prs || []).filter((pr) => !pr.reviewersLoaded && pr.repoSlug);
  if (!pending.length || !workspace) return 0;
  const client = createClient(state.config, signal);
  await mapPool(pending, 5, async (pr) => {
    try {
      const full = await client.get(`/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(pr.repoSlug)}/pullrequests/${encodeURIComponent(pr.id)}`);
      const slim = slimPullRequest(full, { slug: pr.repoSlug, full_name: pr.repo });
      pr.reviewers = slim.reviewers;
      pr.approved = slim.approved;
    } catch (error) {
      if (error.name === "AbortError") throw error;
    }
    pr.reviewersLoaded = true;
  });
  saveSnapshot(state.snapshot, cleanToken(state.config.token));
  return pending.length;
}

export async function syncAll(state, signal, onStatus) {
  if (state.config.lastAuthMode !== state.config.authMode) await testConnection(state, signal, onStatus);
  const workspace = workspaceSlug(state.config);
  const client = createClient(state.config, signal);
  const sectionErrors = {};
  onStatus?.("Lendo projetos e repositórios…");
  const projectsPromise = client.list(`/2.0/workspaces/${encodeWs(state.config)}/projects`, { pagelen: 50, maxPages: 8 })
    .catch((error) => {
      if (error.name === "AbortError") throw error;
      sectionErrors.projects = explainError(error);
      return { values: [], total: 0, truncated: false };
    });
  const repoPath = `/2.0/repositories/${encodeWs(state.config)}`;
  const repoQuery = { pagelen: 50, maxPages: Math.ceil(state.config.maxRepos / 50), maxItems: state.config.maxRepos };
  const reposPromise = client.list(`${repoPath}?sort=-updated_on`, repoQuery).catch(async (error) => {
    if (error.name === "AbortError" || error.status !== 400) throw error;
    return client.list(repoPath, repoQuery);
  });
  const [projectsResult, reposResult] = await Promise.all([projectsPromise, reposPromise]);
  const repos = reposResult.values.map(slimRepo);
  const prState = state.config.prState || "OPEN";
  let denied = 0;
  let done = 0;
  const chunks = await mapPool(repos, 4, async (repo) => {
    try {
      return await pullRequestsFor(client, workspace, repo, prState);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      denied += 1;
      return [];
    } finally {
      done += 1;
      onStatus?.(`Pull requests ${done}/${repos.length}`);
    }
  });
  const byKey = new Map();
  for (const pr of chunks.flat()) byKey.set(pr.key, pr);
  if (state.user?.uuid) {
    try {
      const own = await client.list(`/2.0/pullrequests/${encodeURIComponent(state.user.uuid)}?state=${encodeURIComponent(prState)}&fields=${PR_FIELDS}`, {
        pagelen: 50,
        maxPages: 2,
        maxItems: 80
      });
      for (const pr of own.values.map((item) => slimPullRequest(item))) {
        if (pr.repo.startsWith(`${workspace}/`) && !byKey.has(pr.key)) byKey.set(pr.key, pr);
      }
    } catch (error) {
      if (error.name === "AbortError") throw error;
    }
  }
  if (denied) sectionErrors.prs = `${denied} repositório(s) não devolveram pull requests.`;

  const pipelineSample = repos.slice(0, state.config.pipelineRepos);
  const pipelines = [];
  if (pipelineSample.length) {
    onStatus?.("Lendo amostra de pipelines…");
    let pipelineDenied = 0;
    const pipelineChunks = await mapPool(pipelineSample, 3, async (repo) => {
      try {
        return await pipelinesFor(client, workspace, repo);
      } catch (error) {
        if (error.name === "AbortError") throw error;
        pipelineDenied += 1;
        return [];
      }
    });
    pipelines.push(...pipelineChunks.flat());
    if (pipelineDenied === pipelineSample.length) {
      sectionErrors.pipelines = "Nenhum repositório da amostra devolveu pipelines. O recurso pode estar desligado neles.";
    } else if (pipelineDenied) {
      sectionErrors.pipelines = `${pipelineDenied} repositório(s) não devolveram pipelines.`;
    }
  }

  onStatus?.("Lendo runners e permissões…");
  let runners = [];
  try {
    const runnerPage = await client.list(`/2.0/workspaces/${encodeWs(state.config)}/pipelines-config/runners`, { pagelen: 50, maxPages: 4, maxItems: 150 });
    runners = runnerPage.values.map(slimRunner);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    sectionErrors.runners = explainError(error);
  }

  let permissions = [];
  try {
    const permissionPage = await client.list("/2.0/user/permissions/repositories", { pagelen: 100, maxPages: 2, maxItems: 200 });
    permissions = permissionPage.values
      .map((item) => ({ full_name: item.repository?.full_name || "", permission: item.permission || "" }))
      .filter((item) => item.full_name.startsWith(`${workspace}/`));
  } catch (error) {
    if (error.name === "AbortError") throw error;
  }

  const pullRequests = [...byKey.values()].sort((a, b) => new Date(b.updated_on) - new Date(a.updated_on));
  onStatus?.("Lendo comentários dos pull requests…");
  const commentStats = await enrichComments(client, workspace, pullRequests);
  if (commentStats.failed || commentStats.skipped || commentStats.overLimit) {
    const parts = [];
    if (commentStats.failed) parts.push(`${commentStats.failed} PR(s) sem comentários por erro`);
    if (commentStats.skipped) parts.push(`${commentStats.skipped} PR(s) fora do limite de armazenamento`);
    if (commentStats.overLimit) parts.push(`comentários lidos só de ${COMMENT_PR_LIMIT} PRs`);
    sectionErrors.comments = `Comentários incompletos: ${parts.join("; ")}.`;
  }
  const probes = [
    { id: "account", label: "Account Read", ok: Boolean(state.user), message: state.user?.display_name || state.userError || "conta não identificada" },
    { id: "projects", label: "Projects Read", ok: !sectionErrors.projects, message: sectionErrors.projects || `${projectsResult.values.length} projetos` },
    { id: "repos", label: "Repositories Read", ok: true, message: `${repos.length} repositórios nesta amostra` },
    { id: "prs", label: "Pull requests Read", ok: repos.length === 0 || denied < repos.length, message: sectionErrors.prs || `${pullRequests.length} pull requests` },
    { id: "pipelines", label: "Pipelines Read", ok: !sectionErrors.pipelines || pipelines.length > 0, message: sectionErrors.pipelines || `${pipelines.length} execuções na amostra` },
    { id: "runners", label: "Runners Read", ok: !sectionErrors.runners, message: sectionErrors.runners || `${runners.length} runners` }
  ];
  const snapshot = {
    version: 1,
    fetchedAt: new Date().toISOString(),
    workspace,
    prState,
    user: state.user,
    projects: projectsResult.values.map(slimProject),
    repos,
    repoTotal: reposResult.total,
    repoTruncated: reposResult.truncated,
    pullRequests,
    pipelines,
    runners,
    permissions,
    probes,
    sectionErrors
  };
  const saved = saveSnapshot(snapshot, cleanToken(state.config.token));
  state.snapshot = snapshot;
  onStatus?.(saved ? `Atualizado agora · ${pullRequests.length} pull requests.` : "Atualizado, mas o cache local não coube no navegador.");
  return snapshot;
}
