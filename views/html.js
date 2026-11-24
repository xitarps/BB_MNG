import { escapeHtml, safeUrl } from "../models/format.js";

export function externalLink(url, label) {
  const href = safeUrl(url);
  if (!href) return escapeHtml(label);
  return `<a class="ext" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

export function avatar(url, name) {
  const href = safeUrl(url);
  const initials = String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
  if (!href) return `<span class="initials" aria-hidden="true">${escapeHtml(initials || "?")}</span>`;
  return `<img class="avatar" alt="" src="${escapeHtml(href)}">`;
}

export function pageHead(title, text, extra = "") {
  return `<header class="page-head"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p></div>${extra}</header>`;
}

export function emptyState(title, text, action = "") {
  return `<section class="empty"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p>${action}</section>`;
}

export function banner(kind, text) {
  if (!text) return "";
  return `<div class="banner ${kind || ""}"><p>${escapeHtml(text)}</p></div>`;
}

export function bars(items) {
  if (!items?.length) return `<p class="muted">Sem dados ainda.</p>`;
  const max = Math.max(...items.map((item) => item.count), 1);
  return `<div class="bars">${items.map((item) => `
    <div class="bar-row">
      <span>${escapeHtml(item.label)}</span>
      <span class="bar"><i style="width:${Math.max(6, Math.round((item.count / max) * 100))}%"></i></span>
      <b>${item.count}</b>
    </div>`).join("")}</div>`;
}

export function tag(text, kind = "") {
  return `<span class="tag ${kind}">${escapeHtml(text)}</span>`;
}

// [id, label, group]; the shell prints a small heading whenever the group changes.
export const ROUTES = [
  ["dashboard", "Painel", "Bitbucket"],
  ["prs", "Pull requests", "Bitbucket"],
  ["repos", "Repositórios", "Bitbucket"],
  ["pipelines", "Pipelines", "Bitbucket"],
  ["runners", "Runners", "Bitbucket"],
  ["clone", "Clonar / atualizar", "Bitbucket"],
  ["jira", "Painel Jira", "Jira"],
  ["jira-issues", "Issues", "Jira"],
  ["jira-projects", "Projetos", "Jira"],
  ["settings", "Configuração", "Geral"]
];
