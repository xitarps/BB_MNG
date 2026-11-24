import { cleanToken } from "../models/config.js";
import { JiraClient, slimJiraIssue, slimJiraProject, slimJiraUser } from "../models/jira.js";
import { buildJql, normalizeJiraSite } from "../models/jira-config.js";
import { saveJiraSnapshot } from "../models/storage.js";

export async function testJiraConnection(state, signal) {
  const user = slimJiraUser(await new JiraClient(state.jiraConfig, signal).myself());
  state.jiraUser = user;
  return user;
}

export async function syncJira(state, signal, onStatus) {
  const config = state.jiraConfig;
  const host = normalizeJiraSite(config.site);
  const client = new JiraClient(config, signal);
  const sectionErrors = {};

  onStatus?.("Identificando a conta no Jira…");
  const user = slimJiraUser(await client.myself());

  onStatus?.("Lendo projetos…");
  let projects = [];
  try {
    projects = (await client.projects()).values.map(slimJiraProject);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    sectionErrors.projects = error.userMessage || "Não foi possível listar os projetos.";
  }

  const jql = buildJql(config);
  onStatus?.("Buscando issues…");
  const found = await client.searchIssues(jql, { maxIssues: config.maxIssues });
  const issues = found.values.map((issue) => slimJiraIssue(issue, host));

  const snapshot = {
    version: 1,
    fetchedAt: new Date().toISOString(),
    site: host,
    jql,
    user,
    projects,
    issues,
    truncated: found.truncated,
    maxIssues: config.maxIssues,
    sectionErrors
  };
  const saved = saveJiraSnapshot(snapshot, cleanToken(config.token));
  state.jiraSnapshot = snapshot;
  state.jiraUser = user;
  onStatus?.(saved ? `Jira atualizado agora · ${issues.length} issues.` : "Jira atualizado, mas o cache local não coube no navegador.");
  return snapshot;
}
