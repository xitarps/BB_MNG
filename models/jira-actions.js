import { slimJiraIssue, slimJiraProject } from "./jira.js";

const KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
const PROJECT = /^[A-Z][A-Z0-9_]+$/;
const ACCOUNT = /^[A-Za-z0-9:_-]{1,128}$/;
const LABEL = /^[^\s,]{1,255}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const READ_LIMIT = 40000;
const COMMENTS_SHOWN = 10;

const str = { type: "string" };
const keyParam = { type: "string", description: "Chave da issue, ex: PROJ-123" };
const labelsParam = { type: "array", items: { type: "string" }, description: "Rótulos sem espaços" };

const TOOLS = [
  {
    name: "jira_list_projects",
    write: false,
    description: "Lista os projetos do Jira que o usuário pode ver.",
    properties: {},
    required: []
  },
  {
    name: "jira_search_issues",
    write: false,
    description: "Busca issues com JQL, ex: project = PROJ AND statusCategory != Done ORDER BY updated DESC.",
    properties: {
      jql: { type: "string", description: "Consulta JQL" },
      max_results: { type: "integer", description: "Quantidade (1 a 50)" }
    },
    required: ["jql"]
  },
  {
    name: "jira_get_issue",
    write: false,
    description: "Mostra uma issue com descrição e os últimos comentários.",
    properties: { key: keyParam },
    required: ["key"]
  },
  {
    name: "jira_list_transitions",
    write: false,
    description: "Lista os status para os quais a issue pode ir agora.",
    properties: { key: keyParam },
    required: ["key"]
  },
  {
    name: "jira_list_issue_types",
    write: false,
    description: "Lista os tipos de issue de um projeto (Bug, Task, Story...).",
    properties: { project: { type: "string", description: "Chave do projeto, ex: PROJ" } },
    required: ["project"]
  },
  {
    name: "jira_find_users",
    write: false,
    description: "Procura usuários atribuíveis em um projeto. Devolve account_id e nome para usar em responsável.",
    properties: {
      project: { type: "string", description: "Chave do projeto" },
      query: { type: "string", description: "Parte do nome ou e-mail" }
    },
    required: ["project", "query"]
  },
  {
    name: "jira_create_issue",
    write: true,
    description: "Cria uma issue. Exige confirmação do usuário antes de executar.",
    properties: {
      project: { type: "string", description: "Chave do projeto" },
      issue_type: { type: "string", description: "Nome do tipo, ex: Task" },
      summary: { type: "string", description: "Título (até 255 caracteres)" },
      description: { type: "string", description: "Descrição em texto simples" },
      priority: { type: "string", description: "Nome da prioridade, ex: High" },
      labels: labelsParam,
      assignee_account_id: { type: "string", description: "account_id do responsável" },
      due_date: { type: "string", description: "Data limite AAAA-MM-DD" }
    },
    required: ["project", "issue_type", "summary"]
  },
  {
    name: "jira_update_issue",
    write: true,
    description: "Altera título, descrição, prioridade, data limite ou rótulos de uma issue. Exige confirmação.",
    properties: {
      key: keyParam,
      summary: { type: "string", description: "Novo título" },
      description: { type: "string", description: "Nova descrição em texto simples" },
      priority: { type: "string", description: "Nome da prioridade" },
      due_date: { type: "string", description: "Data limite AAAA-MM-DD" },
      add_labels: labelsParam,
      remove_labels: labelsParam
    },
    required: ["key"]
  },
  {
    name: "jira_add_comment",
    write: true,
    description: "Adiciona um comentário em uma issue. Exige confirmação.",
    properties: { key: keyParam, body: { type: "string", description: "Texto do comentário" } },
    required: ["key", "body"]
  },
  {
    name: "jira_transition_issue",
    write: true,
    description: "Move a issue para outro status, ex: Em Andamento ou Concluído. Exige confirmação.",
    properties: { key: keyParam, status: { type: "string", description: "Nome do status de destino" } },
    required: ["key", "status"]
  },
  {
    name: "jira_set_assignee",
    write: true,
    description: "Troca o responsável de uma issue. Use account_id vazio para remover o responsável. Exige confirmação.",
    properties: {
      key: keyParam,
      account_id: { type: "string", description: "account_id do novo responsável, ou vazio para remover" }
    },
    required: ["key"]
  }
];

export const JIRA_TOOL_NAMES = TOOLS.map((tool) => tool.name);

export function jiraToolDefinitions() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: { type: "object", properties: tool.properties, required: tool.required }
  }));
}

export function isJiraWriteTool(name) {
  return TOOLS.some((tool) => tool.name === name && tool.write);
}

function fail(message) {
  return new Error(message);
}

