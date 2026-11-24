import { escapeHtml, formatDate } from "../models/format.js";
import { emptyState, pageHead, tag } from "./html.js";

export function renderRunners(state) {
  const rows = state.snapshot?.runners || [];
  if (!state.snapshot) {
    return pageHead("Runners", "Estado dos runners que o token pode ler.") +
      emptyState("Sem consulta ainda", "Runners Read está marcado. Se o workspace não tiver runner, a lista volta vazia.", `<button type="button" class="primary" data-action="sync">Atualizar</button>`);
  }
  const online = rows.filter((runner) => /online/i.test(runner.status)).length;
  return `${pageHead("Runners", `${online} online de ${rows.length}. Este token não cadastra nem altera runner.`)}
    ${state.snapshot.sectionErrors?.runners ? `<div class="banner warn"><p>${escapeHtml(state.snapshot.sectionErrors.runners)}</p></div>` : ""}
    ${rows.length ? `<div class="scopes">${rows.map((runner) => `<article class="scope"><b>${escapeHtml(runner.name)}</b>${tag(runner.status, /online/i.test(runner.status) ? "ok" : "warn")}<span>${escapeHtml(runner.labels.join(", ") || "sem label")}</span><span>visto ${formatDate(runner.updated_on || runner.created_on)}</span></article>`).join("")}</div>` : `<section class="empty"><h2>Nenhum runner visível</h2><p>O workspace pode não ter runner, ou o token não alcança a configuração de pipelines dele.</p></section>`}`;
}
