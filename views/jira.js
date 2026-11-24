import { escapeHtml, formatAge, formatDate, formatNumber } from "../models/format.js";
import { paginate, tally, uniqueOptions } from "../models/metrics.js";
import { buildJiraDashboard, filterJiraIssues, isOpenIssue, isOverdue } from "../models/jira-context.js";
import { bars, emptyState, externalLink, pageHead, tag } from "./html.js";

function metric(label, value, note, kind = "") {
  return `<article class="metric ${kind}"><span>${label}</span><b>${value}</b><em>${note}</em></article>`;
}

function options(list, current, allLabel) {
  return [`<option value="">${escapeHtml(allLabel)}</option>`]
    .concat(list.map((item) => `<option value="${escapeHtml(item)}" ${item === current ? "selected" : ""}>${escapeHtml(item)}</option>`))
    .join("");
}

function emptyJira(title) {
  return pageHead(title, "Dados lidos do Jira Cloud com o seu API token.") +
    emptyState("Sem dados do Jira em cache", "Configure o endereço do site, o e-mail e o API token e depois atualize.", `<button type="button" class="primary" data-action="sync-jira">Atualizar Jira</button> <button type="button" class="ghost" data-route="settings">Abrir configuração</button>`);
}

function notices(state) {
  const snapshot = state.jiraSnapshot;
  const banners = [];
  if (snapshot.truncated) {
    banners.push(`A amostra foi limitada a ${formatNumber(snapshot.maxIssues)} issues. Aumente o limite na configuração ou refine o JQL para não perder issues.`);
  }
  if (snapshot.site && snapshot.site !== state.jiraConfig.site) {
    banners.push(`O cache é do site ${snapshot.site}. A configuração atual aponta para ${state.jiraConfig.site || "vazio"}. Atualize para não misturar os dados.`);
  }
  for (const message of Object.values(snapshot.sectionErrors || {})) if (message) banners.push(message);
  return banners.map((text) => `<div class="banner warn"><p>${escapeHtml(text)}</p></div>`).join("");
}

