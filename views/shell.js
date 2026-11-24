import { escapeHtml } from "../models/format.js";
import { ROUTES } from "./html.js";
import { renderChat } from "./chat.js";

function hostWarning() {
  const host = location.hostname;
  if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1") return "";
  return `<div class="banner warn"><p>Este painel não está em localhost. O token fica no localStorage e qualquer script desta origem consegue lê-lo.</p></div>`;
}

export function renderShell(state, content) {
  const snapshot = state.snapshot;
  const count = snapshot?.pullRequests?.length;
  const nav = ROUTES.map(([id, label]) => {
    const badge = id === "prs" && count ? `<small>${count}</small>` : "";
    return `<button type="button" data-route="${id}" class="${state.route === id ? "active" : ""}" ${state.route === id ? 'aria-current="page"' : ""}>${escapeHtml(label)}${badge}</button>`;
  }).join("");
  const workspaces = state.workspaces || [];
  const workspaceControl = workspaces.length
    ? `<select class="workspace-select" data-action="set-workspace" aria-label="Workspace">${workspaces.map((item) => `<option value="${escapeHtml(item.slug)}" ${item.slug === state.config.workspace ? "selected" : ""}>${escapeHtml(item.name)} (${escapeHtml(item.slug)})</option>`).join("")}</select>`
    : `<input class="workspace-select" name="workspace" autocomplete="off" data-action="type-workspace" value="${escapeHtml(state.config.workspace)}" placeholder="workspace" aria-label="Workspace">`;
  return `<div class="app">
    <aside class="sidebar">
      <div class="brand"><div class="mark">Cz</div><div><strong>crizsopha</strong><span>bitbucket desk</span></div></div>
      <nav class="nav">${nav}</nav>
      <p class="side-note">O token fica neste navegador. Scripts com credenciais exigem cuidado ao copiar ou baixar.</p>
    </aside>
    <div class="main">
      <header class="topbar">
        <div>
          <strong>${escapeHtml(state.config.workspace || "sem workspace")} · ${state.config.authMode === "bearer" ? "Bearer" : "Basic"}</strong>
          <p id="sync-status">${escapeHtml(state.statusText || "Dados locais prontos para consulta.")}</p>
        </div>
        <div class="top-actions">
          ${workspaceControl}
          <button type="button" class="ghost" data-action="cancel" ${state.syncing ? "" : "hidden"}>Cancelar</button>
          <button type="button" class="primary" data-action="sync" ${state.syncing ? "disabled" : ""}>${state.syncing ? "Consultando…" : "Atualizar"}</button>
        </div>
      </header>
      <div class="content">
        ${hostWarning()}
        ${state.error ? `<div class="banner danger"><p>${escapeHtml(state.error)}</p></div>` : ""}
        ${state.notice ? `<div class="banner"><p>${escapeHtml(state.notice)}</p></div>` : ""}
        ${content}
      </div>
    </div>
  </div>${renderChat(state)}`;
}
