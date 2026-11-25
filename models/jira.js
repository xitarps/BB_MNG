import { jiraAuthHeader, normalizeJiraSite } from "./jira-config.js";

const FIELDS = [
  "summary", "status", "issuetype", "priority", "assignee", "reporter", "created", "updated",
  "duedate", "resolutiondate", "labels", "project"
].join(",");

function failure(message, extra = {}) {
  const error = new Error(message);
  error.userMessage = message;
  return Object.assign(error, extra);
}

function responseMessage(data) {
  if (!data) return "";
  const first = Array.isArray(data.errorMessages) ? data.errorMessages.find(Boolean) : "";
  return first || data.message || data.error?.message || "";
}

function explainStatus(status, detail) {
  if (status === 401) return "O Jira recusou o e-mail ou o API token. Use o e-mail da conta Atlassian e um API token sem escopos.";
  if (status === 403) return `Sem permissão para este recurso no Jira. ${detail}`.trim();
  if (status === 404) return `Não encontrado. Confira o endereço do site do Jira. ${detail}`.trim();
  if (status === 429) return "O Jira limitou as consultas. Espere um pouco e atualize de novo.";
  if (status >= 300 && status < 400) return "O Jira respondeu com um redirecionamento. Confira o endereço do site (empresa.atlassian.net).";
  if (status === 400) return `O Jira recusou a consulta. ${detail}`.trim();
  return detail || `O Jira respondeu com erro HTTP ${status}.`;
}

export class JiraClient {
  constructor(config, signal) {
    this.host = normalizeJiraSite(config.site);
    this.header = jiraAuthHeader(config);
    this.signal = signal;
  }

  get(path) {
    return this.request("GET", path);
  }

  async request(method, path, body) {
    if (!/^https?:$/.test(location.protocol)) {
      throw failure("O Jira só responde pelo servidor local. Abra o painel por iniciar.bat ou iniciar.sh em http://127.0.0.1:8765.");
    }
    const headers = { Accept: "application/json", Authorization: this.header };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await fetch(`${location.origin}/jira/${this.host}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: this.signal,
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer"
      });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      throw failure("Não foi possível falar com o servidor local do painel. O Jira não aceita chamadas diretas do navegador: abra por iniciar.bat ou iniciar.sh em http://127.0.0.1:8765.", { cause: error });
    }
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (response.status === 404 && text.trim() === "not found") {
      throw failure("O servidor local do painel está numa versão antiga e não tem a rota do Jira. Feche o iniciar.sh ou iniciar.bat (Ctrl+C) e abra de novo.", { status: 404 });
    }
    if (!response.ok) {
      const where = path.split("?")[0];
      const hint = [403, 404].includes(response.status) ? ` (consulta: ${where})` : "";
      throw failure(`${explainStatus(response.status, responseMessage(data))}${hint}`, { status: response.status });
    }
    // Jira answers writes with 201/204 and no body.
    if (data === null && method === "GET") throw failure("O Jira devolveu uma resposta que não é JSON. Confira o endereço do site.");
    return data;
  }

  myself() {
    return this.get("/rest/api/3/myself");
  }

  createIssue(fields) {
    return this.request("POST", "/rest/api/3/issue", { fields });
  }

  updateIssue(key, { fields, update }) {
    const body = {};
    if (fields) body.fields = fields;
    if (update) body.update = update;
    return this.request("PUT", `/rest/api/3/issue/${key}`, body);
  }

  addComment(key, body) {
    return this.request("POST", `/rest/api/3/issue/${key}/comment`, { body });
  }

  transitions(key) {
    return this.get(`/rest/api/3/issue/${key}/transitions`);
  }

  transition(key, id) {
    return this.request("POST", `/rest/api/3/issue/${key}/transitions`, { transition: { id } });
  }

  setAssignee(key, accountId) {
    return this.request("PUT", `/rest/api/3/issue/${key}/assignee`, { accountId });
  }

  async projects({ maxPages = 10 } = {}) {
    const values = [];
    let startAt = 0;
    for (let page = 0; page < maxPages; page += 1) {
      const data = await this.get(`/rest/api/3/project/search?maxResults=50&startAt=${startAt}&expand=lead`);
      values.push(...(data.values || []));
      if (data.isLast !== false || !data.values?.length) return { values, truncated: false };
      startAt += data.values.length;
    }
    return { values, truncated: true };
  }

  async searchIssues(jql, { maxIssues = 300 } = {}) {
    const values = [];
    let token = "";
    for (;;) {
      const size = Math.min(100, maxIssues - values.length);
      const query = `jql=${encodeURIComponent(jql)}&fields=${FIELDS}&maxResults=${size}${token ? `&nextPageToken=${encodeURIComponent(token)}` : ""}`;
      const data = await this.get(`/rest/api/3/search/jql?${query}`);
      values.push(...(data.issues || []));
      token = data.nextPageToken || "";
      if (data.isLast !== false || !token) return { values, truncated: false };
      if (values.length >= maxIssues) return { values, truncated: true };
    }
  }
}

export function slimJiraUser(user) {
  return user ? { display_name: user.displayName || "Conta", email: user.emailAddress || "", account_id: user.accountId || "" } : null;
}

export function slimJiraProject(project) {
  return {
    key: project.key,
    name: project.name || project.key,
    type: project.projectTypeKey || "",
    lead: project.lead?.displayName || "",
    is_private: Boolean(project.isPrivate)
  };
}

export function slimJiraIssue(issue, host) {
  const fields = issue.fields || {};
  return {
    key: issue.key,
    summary: fields.summary || "",
    status: fields.status?.name || "",
    status_category: fields.status?.statusCategory?.key || "",
    type: fields.issuetype?.name || "",
    priority: fields.priority?.name || "",
    assignee: fields.assignee?.displayName || "",
    reporter: fields.reporter?.displayName || "",
    created: fields.created || "",
    updated: fields.updated || "",
    due: fields.duedate || "",
    resolved: fields.resolutiondate || "",
    labels: fields.labels || [],
    project: fields.project?.key || "",
    project_name: fields.project?.name || "",
    url: host && issue.key ? `https://${host}/browse/${issue.key}` : ""
  };
}
