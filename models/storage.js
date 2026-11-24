import { DEFAULT_CONFIG } from "./config.js";

const CONFIG_KEY = "crizsopha.bitbucket.config";
const SNAPSHOT_KEY = "crizsopha.bitbucket.snapshot";
const WORKSPACES_KEY = "crizsopha.bitbucket.workspaces";

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
}

export function loadWorkspaces() {
  const list = readJson(WORKSPACES_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function saveWorkspaces(list) {
  localStorage.setItem(WORKSPACES_KEY, JSON.stringify(list || []));
}
