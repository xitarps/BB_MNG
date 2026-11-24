import { escapeHtml, excerpt, formatAge, formatDate } from "../models/format.js";
import { filterPullRequests, paginate, uniqueOptions } from "../models/metrics.js";
import { avatar, emptyState, externalLink, pageHead, tag } from "./html.js";

function options(list, current, allLabel) {
  return [`<option value="">${escapeHtml(allLabel)}</option>`]
    .concat(list.map((item) => `<option value="${escapeHtml(item)}" ${item === current ? "selected" : ""}>${escapeHtml(item)}</option>`))
    .join("");
}

export function isBlocked(pr) {
  return (pr.reviewers || []).some((r) => r.state === "changes_requested");
}

function reviewerLabel(r) {
  if (r.state === "changes_requested") return { kind: "bad", text: "pediu mudanças" };
  if (r.approved) return { kind: "ok", text: "aprovou" };
  return { kind: "", text: "pendente" };
}

function reviewers(pr) {
  if (!pr.reviewers?.length) {
    return pr.reviewersLoaded ? `<span class="muted">sem reviewer</span>` : `<span class="muted">buscando reviewers…</span>`;
  }
  return pr.reviewers.map((reviewer) => {
    const label = reviewerLabel(reviewer);
    return `<span class="person ${label.kind}">${escapeHtml(reviewer.name)} · ${label.text}</span>`;
  }).join("");
}

function commentText(comment) {
  return comment?.content?.raw || comment?.content?.html?.replace(/<[^>]+>/g, " ") || "";
}

function commentList(comments) {
  const visible = (comments || []).filter((comment) => !comment.deleted);
  const ids = new Set(visible.map((comment) => comment.id));
  return [...visible].sort((a, b) => new Date(a.created_on) - new Date(b.created_on)).map((comment) => ({
    comment,
    reply: Boolean(comment.parent?.id && ids.has(comment.parent.id))
  }));
}

export function visiblePullRequests(state) {
  const all = state.snapshot?.pullRequests || [];
  return { all, ...paginate(filterPullRequests(all, state.ui), state.ui.prPage, state.ui.prPageSize) };
}

function pager(view) {
  const sizes = [10, 20, 30].map((n) => `<option value="${n}" ${n === view.pageSize ? "selected" : ""}>${n} por página</option>`).join("");
  return `<div class="filters pager">
    <button type="button" class="ghost" data-action="pr-page" data-value="prev" ${view.page <= 1 ? "disabled" : ""}>Anterior</button>
    <span class="count">Página ${view.page} de ${view.pages}</span>
    <button type="button" class="ghost" data-action="pr-page" data-value="next" ${view.page >= view.pages ? "disabled" : ""}>Próxima</button>
    <select data-filter="prPageSize" data-live="pr-table" aria-label="Itens por página">${sizes}</select>
  </div>`;
}

export function renderPrTable(state) {
  const view = visiblePullRequests(state);
  const { rows, all } = view;
  if (!rows.length) return `<p class="count">0 pull requests com esse filtro.</p>`;
  return `<p class="count">${view.total} de ${all.length} pull requests</p>
    ${pager(view)}
    <div class="table-wrap"><table>
      <thead><tr><th>Pull request</th><th>Dono</th><th>Reviewers</th><th>Branches</th><th>Idade</th></tr></thead>
      <tbody>${rows.map((pr) => `<tr class="${state.ui.selectedPrKey === pr.key ? "selected" : ""}">
        <td>
          <button type="button" class="linkish" data-action="open-pr" data-key="${escapeHtml(pr.key)}">${escapeHtml(pr.title)}</button>
          <div class="muted">${escapeHtml(pr.repo)} · #${pr.id} · <button type="button" class="linkish" data-action="open-comments" data-key="${escapeHtml(pr.key)}">${pr.comment_count || 0} comentários</button></div>
          <div>${pr.draft ? tag("rascunho", "warn") : tag("pronto", "info")}${isBlocked(pr) ? tag("bloqueado: pediu mudanças", "danger") : ""}${pr.approved ? tag("com aprovação", "ok") : tag("sem aprovação", "danger")}${pr.task_count ? tag(`${pr.task_count} tarefas`, "warn") : ""}</div>
        </td>
        <td><div class="person-line">${avatar(pr.author.avatar, pr.author.display_name)}<div><strong>${escapeHtml(pr.author.display_name)}</strong><div class="muted">${escapeHtml(pr.author.nickname)}</div></div></div></td>
        <td>${reviewers(pr)}</td>
        <td><code>${escapeHtml(pr.source || "?")}</code> → <code>${escapeHtml(pr.destination || "?")}</code><div class="muted"><button type="button" class="linkish" data-action="open-comments" data-key="${escapeHtml(pr.key)}">ler comentários</button></div></td>
        <td>${formatAge(pr.created_on)}<div class="muted">atualizado ${formatAge(pr.updated_on)}</div>${externalLink(pr.html, "abrir")}</td>
      </tr>`).join("")}</tbody>
    </table></div>
    ${pager(view)}`;
}