function text(args, name, { required = false, max = 200, pattern, label = name, upper = false } = {}) {
  const raw = args?.[name];
  const value = raw === undefined || raw === null ? "" : String(raw).trim();
  if (!value) {
    if (required) throw fail(`Falta o campo ${label}.`);
    return "";
  }
  const normalized = upper ? value.toUpperCase() : value;
  if (normalized.length > max) throw fail(`${label} passa de ${max} caracteres.`);
  if (pattern && !pattern.test(normalized)) throw fail(`${label} tem formato inválido.`);
  return normalized;
}

function projectKey(args) {
  return text(args, "project", { required: true, max: 60, pattern: PROJECT, label: "projeto", upper: true });
}

function issueKey(args) {
  return text(args, "key", { required: true, max: 40, pattern: KEY, label: "issue", upper: true });
}

function accountId(args, { required = false } = {}) {
  return text(args, "account_id", { required, max: 128, pattern: ACCOUNT, label: "account_id" });
}

function dueDate(args) {
  const value = text(args, "due_date", { max: 10, pattern: DATE, label: "data limite" });
  if (value && Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw fail("data limite inválida.");
  return value;
}

function labels(args, name) {
  const raw = args?.[name];
  if (raw === undefined || raw === null || raw === "") return [];
  if (!Array.isArray(raw)) throw fail(`${name} deve ser uma lista.`);
  if (raw.length > 20) throw fail(`${name} aceita no máximo 20 rótulos.`);
  return raw.map((value) => {
    const label = String(value).trim();
    if (!LABEL.test(label)) throw fail(`rótulo inválido: "${label}" (sem espaços, até 255 caracteres).`);
    return label;
  });
}

function limit(value, fallback, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(1, number));
}

// Jira Cloud v3 takes rich text as Atlassian Document Format. Each line becomes a paragraph.
export function textToAdf(value) {
  const lines = String(value).split("\n").map((line) => line.trimEnd());
  return {
    type: "doc",
    version: 1,
    content: lines.map((line) => (line
      ? { type: "paragraph", content: [{ type: "text", text: line }] }
      : { type: "paragraph", content: [] }))
  };
}

const BLOCK_TYPES = new Set(["paragraph", "heading", "listItem", "codeBlock", "blockquote", "rule"]);

export function adfToText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  const inner = (node.content || []).map(adfToText).join("");
  return BLOCK_TYPES.has(node.type) ? `${inner}\n` : inner;
}

