import { LIN_DEST, WIN_DEST, effectiveShell } from "../models/config.js";
import { escapeHtml } from "../models/format.js";
import { buildClonePlan } from "../models/clone-script.js";
import { filterRepos } from "../models/metrics.js";
import { emptyState, pageHead } from "./html.js";

function selectedRepos(state) {
  const known = new Map((state.snapshot?.repos || []).map((repo) => [repo.full_name, repo]));
  for (const repo of state.ui.manualRepos || []) known.set(repo.full_name, repo);
  return state.ui.selectedRepos.map((name) => known.get(name)).filter(Boolean);
}

export function renderCloneList(state) {
  const repos = filterRepos(state.snapshot?.repos || [], state.ui);
  if (!repos.length) return `<p class="muted">Nenhum repositório carregado com esse filtro. Dá para adicionar um slug manualmente.</p>`;
  return repos.map((repo) => {
    const checked = state.ui.selectedRepos.includes(repo.full_name) ? "checked" : "";
    return `<label class="repo-item"><span><input type="checkbox" data-repo-check="${escapeHtml(repo.full_name)}" ${checked}> <strong>${escapeHtml(repo.name)}</strong> <span class="muted">${escapeHtml(repo.full_name)}</span></span><span class="muted">${escapeHtml(repo.language || "")}</span></label>`;
  }).join("");
}

function switchButton(action, value, current, label) {
  const pressed = value === current ? "true" : "false";
  return `<button type="button" data-action="${action}" data-value="${value}" aria-pressed="${pressed}">${escapeHtml(label)}</button>`;
}

export function renderClone(state) {
  const plan = buildClonePlan(selectedRepos(state), state.config);
  const shell = effectiveShell(state.config);
  const shown = state.ui.cloneReveal ? plan.script : plan.maskedScript;
  const example = state.ui.cloneReveal ? plan.example : plan.maskedExample;
  return `${pageHead("Clonar", "Gera o comando para Windows ou Linux. O padrão não grava o token na URL.")}
    <section class="card">
      <div class="row">
        <div class="switch" role="group" aria-label="Sistema">
          ${switchButton("set-os", "windows", state.config.os, "Windows")}
          ${switchButton("set-os", "linux", state.config.os, "Linux")}
        </div>
        ${state.config.os === "windows" ? `<div class="switch" role="group" aria-label="Shell">${switchButton("set-shell", "powershell", shell, "PowerShell")}${switchButton("set-shell", "cmd", shell, "Prompt de comando")}</div>` : `<span class="tag">bash</span>`}
        <div class="switch" role="group" aria-label="Protocolo">
          ${switchButton("set-protocol", "https", state.config.protocol, "HTTPS")}
          ${switchButton("set-protocol", "ssh", state.config.protocol, "SSH")}
        </div>
      </div>
      <div class="form" style="margin-top:12px">
        <label class="field wide"><span>Pasta de destino ${state.config.os === "windows" ? `(padrão ${WIN_DEST})` : `(padrão ${LIN_DEST})`}</span>
          <input data-action="clone-dest" value="${escapeHtml(state.config.cloneDest)}" spellcheck="false"></label>
        <label class="check"><input type="checkbox" data-action="include-token" ${state.config.includeTokenInUrl ? "checked" : ""}> Incluir o token na URL</label>
        <label class="check"><input type="checkbox" data-action="reveal-token" ${state.ui.cloneReveal ? "checked" : ""}> Mostrar segredo na tela</label>
      </div>
      ${plan.warnings.map((warning) => `<p class="help">${escapeHtml(warning)}</p>`).join("")}
    </section>
    <section class="split">
      <article class="card">
        <div class="row">
          <h2>Repositórios</h2>
          <button type="button" class="ghost" data-action="select-visible">Marcar visíveis</button>
          <button type="button" class="ghost" data-action="clear-selection">Limpar</button>
        </div>
        <div class="filters">
          <input data-filter="repoQuery" data-live="clone-list" value="${escapeHtml(state.ui.repoQuery)}" placeholder="Filtrar repositórios" aria-label="Filtrar repositórios para clonar">
          <input data-action="manual-slug" value="${escapeHtml(state.ui.manualSlug || "")}" placeholder="slug avulso" aria-label="Slug avulso">
          <button type="button" class="ghost" data-action="add-manual">Adicionar slug</button>
        </div>
        <div data-slot="clone-list">${state.snapshot ? renderCloneList(state) : ""}</div>
        ${(state.ui.manualRepos || []).map((repo) => `<label class="repo-item"><span><input type="checkbox" data-repo-check="${escapeHtml(repo.full_name)}" ${state.ui.selectedRepos.includes(repo.full_name) ? "checked" : ""}> <strong>${escapeHtml(repo.slug)}</strong> <span class="muted">adicionado à mão</span></span></label>`).join("")}
        ${state.snapshot ? "" : emptyState("Cache vazio", "Atualize o painel para listar os repositórios, ou adicione um slug.")}
      </article>
      <article class="card">
        <h2>Script ${plan.count ? `· ${plan.count}` : ""}</h2>
        <p class="help">${shell === "powershell" ? "PowerShell: cole no terminal, ou salve e rode com ExecutionPolicy Bypass." : shell === "cmd" ? "Prompt de comando. O arquivo .bat dobra % para o token não ser engolido." : "Bash. Dê permissão de execução se for baixar o .sh."}</p>
        ${example ? `<p class="help">Um repositório:</p><pre class="script">${escapeHtml(example)}</pre>` : ""}
        <textarea class="script" readonly aria-label="Script de clone">${shown}</textarea>
        <div class="btn-row">
          <button type="button" class="primary" data-action="copy-script" ${plan.script ? "" : "disabled"}>Copiar script</button>
          <button type="button" class="ghost" data-action="download-script" ${plan.script ? "" : "disabled"}>Baixar ${escapeHtml(plan.filename)}</button>
        </div>
        ${shell === "powershell" ? `<p class="help">Se o download for bloqueado: powershell -ExecutionPolicy Bypass -File .\\${plan.filename}</p>` : ""}
        ${shell === "bash" ? `<p class="help">chmod +x ${plan.filename} && ./${plan.filename}</p>` : ""}
      </article>
    </section>`;
}

export function cloneSelection(state) {
  return selectedRepos(state);
}