function detail(state) {
  const key = state.ui.selectedPrKey;
  if (!key) return `<aside class="detail"><h2>Detalhe</h2><p class="muted">Selecione um pull request para ver dono, reviewers, arquivos e comentários.</p></aside>`;
  if (state.ui.prDetailLoading) return `<aside class="detail"><h2>Detalhe</h2><p>Carregando comentários e arquivos…</p></aside>`;
  const data = state.ui.prDetail;
  if (!data || data.key !== key) return `<aside class="detail"><h2>Detalhe</h2><p class="muted">Sem detalhe carregado.</p></aside>`;
  if (data.error) return `<aside class="detail"><h2>Detalhe</h2><p>${escapeHtml(data.error)}</p></aside>`;
  const pr = data.pr;
  const added = (data.files || []).reduce((sum, file) => sum + (file.lines_added || 0), 0);
  const removed = (data.files || []).reduce((sum, file) => sum + (file.lines_removed || 0), 0);
  return `<aside class="detail">
    <h2>${escapeHtml(pr.title)}</h2>
    <p class="muted">${escapeHtml(pr.repo)} · aberto ${formatDate(pr.created_on)} por ${escapeHtml(pr.author.display_name)}</p>
    <p>${externalLink(pr.html, "abrir no Bitbucket")}</p>
    ${pr.summary ? `<p>${escapeHtml(excerpt(pr.summary, 500))}</p>` : ""}
    <h3>Reviewers</h3>
    <div>${reviewers(pr)}</div>
    <h3>Arquivos</h3>
    <p class="muted">${data.files.length} arquivos · +${added} / -${removed}</p>
    <div class="bars">${data.files.slice(0, 12).map((file) => `<div class="repo-item"><span>${escapeHtml(file.new?.path || file.old?.path || "arquivo")}</span><span class="muted">+${file.lines_added || 0} -${file.lines_removed || 0}</span></div>`).join("") || `<p class="muted">Diffstat vazio.</p>`}</div>
    <h3>Comentários</h3>
    <p><button type="button" class="ghost" data-action="open-comments" data-key="${escapeHtml(key)}">Ler comentários</button></p>
    ${commentPreview(data.comments)}
  </aside>`;
}

function commentPreview(comments) {
  const items = commentList(comments).slice(0, 3);
  if (!items.length) return `<p class="muted">Sem comentários nesta consulta.</p>`;
  return items.map(({ comment }) => `<article class="repo-item"><div><strong>${escapeHtml(comment.user?.display_name || "alguém")}</strong><div class="muted">${formatDate(comment.created_on)}</div><p>${escapeHtml(excerpt(commentText(comment), 180))}</p></div></article>`).join("");
}

