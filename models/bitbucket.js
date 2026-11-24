import { authHeader, cleanToken, normalizeWorkspace } from "./config.js";

const API = "https://api.bitbucket.org";
let preferProxy = false;

function canProxy() {
  return location.protocol === "http:" || location.protocol === "https:";
}

function targetsFor(path) {
  if (path.startsWith(API)) {
    return { direct: path, proxy: `${location.origin}/bitbucket${path.slice(API.length)}` };
  }
  const relative = path.startsWith("/") ? path : `/${path}`;
  return { direct: `${API}${relative}`, proxy: `${location.origin}/bitbucket${relative}` };
}

export function explainError(error) {
  if (!error) return "Falha desconhecida.";
  if (error.name === "AbortError") return "Consulta cancelada.";
  if (error instanceof TypeError || error.network) {
    return "O navegador não conseguiu falar com o Bitbucket. Abra o painel por iniciar.bat em http://127.0.0.1:8765 e tente de novo.";
  }
  if (error.status === 401) {
    return "O Bitbucket recusou a autenticação. Access token de workspace usa o modo Access token (Bearer) e é provado em /2.0/repositories/{workspace}, não em /2.0/user.";
  }
  if (error.status === 403) return `Sem permissão para este recurso. ${error.message || ""}`.trim();
  if (error.status === 404) return `Não encontrado. Confira o slug do workspace. ${error.message || ""}`.trim();
  if (error.status === 429) return "O Bitbucket limitou as consultas. Espere um pouco e atualize de novo.";
  return error.message || "Falha ao consultar o Bitbucket.";
}

function payloadMessage(data, status) {
  if (!data) return `HTTP ${status}`;
  if (typeof data.error === "string") return data.error;
  if (data.error?.message) return data.error.message;
  if (typeof data.message === "string") return data.message;
  return `HTTP ${status}`;
}

async function send(url, headers, signal) {
  return fetch(url, {
    method: "GET",
    headers,
    signal,
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer"
  });
}

export class BitbucketClient {
  constructor(config, mode, signal) {
    this.config = config;
    this.mode = mode || config.authMode;
    this.signal = signal;
    this.header = authHeader(config, this.mode);
  }

  async get(path, retried = false) {
    const targets = targetsFor(path);
    const order = preferProxy ? ["proxy", "direct"] : ["direct", "proxy"];
    let response;
    let networkError;
    for (const kind of order) {
      if (kind === "proxy" && !canProxy()) continue;
      try {
        response = await send(targets[kind], { Accept: "application/json", Authorization: this.header }, this.signal);
        preferProxy = kind === "proxy";
        networkError = null;
        break;
      } catch (error) {
        if (error.name === "AbortError") throw error;
        networkError = error;
      }
    }
    if (!response) {
      const error = new TypeError(networkError?.message || "falha de rede");
      error.network = true;
      throw error;
    }
    if (response.status === 429 && !retried) {
      const wait = Math.min(Number(response.headers.get("retry-after") || 2), 8);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      return this.get(path, true);
    }
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text.slice(0, 280) };
      }
    }
    if (!response.ok) {
      const error = new Error(payloadMessage(data, response.status));
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async list(path, { maxPages = 20, pagelen = 50, maxItems = Infinity } = {}) {
    const first = new URL(path, API);
    if (!first.searchParams.has("pagelen")) first.searchParams.set("pagelen", String(pagelen));
    let next = `${first.pathname}${first.search}`;
    const values = [];
    let total = null;
    for (let page = 0; page < maxPages && next; page += 1) {
      const data = await this.get(next);
      if (typeof data?.size === "number") total = data.size;
      values.push(...(data?.values || []));
      if (values.length >= maxItems) {
        return {
          values: values.slice(0, maxItems),
          total: total ?? values.length,
          truncated: Boolean(data?.next) || (total != null && total > maxItems)
        };
      }
      next = data?.next || null;
    }
    return { values, total: total ?? values.length, truncated: Boolean(next) };
  }
}

export function createClient(config, signal) {
  return new BitbucketClient(config, config.authMode, signal);
}

