import { escapeHtml, formatDate } from "../models/format.js";
import { tally } from "../models/metrics.js";
import { bars, emptyState, externalLink, pageHead, tag } from "./html.js";

function kind(result) {
  if (result === "SUCCESSFUL") return "ok";
  if (result === "FAILED" || result === "ERROR") return "danger";
  if (result === "IN_PROGRESS" || result === "PENDING" || result === "PAUSED") return "warn";
  return "";
}

export function renderPipelines(state) {
  const rows = state.snapshot?.pipelines || [];
  if (!state.snapshot) {
    return pageHead("Pipelines", "Amostra recente, não o histórico inteiro.") +
      emptyState("Sem pipelines em cache", "O token tem Pipelines Read. A amostra pega os repositórios atualizados mais recentemente.", `<button type="button" class="primary" data-action="sync">Atualizar</button>`);
  }
  return `${pageHead("Pipelines", `Até ${state.config.pipelineRepos} repositórios recentes, 5 execuções cada. Variáveis de pipeline não são lidas.`)}
    ${state.snapshot.sectionErrors?.pipelines ? `<div class="banner warn"><p>${escapeHtml(state.snapshot.sectionErrors.pipelines)}</p></div>` : ""}
    <section class="grid-2">
      <article class="card"><h2>Resultados da amostra</h2>${bars(tally(rows, (item) => item.result, 8))}</article>
      <article class="card"><h2>Por branch</h2>${bars(tally(rows, (item) => item.branch || "sem branch", 8))}</article>
    </section>
    ${rows.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Repositório</th><th>Resultado</th><th>Branch</th><th>Quem disparou</th><th>Quando</th></tr></thead>
      <tbody>${rows.map((item) => `<tr>
        <td>${escapeHtml(item.repo)}<div class="muted">#${escapeHtml(item.build)}</div></td>
        <td>${tag(item.result, kind(item.result))}</td>
        <td><code>${escapeHtml(item.branch || "—")}</code></td>
        <td>${escapeHtml(item.creator || "—")}</td>
        <td>${formatDate(item.created_on)}<div>${externalLink(item.html, "abrir")}</div></td>
      </tr>`).join("")}</tbody>
    </table></div>` : `<section class="empty"><h2>Nenhuma execução na amostra</h2><p>Os repositórios consultados não devolveram pipeline, ou o recurso ainda não está habilitado neles.</p></section>`}`;
}
