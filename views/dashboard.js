import { escapeHtml, formatAge, formatNumber, formatPercent } from "../models/format.js";
import { buildDashboard } from "../models/metrics.js";
import { DECLARED_SCOPES } from "../models/scopes.js";
import { bars, emptyState, pageHead, tag } from "./html.js";

function metric(label, value, note, kind = "") {
  return `<article class="metric ${kind}"><span>${label}</span><b>${value}</b><em>${note}</em></article>`;
}

export function renderDashboard(state) {
  const snapshot = state.snapshot;
  if (!snapshot) {
    return pageHead("Painel", "Métricas do que o seu token consegue ler no Bitbucket.") +
      emptyState("Nada consultado ainda", "Salve o token na configuração, escolha o workspace e atualize. A leitura usa os escopos Read da imagem que você gerou.", `<button type="button" class="primary" data-route="settings">Abrir configuração</button>`);
  }
  const stats = buildDashboard(snapshot);
  const staleNote = snapshot.workspace && snapshot.workspace !== state.config.workspace
    ? `<div class="banner warn"><p>O cache é do workspace ${escapeHtml(snapshot.workspace)}. O selecionado agora é ${escapeHtml(state.config.workspace || "vazio")}. Atualize para não misturar os números.</p></div>`
    : "";
  const errors = Object.entries(snapshot.sectionErrors || {}).filter(([, message]) => message);
  return `${pageHead("Painel", `Consulta de ${snapshot.fetchedAt ? formatAge(snapshot.fetchedAt) : "agora"} · estado dos PRs: ${snapshot.prState || "OPEN"}`)}
    ${staleNote}
    ${errors.map(([, message]) => `<div class="banner warn"><p>${escapeHtml(message)}</p></div>`).join("")}
    <section class="metrics">
      ${metric("Repositórios", formatNumber(stats.repos), stats.repoTruncated ? `de ${formatNumber(stats.repoTotal)} no workspace` : "carregados nesta amostra")}
      ${metric("Privados", formatNumber(stats.privateRepos), `${formatNumber(stats.projects)} projetos`)}
      ${metric("PRs abertos", formatNumber(stats.pullRequests), `${formatNumber(stats.drafts)} em rascunho`, stats.pullRequests ? "warn" : "ok")}
      ${metric("Sem aprovação", formatNumber(stats.unapproved), `${formatNumber(stats.stale)} com 7 dias ou mais`, stats.unapproved ? "danger" : "ok")}
      ${metric("Idade média", stats.avgAgeDays == null ? "—" : formatNumber(Math.round(stats.avgAgeDays)), "dias desde a abertura")}
      ${metric("Pipelines", stats.pipelineSuccessRate == null ? "—" : formatPercent(stats.pipelineSuccessRate), `${formatNumber(stats.pipelineFailed)} falhas na amostra`, stats.pipelineFailed ? "warn" : "")}
      ${metric("Runners online", formatNumber(stats.runnersOnline), `${formatNumber(stats.runners)} visíveis`, stats.runners && stats.runnersOnline === 0 ? "warn" : "ok")}
      ${metric("Com tarefas", formatNumber(stats.withTasks), "PRs com task aberta")}
    </section>
    <section class="grid-2">
      <article class="card"><h2>Donos dos pull requests</h2><p class="sub">Quem abriu o que está ${snapshot.prState === "OPEN" ? "aberto" : snapshot.prState}.</p>${bars(stats.authors)}</article>
      <article class="card"><h2>Linguagens</h2><p class="sub">Nos repositórios desta amostra.</p>${bars(stats.languages)}</article>
    </section>
    <section class="grid-3">
      <article class="card"><h2>PRs por repositório</h2>${bars(stats.reposWithPrs)}</article>
      <article class="card"><h2>Branch de destino</h2>${bars(stats.destBranches)}</article>
      <article class="card"><h2>Seu acesso aos repos</h2>${bars(stats.permissions)}</article>
    </section>
    <section class="grid-2">
      <article class="card">
        <h2>PRs mais antigos</h2>
        ${stats.oldest.length ? `<div class="table-wrap"><table><thead><tr><th>Título</th><th>Dono</th><th>Idade</th></tr></thead><tbody>
          ${stats.oldest.map((pr) => `<tr><td>${escapeHtml(pr.title)}</td><td>${escapeHtml(pr.author.display_name)}</td><td>${formatAge(pr.created_on)}</td></tr>`).join("")}
        </tbody></table></div>` : `<p class="muted">Nenhum pull request nesse estado.</p>`}
      </article>
      <article class="card">
        <h2>Escopos verificados agora</h2>
        <div class="scopes">${(snapshot.probes || []).map((probe) => `<div class="scope"><b>${escapeHtml(probe.label)}</b>${tag(probe.ok ? "respondeu" : "negado", probe.ok ? "ok" : "danger")}<span>${escapeHtml(probe.message || "")}</span></div>`).join("") || `<p class="muted">Atualize para testar os endpoints.</p>`}</div>
      </article>
    </section>
    <article class="card">
      <h2>Mapa do token</h2>
      <p class="sub">O mesmo conjunto da tela de scopes: leitura ligada, escrita de testes marcada e o restante desligado. O painel não usa nenhum escopo de escrita.</p>
      <div class="scopes">${DECLARED_SCOPES.map((scope) => `<div class="scope"><b>${scope.group} · ${scope.name}</b>${tag(scope.state === "on" ? "marcado" : scope.state === "implied" ? "implícito" : "desligado", scope.state === "off" ? "off" : "ok")}<span>${scope.note}</span></div>`).join("")}</div>
    </article>`;
}