function slimUser(user) {
  if (!user) return null;
  return {
    display_name: user.display_name || user.nickname || "Conta",
    nickname: user.nickname || user.username || "",
    uuid: user.uuid || "",
    account_id: user.account_id || "",
    avatar: user.links?.avatar?.href || ""
  };
}

export function slimWorkspace(workspace) {
  return {
    slug: workspace.slug,
    name: workspace.name || workspace.slug,
    uuid: workspace.uuid || ""
  };
}

export function slimRepo(repo) {
  return {
    slug: repo.slug,
    name: repo.name || repo.slug,
    full_name: repo.full_name,
    description: repo.description || "",
    is_private: Boolean(repo.is_private),
    language: repo.language || "",
    updated_on: repo.updated_on || "",
    size: repo.size ?? null,
    html: repo.links?.html?.href || "",
    clone: (repo.links?.clone || []).map((link) => ({ name: link.name, href: link.href })),
    project: repo.project ? { key: repo.project.key || "", name: repo.project.name || "" } : null,
    mainbranch: repo.mainbranch?.name || ""
  };
}

function accountOf(entry) {
  if (!entry) return null;
  if (entry.user && (entry.user.display_name || entry.user.uuid || entry.user.nickname)) return entry.user;
  if (entry.display_name || entry.uuid || entry.nickname) return entry;
  return null;
}

function reviewerState(pr) {
  const participants = Array.isArray(pr.participants) ? pr.participants : [];
  const listed = Array.isArray(pr.reviewers) ? pr.reviewers : [];
  const fromParticipants = participants.filter((item) => item.role === "REVIEWER");
  const merged = [];
  const seen = new Set();
  for (const entry of [...listed, ...fromParticipants]) {
    const user = accountOf(entry);
    if (!user) continue;
    const key = user.uuid || user.nickname || user.display_name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const participant = participants.find((item) => item.user?.uuid && item.user.uuid === user.uuid) || entry;
    merged.push({
      name: user.display_name || user.nickname || "reviewer",
      nickname: user.nickname || "",
      uuid: user.uuid || "",
      approved: Boolean(participant?.approved),
      state: participant?.state || (participant?.approved ? "approved" : "pending")
    });
  }
  return merged;
}

export function slimPullRequest(pr, repo) {
  const reviewers = reviewerState(pr);
  const repoName = repo?.full_name || pr.destination?.repository?.full_name || pr.source?.repository?.full_name || "";
  const id = pr.id;
  return {
    key: `${repoName}#${id}`,
    id,
    title: pr.title || `PR ${id}`,
    state: pr.state || "OPEN",
    draft: Boolean(pr.draft),
    created_on: pr.created_on || "",
    updated_on: pr.updated_on || "",
    comment_count: pr.comment_count || 0,
    task_count: pr.task_count || 0,
    author: {
      display_name: pr.author?.display_name || "Desconhecido",
      nickname: pr.author?.nickname || "",
      uuid: pr.author?.uuid || "",
      avatar: pr.author?.links?.avatar?.href || ""
    },
    reviewers,
    reviewersLoaded: Array.isArray(pr.reviewers) || Array.isArray(pr.participants),
    approved: reviewers.some((item) => item.approved) || (pr.participants || []).some((item) => item.approved),
    source: pr.source?.branch?.name || "",
    destination: pr.destination?.branch?.name || "",
    html: pr.links?.html?.href || "",
    repo: repoName,
    repoSlug: repo?.slug || repoName.split("/")[1] || "",
    summary: pr.summary?.raw || ""
  };
}

export function slimPipeline(pipeline, repo) {
  const result = pipeline.state?.result?.name || (pipeline.state?.name && pipeline.state.name !== "COMPLETED" ? pipeline.state.name : "UNKNOWN");
  return {
    repo: repo.full_name,
    build: pipeline.build_number ?? "",
    uuid: pipeline.uuid || "",
    created_on: pipeline.created_on || "",
    completed_on: pipeline.completed_on || "",
    result,
    branch: pipeline.target?.ref_name || pipeline.target?.selector?.pattern || "",
    creator: pipeline.creator?.display_name || pipeline.creator?.nickname || "",
    html: repo.full_name && pipeline.build_number
      ? `https://bitbucket.org/${repo.full_name}/pipelines/results/${pipeline.build_number}`
      : ""
  };
}

