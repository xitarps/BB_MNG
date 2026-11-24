import { DEFAULT_CONFIG } from "./config.js";
import { serializeBitbucketContext } from "./bitbucket-context.js";
import { DEFAULT_JIRA_CONFIG } from "./jira-config.js";
import { serializeJiraContext } from "./jira-context.js";

const CONFIG_KEY = "crizsopha.bitbucket.config";
const SNAPSHOT_KEY = "crizsopha.bitbucket.snapshot";
const WORKSPACES_KEY = "crizsopha.bitbucket.workspaces";
const CONTEXT_KEY = "crizsopha.bitbucket.context";
const JIRA_CONFIG_KEY = "crizsopha.jira.config";
const JIRA_SNAPSHOT_KEY = "crizsopha.jira.snapshot";
const JIRA_CONTEXT_KEY = "crizsopha.jira.context";
const EXCLUDED_KEY = "crizsopha.chat.contextExcluded";

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function loadConfig() {
  const saved = readJson(CONFIG_KEY, {});
  return { ...DEFAULT_CONFIG, ...saved, token: saved.token || "" };
}

export function saveConfig(config) {
  const { ...copy } = config;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(copy));
}

export function forgetToken() {
  const config = loadConfig();
  config.token = "";
  config.lastAuthMode = "";
  saveConfig(config);
  return config;
}

export function loadSnapshot() {
  const snapshot = readJson(SNAPSHOT_KEY, null);
  if (!snapshot || snapshot.version !== 1) return null;
  return snapshot;
}

export function saveSnapshot(snapshot, token) {
  saveBitbucketContext(snapshot, token);
  const raw = JSON.stringify(snapshot);
  if (token && raw.includes(token)) return false;
  try {
    localStorage.setItem(SNAPSHOT_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

export function clearSnapshot() {
  localStorage.removeItem(SNAPSHOT_KEY);
  localStorage.removeItem(CONTEXT_KEY);
}

export function saveBitbucketContext(snapshot, token) {
  const text = serializeBitbucketContext(snapshot);
  try {
    if (text && !(token && text.includes(token))) {
      localStorage.setItem(CONTEXT_KEY, text);
      return true;
    }
  } catch {
    // Falls through to drop a stale copy.
  }
  localStorage.removeItem(CONTEXT_KEY);
  return false;
}

export function loadBitbucketContext() {
  return localStorage.getItem(CONTEXT_KEY) || "";
}

export function loadContextExcluded() {
  const list = readJson(EXCLUDED_KEY, []);
  return Array.isArray(list) ? list.filter((item) => typeof item === "string") : [];
}

export function saveContextExcluded(list) {
  localStorage.setItem(EXCLUDED_KEY, JSON.stringify(list));
}

export function loadWorkspaces() {
  const list = readJson(WORKSPACES_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function saveWorkspaces(list) {
  localStorage.setItem(WORKSPACES_KEY, JSON.stringify(list || []));
}

export function loadJiraConfig() {
  const saved = readJson(JIRA_CONFIG_KEY, {});
  return { ...DEFAULT_JIRA_CONFIG, ...saved, token: saved.token || "" };
}

export function saveJiraConfig(config) {
  localStorage.setItem(JIRA_CONFIG_KEY, JSON.stringify(config));
}

export function forgetJiraToken() {
  const config = loadJiraConfig();
  config.token = "";
  saveJiraConfig(config);
  return config;
}

export function loadJiraSnapshot() {
  const snapshot = readJson(JIRA_SNAPSHOT_KEY, null);
  return snapshot?.version === 1 ? snapshot : null;
}

export function saveJiraSnapshot(snapshot, token) {
  saveJiraContext(snapshot, token);
  const raw = JSON.stringify(snapshot);
  if (token && raw.includes(token)) return false;
  try {
    localStorage.setItem(JIRA_SNAPSHOT_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

export function clearJiraSnapshot() {
  localStorage.removeItem(JIRA_SNAPSHOT_KEY);
  localStorage.removeItem(JIRA_CONTEXT_KEY);
}

export function saveJiraContext(snapshot, token) {
  const text = serializeJiraContext(snapshot);
  try {
    if (text && !(token && text.includes(token))) {
      localStorage.setItem(JIRA_CONTEXT_KEY, text);
      return true;
    }
  } catch {
    // Falls through to drop a stale copy.
  }
  localStorage.removeItem(JIRA_CONTEXT_KEY);
  return false;
}

export function loadJiraContext() {
  return localStorage.getItem(JIRA_CONTEXT_KEY) || "";
}