function plain(node, max) {
  return adfToText(node).replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

function clampOutput(value) {
  const json = JSON.stringify(value);
  if (json.length <= READ_LIMIT) return value;
  return { truncated: true, note: "resultado cortado para caber no contexto", json: json.slice(0, READ_LIMIT) };
}

async function resolveTransition(client, key, status) {
  const data = await client.transitions(key);
  const wanted = status.toLowerCase();
  const transitions = data.transitions || [];
  const match = transitions.find((item) => item.name?.toLowerCase() === wanted || item.to?.name?.toLowerCase() === wanted);
  if (!match) {
    const available = transitions.map((item) => item.name).join(", ") || "nenhuma";
    throw fail(`Não há transição "${status}" para ${key} agora. Disponíveis: ${available}.`);
  }
  return match;
}

export async function runJiraReadTool(client, name, args) {
  if (name === "jira_list_projects") {
    const data = await client.projects();
    return clampOutput({ projects: data.values.map(slimJiraProject), truncated: data.truncated });
  }
  if (name === "jira_search_issues") {
    const jql = text(args, "jql", { required: true, max: 1000, label: "JQL" });
    const data = await client.searchIssues(jql, { maxIssues: limit(args?.max_results, 20, 50) });
    return clampOutput({ issues: data.values.map((issue) => slimJiraIssue(issue, client.host)), truncated: data.truncated });
  }
  if (name === "jira_get_issue") {
    const key = issueKey(args);
    const data = await client.get(`/rest/api/3/issue/${key}?fields=summary,description,status,issuetype,priority,assignee,reporter,labels,duedate,project,comment`);
    const comments = (data.fields?.comment?.comments || []).slice(-COMMENTS_SHOWN).map((comment) => ({
      author: comment.author?.displayName || "",
      created: comment.created || "",
      body: plain(comment.body, 1000)
    }));
    return clampOutput({
      issue: { ...slimJiraIssue(data, client.host), description: plain(data.fields?.description, 4000) },
      comments
    });
  }
  if (name === "jira_list_transitions") {
    const data = await client.transitions(issueKey(args));
    return clampOutput({ transitions: (data.transitions || []).map((item) => ({ name: item.name, to: item.to?.name || "" })) });
  }
  if (name === "jira_list_issue_types") {
    const data = await client.get(`/rest/api/3/issue/createmeta/${projectKey(args)}/issuetypes`);
    const types = data.issueTypes || data.values || [];
    return clampOutput({ issue_types: types.map((item) => ({ name: item.name, subtask: Boolean(item.subtask) })) });
  }
  if (name === "jira_find_users") {
    const project = projectKey(args);
    const query = text(args, "query", { required: true, max: 100, label: "busca" });
    const users = await client.get(`/rest/api/3/user/assignable/search?project=${project}&query=${encodeURIComponent(query)}&maxResults=20`);
    return clampOutput({
      users: (Array.isArray(users) ? users : [])
        .filter((user) => user.active !== false)
        .map((user) => ({ account_id: user.accountId || "", display_name: user.displayName || "" }))
    });
  }
  throw fail(`Ferramenta desconhecida: ${name}`);
}

// Validates the arguments and describes the change for the confirmation card. Nothing runs here.
export async function prepareJiraWrite(client, name, args) {
  if (name === "jira_create_issue") {
    const project = projectKey(args);
    const issueType = text(args, "issue_type", { required: true, max: 60, label: "tipo de issue" });
    const summary = text(args, "summary", { required: true, max: 255, label: "título" });
    const description = text(args, "description", { max: 20000, label: "descrição" });
    const priority = text(args, "priority", { max: 50, label: "prioridade" });
    const tags = labels(args, "labels");
    const assignee = accountId(args);
    const due = dueDate(args);
    const fields = { project: { key: project }, issuetype: { name: issueType }, summary };
    if (description) fields.description = textToAdf(description);
    if (priority) fields.priority = { name: priority };
    if (tags.length) fields.labels = tags;
    if (assignee) fields.assignee = { accountId: assignee };
    if (due) fields.duedate = due;
    return {
      title: `Criar issue em ${project}`,
      lines: [
        `Tipo: ${issueType}`,
        `Título: ${summary}`,
        description ? `Descrição: ${description.slice(0, 400)}` : null,
        priority ? `Prioridade: ${priority}` : null,
        tags.length ? `Rótulos: ${tags.join(", ")}` : null,
        assignee ? `Responsável: ${assignee}` : null,
        due ? `Data limite: ${due}` : null
      ].filter(Boolean),
      run: async () => {
        const created = await client.createIssue(fields);
        return { key: created.key, url: `https://${client.host}/browse/${created.key}` };
      }
    };
  }

  if (name === "jira_update_issue") {
    const key = issueKey(args);
    const summary = text(args, "summary", { max: 255, label: "título" });
    const description = text(args, "description", { max: 20000, label: "descrição" });
    const priority = text(args, "priority", { max: 50, label: "prioridade" });
    const due = dueDate(args);
    const add = labels(args, "add_labels");
    const remove = labels(args, "remove_labels");
    const fields = {};
    if (summary) fields.summary = summary;
    if (description) fields.description = textToAdf(description);
    if (priority) fields.priority = { name: priority };
    if (due) fields.duedate = due;
    const update = (add.length || remove.length)
      ? { labels: [...add.map((label) => ({ add: label })), ...remove.map((label) => ({ remove: label }))] }
      : undefined;
    if (!Object.keys(fields).length && !update) throw fail("Nada para alterar: informe ao menos um campo.");
    const lines = [
      summary ? `Novo título: ${summary}` : null,
      description ? `Nova descrição: ${description.slice(0, 400)}` : null,
      priority ? `Prioridade: ${priority}` : null,
      due ? `Data limite: ${due}` : null,
      add.length ? `Adicionar rótulos: ${add.join(", ")}` : null,
      remove.length ? `Remover rótulos: ${remove.join(", ")}` : null
    ].filter(Boolean);
    return {
      title: `Alterar ${key}`,
      lines,
      run: async () => {
        await client.updateIssue(key, { fields: Object.keys(fields).length ? fields : undefined, update });
        return { key, url: `https://${client.host}/browse/${key}` };
      }
    };
  }

  if (name === "jira_add_comment") {
    const key = issueKey(args);
    const body = text(args, "body", { required: true, max: 20000, label: "comentário" });
    return {
      title: `Comentar em ${key}`,
      lines: [body.slice(0, 600)],
      run: async () => {
        const comment = await client.addComment(key, textToAdf(body));
        return { key, comment_id: comment?.id || "" };
      }
    };
  }

  if (name === "jira_transition_issue") {
    const key = issueKey(args);
    const status = text(args, "status", { required: true, max: 100, label: "status" });
    const match = await resolveTransition(client, key, status);
    return {
      title: `Transicionar ${key}`,
      lines: [`Novo status: ${match.to?.name || match.name}`],
      run: async () => {
        await client.transition(key, match.id);
        return { key, status: match.to?.name || match.name };
      }
    };
  }

  if (name === "jira_set_assignee") {
    const key = issueKey(args);
    const assignee = accountId(args);
    return {
      title: `Trocar responsável de ${key}`,
      lines: [assignee ? `Novo responsável (account_id): ${assignee}` : "Remover o responsável"],
      run: async () => {
        await client.setAssignee(key, assignee || null);
        return { key, assignee: assignee || null };
      }
    };
  }

  throw fail(`Ferramenta desconhecida: ${name}`);
}