export function slimRunner(runner) {
  const labels = runner.labels || [];
  return {
    name: runner.name || runner.uuid || "runner",
    status: typeof runner.state === "string" ? runner.state : runner.state?.status || runner.state?.name || "DESCONHECIDO",
    labels: labels.map((label) => (typeof label === "string" ? label : label.name || "")).filter(Boolean),
    created_on: runner.created_on || "",
    updated_on: runner.updated_on || ""
  };
}

export function slimProject(project) {
  return {
    key: project.key,
    name: project.name || project.key,
    description: project.description || "",
    is_private: Boolean(project.is_private),
    updated_on: project.updated_on || "",
    html: project.links?.html?.href || ""
  };
}

function authModes(config) {
  const requested = config.authMode || "bearer";
  if (requested === "bearer") return [requested];
  return cleanToken(config.token) ? [requested, "bearer"] : [requested];
}

async function optionalUser(client) {
  try {
    return { user: slimUser(await client.get("/2.0/user")), userError: "" };
  } catch (error) {
    if (error.name === "AbortError") throw error;
    return {
      user: null,
      userError: "Este token não responde /2.0/user. Em access token de workspace isso é esperado."
    };
  }
}

async function optionalWorkspaces(client, workspace) {
  try {
    const listed = await client.list("/2.0/workspaces", { pagelen: 100, maxPages: 2, maxItems: 100 });
    const workspaces = listed.values.map(slimWorkspace).filter((item) => item.slug);
    if (workspace && !workspaces.some((item) => item.slug === workspace)) {
      workspaces.unshift({ slug: workspace, name: workspace, uuid: "" });
    }
    return workspaces;
  } catch (error) {
    if (error.name === "AbortError") throw error;
    return workspace ? [{ slug: workspace, name: workspace, uuid: "" }] : [];
  }
}

export async function connect(config, signal, onTry) {
  const requested = config.authMode || "bearer";
  const modes = authModes(config);
  let lastError;
  for (const mode of modes) {
    if (mode === "basic-email" && !config.email.includes("@")) continue;
    if (mode === "basic-user" && !config.username.trim()) continue;
    onTry?.(mode);
    try {
      const client = new BitbucketClient(config, mode, signal);
      const workspace = workspaceSlug(config);
      if (mode === "bearer") {
        if (!workspace) {
          const error = new Error("Token de workspace precisa do slug, por exemplo sophatech.");
          error.status = 400;
          throw error;
        }
        let userError = "";
        try {
          await client.get(`/2.0/repositories/${encodeURIComponent(workspace)}?pagelen=1`);
        } catch (error) {
          if (error.name === "AbortError") throw error;
          if (error.status === 404) {
            const missing = new Error(`Workspace "${workspace}" não encontrado. Confira o slug.`);
            missing.status = 404;
            throw missing;
          }
          if (error.status !== 403) throw error;
          userError = "Token aceito, mas sem permissão para listar repositórios desse workspace.";
        }
        const account = await optionalUser(client);
        return {
          client,
          mode,
          user: account.user,
          userError: userError || account.userError,
          workspaces: await optionalWorkspaces(client, workspace)
        };
      }
      let user = null;
      let userError = "";
      try {
        user = slimUser(await client.get("/2.0/user"));
      } catch (error) {
        if (error.status === 401 || error.name === "AbortError") throw error;
        userError = error.message;
      }
      const listed = await client.list("/2.0/workspaces", { pagelen: 100, maxPages: 5, maxItems: 300 });
      return {
        client,
        mode,
        user,
        userError,
        workspaces: listed.values.map(slimWorkspace).filter((item) => item.slug)
      };
    } catch (error) {
      lastError = error;
      if (error.name === "AbortError") throw error;
      if (mode === requested && requested === "bearer") throw error;
      if (error.status && error.status !== 401 && error.status !== 403) throw error;
    }
  }
  throw lastError || new Error("Não foi possível autenticar.");
}

export async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const size = Math.min(limit, items.length) || 0;
  await Promise.all(Array.from({ length: size }, run));
  return results;
}

export function workspaceSlug(config) {
  return normalizeWorkspace(config.workspace);
}
