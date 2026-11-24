import { cleanToken } from "./config.js";

export const DEFAULT_JIRA_CONFIG = {
  site: "",
  email: "",
  token: "",
  projects: "",
  scope: "open",
  maxIssues: 300,
  jql: ""
};

export const JIRA_SCOPES = {
  open: "Issues não concluídas",
  recent: "Atualizadas nos últimos 90 dias (inclui concluídas)"
};

const HOST = /^[a-z0-9][a-z0-9-]*\.atlassian\.net$/;
const PROJECT_KEY = /^[A-Za-z][A-Za-z0-9_]*$/;

// Accepts "empresa", "empresa.atlassian.net" or a full Jira URL.
export function normalizeJiraSite(value) {
  let text = String(value || "").trim().toLowerCase();
  text = text.replace(/^https?:\/\//, "").split(/[/?#]/)[0];
  if (text && !text.includes(".")) text = `${text}.atlassian.net`;
  return text;
}

export function parseProjectKeys(value) {
  return String(value || "").split(/[\s,;]+/).map((key) => key.trim().toUpperCase()).filter(Boolean);
}

export function validateJiraConfig(config) {
  if (!HOST.test(normalizeJiraSite(config.site))) {
    return "Informe o endereço do Jira Cloud, por exemplo empresa.atlassian.net.";
  }
  if (!String(config.email || "").includes("@")) return "Informe o e-mail da conta Atlassian.";
  if (!cleanToken(config.token)) return "Cole o API token da Atlassian.";
  const invalid = parseProjectKeys(config.projects).find((key) => !PROJECT_KEY.test(key));
  if (invalid) return `Chave de projeto inválida: ${invalid}. Use letras, números e _ separados por vírgula.`;
  return "";
}

export function buildJql(config) {
  const custom = String(config.jql || "").trim();
  if (custom) return custom;
  const keys = parseProjectKeys(config.projects);
  const parts = [];
  if (keys.length) parts.push(`project in (${keys.join(", ")})`);
  parts.push(config.scope === "recent" ? "updated >= -90d" : "statusCategory != Done");
  return `${parts.join(" AND ")} ORDER BY updated DESC`;
}

export function jiraAuthHeader(config) {
  const bytes = new TextEncoder().encode(`${String(config.email).trim()}:${cleanToken(config.token)}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}