export function renderJiraDashboard(state) {
  const snapshot = state.jiraSnapshot;
  if (!snapshot) return emptyJira("Painel Jira");
  const stats = buildJiraDashboard(snapshot);
  return `${pageHead("Painel Jira", `Consulta de ${snapshot.fetchedAt ? formatAge(snapshot.fetchedAt) : "agora"} · ${escapeHtml(snapshot.site || "")}`)}
    ${notices(state)}
    <section class="metrics">
      ${metric("Issues na amostra", formatNumber(stats.issues), `${formatNumber(stats.done)} concluídas`)}
      ${metric("Abertas", formatNumber(stats.open), `${formatNumber(stats.inProgress)} em andamento`, stats.open ? "warn" : "ok")}
      ${metric("Atrasadas", formatNumber(stats.overdue), "prazo vencido e não concluídas", stats.overdue ? "danger" : "ok")}
      ${metric("Sem responsável", formatNumber(stats.unassigned), "issues abertas", stats.unassigned ? "warn" : "ok")}
      ${metric("Paradas", formatNumber(stats.stale), "abertas sem atualização há 30 dias ou mais", stats.stale ? "warn" : "ok")}
      ${metric("Idade média", stats.avgAgeDays == null ? "—" : formatNumber(Math.round(stats.avgAgeDays)), "dias desde a criação (abertas)")}
      ${metric("Projetos", formatNumber(stats.projects), "visíveis para o seu usuário")}
    </section>
    <section class="grid-2">
      <article class="card"><h2>Por status</h2>${bars(stats.byStatus)}</article>
      <article class="card"><h2>Responsáveis</h2><p class="sub">Issues abertas por pessoa.</p>${bars(stats.byAssignee)}</article>
    </section>
    <section class="grid-3">
      <article class="card"><h2>Por tipo</h2>${bars(stats.byType)}</article>
      <article class="card"><h2>Por prioridade</h2>${bars(stats.byPriority)}</article>
      <article class="card"><h2>Por projeto</h2>${bars(stats.byProject)}</article>
    </section>
    <article class="card">
      <h2>Issues abertas mais antigas</h2>
      ${stats.oldestOpen.length ? `<div class="table-wrap"><table><thead><tr><th>Issue</th><th>Responsável</th><th>Status</th><th>Idade</th></tr></thead><tbody>
        ${stats.oldestOpen.map((issue) => `<tr><td>${externalLink(issue.url, issue.key)} ${escapeHtml(issue.summary)}</td><td>${escapeHtml(issue.assignee || "—")}</td><td>${escapeHtml(issue.status)}</td><td>${formatAge(issue.created)}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">Nenhuma issue aberta na amostra.</p>`}
      <p class="help">Consulta usada (JQL): <code>${escapeHtml(snapshot.jql || "")}</code></p>
    </article>`;
}

export function visibleJiraIssues(state) {
  const all = state.jiraSnapshot?.issues || [];
  return { all, ...paginate(filterJiraIssues(all, state.ui), state.ui.jiraPage, state.ui.jiraPageSize) };
}

function pager(view) {
  const sizes = [10, 20, 30].map((n) => `<option value="${n}" ${n === view.pageSize ? "selected" : ""}>${n} por página</option>`).join("");
  return `<div class="filters pager">
    <button type="button" class="ghost" data-action="jira-page" data-value="prev" ${view.page <= 1 ? "disabled" : ""}>Anterior</button>
    <span class="count">Página ${view.page} de ${view.pages}</span>
    <button type="button" class="ghost" data-action="jira-page" data-value="next" ${view.page >= view.pages ? "disabled" : ""}>Próxima</button>
    <select data-filter="jiraPageSize" data-live="jira-table" aria-label="Itens por página">${sizes}</select>
  </div>`;
}

function statusTag(issue) {
  const kind = issue.status_category === "done" ? "ok" : issue.status_category === "indeterminate" ? "info" : "";
  return tag(issue.status || "sem status", kind);
}

export function renderJiraTable(state) {
  const view = visibleJiraIssues(state);
  if (!view.rows.length) return `<p class="count">0 issues com esse filtro.</p>`;
  return `<p class="count">${view.total} de ${view.all.length} issues</p>
    ${pager(view)}
    <div class="table-wrap"><table>
      <thead><tr><th>Issue</th><th>Responsável</th><th>Projeto</th><th>Prazo</th><th>Atualização</th></tr></thead>
      <tbody>${view.rows.map((issue) => `<tr>
        <td>${externalLink(issue.url, issue.key)} <strong>${escapeHtml(issue.summary)}</strong>
          <div>${statusTag(issue)}${tag(issue.type || "sem tipo")}${issue.priority ? tag(issue.priority, "warn") : ""}${isOverdue(issue) ? tag("atrasada", "danger") : ""}${(issue.labels || []).map((label) => tag(label, "off")).join("")}</div></td>
        <td>${escapeHtml(issue.assignee || "—")}<div class="muted">relator: ${escapeHtml(issue.reporter || "—")}</div></td>
        <td>${escapeHtml(issue.project)}<div class="muted">${escapeHtml(issue.project_name)}</div></td>
        <td>${issue.due ? escapeHtml(issue.due) : "—"}</td>
        <td>${formatAge(issue.updated)}<div class="muted">criada ${formatDate(issue.created)}</div></td>
      </tr>`).join("")}</tbody>
    </table></div>
    ${pager(view)}`;
}

export function renderJiraIssues(state) {
  const snapshot = state.jiraSnapshot;
  if (!snapshot) return emptyJira("Issues");
  const all = snapshot.issues || [];
  const assignees = uniqueOptions(all, (issue) => issue.assignee);
  const ui = state.ui;
  return `${pageHead("Issues", "As issues devolvidas pela consulta configurada, com filtros locais.")}
    ${notices(state)}
    <div class="filters">
      <input data-filter="jiraQuery" data-live="jira-table" value="${escapeHtml(ui.jiraQuery)}" placeholder="Buscar chave, título, pessoa, etiqueta" aria-label="Buscar issues">
      <select data-filter="jiraScope" data-live="jira-table" aria-label="Estado">
        <option value="open" ${ui.jiraScope !== "all" ? "selected" : ""}>Só abertas</option>
        <option value="all" ${ui.jiraScope === "all" ? "selected" : ""}>Abertas e concluídas</option>
      </select>
      <select data-filter="jiraProject" data-live="jira-table" aria-label="Projeto">${options(uniqueOptions(all, (issue) => issue.project), ui.jiraProject, "Todos os projetos")}</select>
      <select data-filter="jiraStatus" data-live="jira-table" aria-label="Status">${options(uniqueOptions(all, (issue) => issue.status), ui.jiraStatus, "Todos os status")}</select>
      <select data-filter="jiraType" data-live="jira-table" aria-label="Tipo">${options(uniqueOptions(all, (issue) => issue.type), ui.jiraType, "Todos os tipos")}</select>
      <select data-filter="jiraAssignee" data-live="jira-table" aria-label="Responsável">
        <option value="">Todos os responsáveis</option>
        <option value="__none__" ${ui.jiraAssignee === "__none__" ? "selected" : ""}>Sem responsável</option>
        ${assignees.map((name) => `<option value="${escapeHtml(name)}" ${name === ui.jiraAssignee ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
      </select>
    </div>
    <div data-slot="jira-table">${renderJiraTable(state)}</div>`;
}

export function renderJiraProjects(state) {
  const snapshot = state.jiraSnapshot;
  if (!snapshot) return emptyJira("Projetos Jira");
  const issues = snapshot.issues || [];
  const total = new Map(tally(issues, (issue) => issue.project, 1000).map((item) => [item.label, item.count]));
  const open = new Map(tally(issues.filter(isOpenIssue), (issue) => issue.project, 1000).map((item) => [item.label, item.count]));
  const projects = snapshot.projects || [];
  return `${pageHead("Projetos Jira", "Projetos que o seu usuário consegue ver, com a contagem de issues desta amostra.")}
    ${notices(state)}
    ${projects.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Projeto</th><th>Tipo</th><th>Líder</th><th>Issues abertas</th><th>Issues na amostra</th></tr></thead>
      <tbody>${projects.map((project) => `<tr>
        <td><strong>${escapeHtml(project.name)}</strong><div class="muted">${escapeHtml(project.key)}</div>${project.is_private ? tag("privado") : ""}</td>
        <td>${escapeHtml(project.type || "—")}</td>
        <td>${escapeHtml(project.lead || "—")}</td>
        <td>${formatNumber(open.get(project.key) || 0)}</td>
        <td>${formatNumber(total.get(project.key) || 0)}</td>
      </tr>`).join("")}</tbody>
    </table></div>` : `<p class="muted">Nenhum projeto listado para este usuário.</p>`}`;
}
