import { escapeHtml, excerpt, formatBytes, formatDate } from "../models/format.js";
import { filterRepos, uniqueOptions } from "../models/metrics.js";
import { emptyState, externalLink, pageHead, tag } from "./html.js";

export function renderRepoTable(state) {
  const all = state.snapshot?.repos || [];
  const rows = filterRepos(all, state.ui);
  const permissions = new Map((state.snapshot?.permissions || []).map((item) => [item.full_name, item.permission]));
  if (!rows.length) return `<p class="count">Nenhum repositório com esse filtro.</p>`;
  return `<p class="count">${rows.length} de ${all.length} repositórios${state.snapshot.repoTruncated ? ` · amostra de ${state.snapshot.repoTotal}` : ""}</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Repositório</th><th>Projeto</th><th>Linguagem</th><th>Acesso</th><th>Atualizado</th></tr></thead>
      <tbody>${rows.map((repo) => `<tr>
        <td><strong>${escapeHtml(repo.name)}</strong><div class="muted">${escapeHtml(repo.full_name)}</div><div>${repo.is_private ? tag("privado") : tag("público", "info")}${repo.mainbranch ? tag(repo.mainbranch) : ""}</div><p class="muted">${escapeHtml(excerpt(repo.description, 140))}</p></td>
        <td>${escapeHtml(repo.project?.name || "—")}<div class="muted">${escapeHtml(repo.project?.key || "")}</div></td>
        <td>${escapeHtml(repo.language || "—")}<div class="muted">${formatBytes(repo.size)}</div></td>
        <td>${tag(permissions.get(repo.full_name) || "não listado", "info")}</td>
        <td>${formatDate(repo.updated_on)}<div>${externalLink(repo.html, "abrir")}</div><button type="button" class="text-btn" data-action="clone-one" data-repo="${escapeHtml(repo.full_name)}">clonar</button></td>
      </tr>`).join("")}</tbody>
    </table></div>`;
}

export function renderRepositories(state) {
  if (!state.snapshot) {
    return pageHead("Repositórios", "Projetos, linguagem, tamanho e o seu nível de acesso.") +
      emptyState("Sem repositórios em cache", "A leitura usa o escopo Repositories Read, implícito no seu token.", `<button type="button" class="primary" data-action="sync">Atualizar</button>`);
  }
  const repos = state.snapshot.repos || [];
  const languages = uniqueOptions(repos, (repo) => repo.language || "sem linguagem");
  const projects = uniqueOptions(repos, (repo) => repo.project?.key);
  const projectCards = (state.snapshot.projects || []).map((project) => `<div class="scope"><b>${escapeHtml(project.name)}</b><span>${escapeHtml(project.key)} · ${project.is_private ? "privado" : "público"}</span></div>`).join("");
  return `${pageHead("Repositórios", "O que o token consegue listar neste workspace.")}
    ${state.snapshot.projects?.length ? `<article class="card"><h2>Projetos</h2><div class="scopes">${projectCards}</div></article>` : ""}
    <div class="filters">
      <input data-filter="repoQuery" data-live="repo-table" value="${escapeHtml(state.ui.repoQuery)}" placeholder="Buscar nome ou descrição" aria-label="Buscar repositórios">
      <select data-filter="repoLanguage" data-live="repo-table" aria-label="Linguagem">${[`<option value="">Todas as linguagens</option>`].concat(languages.map((item) => `<option ${item === state.ui.repoLanguage ? "selected" : ""}>${escapeHtml(item)}</option>`)).join("")}</select>
      <select data-filter="repoProject" data-live="repo-table" aria-label="Projeto">${[`<option value="">Todos os projetos</option>`].concat(projects.map((item) => `<option value="${escapeHtml(item)}" ${item === state.ui.repoProject ? "selected" : ""}>${escapeHtml(item)}</option>`)).join("")}</select>
    </div>
    <div data-slot="repo-table">${renderRepoTable(state)}</div>`;
}