export function renderCommentModal(state) {
  if (!state.ui.commentsOpen) return "";
  const data = state.ui.prDetail;
  const loading = state.ui.prDetailLoading || !data || data.key !== state.ui.selectedPrKey;
  const title = data?.pr?.title || "Comentários";
  const items = loading || data?.error ? [] : commentList(data.comments);
  const body = loading
    ? `<p>Carregando comentários…</p>`
    : data?.error
      ? `<p>${escapeHtml(data.error)}</p>`
      : items.length
        ? items.map(({ comment, reply }) => {
          const inline = comment.inline;
          const where = inline?.path ? `${inline.path}${inline.to ? `:${inline.to}` : ""}` : "comentário geral";
          return `<article class="comment ${reply ? "reply" : ""}">
            <div class="person-line"><strong>${escapeHtml(comment.user?.display_name || "alguém")}</strong><span class="muted">${formatDate(comment.created_on)}</span>${comment.pending ? tag("pendente", "warn") : ""}</div>
            <div class="muted">${escapeHtml(where)}</div>
            <p>${escapeHtml(commentText(comment) || "(sem texto)")}</p>
          </article>`;
        }).join("")
        : `<p class="muted">Este pull request não tem comentários.</p>`;
  const truncated = data?.commentsTruncated ? `<p class="muted">Mostrando os primeiros 200 comentários.</p>` : "";
  return `<div class="modal-back" data-action="close-comments" role="presentation">
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="comment-title" data-modal="comments">
      <div class="modal-head">
        <h2 id="comment-title">${escapeHtml(title)}</h2>
        <button type="button" class="ghost" data-action="close-comments">Fechar</button>
      </div>
      ${truncated}
      ${body}
    </section>
  </div>`;
}

export function renderPullRequests(state) {
  if (!state.snapshot) {
    return pageHead("Pull requests", "Autores, reviewers e o que ainda está aberto.") +
      emptyState("Sem pull requests em cache", "Atualize o painel depois de configurar o token.", `<button type="button" class="primary" data-action="sync">Atualizar</button>`);
  }
  const all = state.snapshot.pullRequests || [];
  const authors = uniqueOptions(all, (pr) => pr.author?.display_name);
  const repos = uniqueOptions(all, (pr) => pr.repo);
  return `${pageHead("Pull requests", "Dono, reviewers, aprovação e idade. A lista respeita o estado escolhido na configuração.")}
    <div class="filters">
      <input data-filter="prQuery" data-live="pr-table" value="${escapeHtml(state.ui.prQuery)}" placeholder="Buscar título, dono, repo, branch" aria-label="Buscar pull requests">
      <select data-filter="prAuthor" data-live="pr-table" aria-label="Filtrar por dono">${options(authors, state.ui.prAuthor, "Todos os donos")}</select>
      <select data-filter="prRepo" data-live="pr-table" aria-label="Filtrar por repositório">${options(repos, state.ui.prRepo, "Todos os repositórios")}</select>
      <select data-filter="prDraft" data-live="pr-table" aria-label="Rascunho">
      <option value="all" ${state.ui.prDraft === "all" ? "selected" : ""}>Rascunho e pronto</option>
      <option value="ready" ${state.ui.prDraft === "ready" ? "selected" : ""}>Só prontos</option>
      <option value="draft" ${state.ui.prDraft === "draft" ? "selected" : ""}>Só rascunhos</option>
      </select>
      <select data-filter="prReview" data-live="pr-table" aria-label="Aprovação">
        <option value="all" ${state.ui.prReview === "all" ? "selected" : ""}>Com ou sem aprovação</option>
        <option value="pending" ${state.ui.prReview === "pending" ? "selected" : ""}>Sem aprovação</option>
        <option value="approved" ${state.ui.prReview === "approved" ? "selected" : ""}>Com aprovação</option>
        <option value="blocked" ${state.ui.prReview === "blocked" ? "selected" : ""}>Bloqueados (pediram mudanças)</option>
      </select>
    </div>
    <div class="split">
      <div data-slot="pr-table">${renderPrTable(state)}</div>
      <div data-slot="pr-detail">${detail(state)}</div>
    </div>
    ${renderCommentModal(state)}`;
}
