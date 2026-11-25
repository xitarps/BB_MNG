import { escapeHtml } from "../models/format.js";
import { PROVIDERS, PROVIDER_IDS, activeAi } from "../models/ai.js";
import { buildContextTree, leavesOf, selectedContextText } from "../models/context-tree.js";
import { MAX_IMAGES_PER_MESSAGE, formatSize } from "../models/chat-images.js";

const GROUPED = { grouped: true };

function nodeState(node, excluded) {
  const leaves = leavesOf(node);
  const on = leaves.filter((path) => !excluded.has(path)).length;
  return { checked: on === leaves.length, indeterminate: on > 0 && on < leaves.length };
}

function renderNodes(nodes, chat) {
  return `<ul class="ctx-list">${nodes.map((node) => {
    const path = escapeHtml(node.path);
    const key = escapeHtml(node.key);
    const { checked, indeterminate } = nodeState(node, chat.contextExcluded);
    const box = `<input id="ctx-${path}" type="checkbox" data-action="ctx-toggle" data-path="${path}" ${checked ? "checked" : ""} ${indeterminate ? "data-indeterminate" : ""} ${chat.sending ? "disabled" : ""}>`;
    if (!node.children) {
      return `<li><div class="ctx-row"><span class="ctx-twisty-space"></span><label class="ctx-label">${box}<span>${key}</span></label><small class="ctx-meta">${escapeHtml(node.sample)}</small></div></li>`;
    }
    const open = chat.treeOpen.has(node.path);
    const meta = node.count != null ? `${node.count.toLocaleString("pt-BR")} ${node.count === 1 ? "item" : "itens"}` : "";
    return `<li><div class="ctx-row"><button type="button" class="ctx-twisty" id="ctx-open-${path}" data-action="ctx-expand" data-path="${path}" aria-expanded="${open}" aria-label="${open ? "Recolher" : "Expandir"} ${key}">${open ? "▾" : "▸"}</button><label class="ctx-label">${box}<span>${key}</span></label><small class="ctx-meta">${meta}</small></div>${open ? renderNodes(node.children, chat) : ""}</li>`;
  }).join("")}</ul>`;
}

function contextWindow(chat, ai) {
  if (!chat.contextData) {
    return `<div class="chat-context"><strong>Contexto</strong>
      <p class="chat-context-note">Não há dados salvos do Bitbucket nem do Jira. Use Atualizar no topo (em cada seção) para carregá-los.</p>
      <div class="chat-actions"><button type="button" class="ghost" data-action="reload-chat-context">Recarregar dados</button></div></div>`;
  }
  const text = selectedContextText(chat.contextData, chat.contextExcluded, GROUPED);
  const size = text.length;
  const off = chat.sending ? "disabled" : "";
  const open = !chat.contextCollapsed;
  const summary = size ? `${size.toLocaleString("pt-BR")} caracteres (≈ ${Math.ceil(size / 3).toLocaleString("pt-BR")} tokens)` : "nada marcado";
  const head = `<div class="ctx-head"><button type="button" class="ctx-collapse" id="ctx-collapse" data-action="toggle-context-panel" aria-expanded="${open}" aria-label="${open ? "Recolher" : "Expandir"} contexto">${open ? "▲" : "▼"}</button><strong>Contexto</strong><small class="ctx-meta">${summary}</small></div>`;
  if (!open) return `<div class="chat-context collapsed">${head}</div>`;
  return `<div class="chat-context">
    ${head}
    <p class="chat-context-note">Será enviado ao provedor de IA em uso (${escapeHtml(ai.label)}) com a sua pergunta.</p>
    <div class="chat-actions ctx-toolbar">
      <button type="button" class="ghost" data-action="ctx-all" ${off}>Marcar tudo</button>
      <button type="button" class="ghost" data-action="ctx-none" ${off}>Desmarcar tudo</button>
      <button type="button" class="ghost" data-action="reload-chat-context" ${off}>Recarregar</button>
      <button type="button" class="ghost" data-action="toggle-context-preview" aria-expanded="${chat.contextPreview}">${chat.contextPreview ? "Ocultar JSON" : "Ver JSON"}</button>
    </div>
    <div class="chat-context-tree" role="group" aria-label="Campos do contexto">${renderNodes(buildContextTree(chat.contextData, GROUPED), chat)}</div>
    ${chat.contextPreview ? `<textarea class="ctx-preview" readonly spellcheck="false" aria-label="JSON que será enviado">${escapeHtml(text)}</textarea>` : ""}
  </div>`;
}

function confirmCard(pending) {
  return `<section class="chat-confirm" role="alertdialog" aria-labelledby="chat-confirm-title" aria-describedby="chat-confirm-lines">
    <strong id="chat-confirm-title">Confirmar ação no Jira?</strong>
    <p>${escapeHtml(pending.title)}</p>
    <ul id="chat-confirm-lines">${pending.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>
    <div class="chat-actions"><button type="button" class="ghost" data-action="confirm-chat-action" data-approved="false">Cancelar</button>
      <button type="button" class="primary" data-action="confirm-chat-action" data-approved="true">Confirmar</button></div>
  </section>`;
}

export function renderChat(state) {
  const chat = state.chat;
  if (!chat.open) {
    return `<button type="button" class="chat-launcher" data-action="open-chat" aria-label="Abrir chat com a IA" aria-expanded="false">✦ <span>Chat IA</span></button>`;
  }
  const ai = activeAi(state.ai);
  const messages = chat.messages.map((message) => `<div class="chat-message ${message.role === "user" ? "chat-user" : "chat-assistant"}"><strong>${message.role === "user" ? "Você" : escapeHtml(message.provider || "IA")}</strong><p>${escapeHtml(message.content)}</p>${message.images?.length ? `<small class="chat-attach">Imagens: ${message.images.map((image) => escapeHtml(image.name)).join(", ")}</small>` : ""}${message.context ? `<small class="chat-attach">Contexto anexado · ${message.context.length.toLocaleString("pt-BR")} caracteres</small>` : ""}</div>`).join("");
  const expandedContext = chat.useContext && !chat.contextCollapsed;
  const maxIcon = chat.maximized
    ? `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M5.5 5.5h8v8h-8zM2.5 10.5v-8h8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`
    : `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2.5 2.5h11v11h-11z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  return `<section class="chat-panel${expandedContext ? " has-context" : ""}${chat.maximized ? " is-max" : ""}" aria-label="Chat com IA">
    <header class="chat-head"><div><strong>Chat IA</strong>
      <select class="chat-provider" data-action="chat-provider" aria-label="Provedor de IA em uso" ${chat.sending ? "disabled" : ""}>${PROVIDER_IDS.map((id) => `<option value="${id}" ${id === ai.id ? "selected" : ""}>${escapeHtml(PROVIDERS[id].label)}</option>`).join("")}</select>
      <span>dados do Bitbucket e do Jira só se você anexar</span></div>
      <div class="chat-head-actions">
        <button type="button" class="chat-close" id="chat-maximize" data-action="toggle-chat-maximize" aria-pressed="${Boolean(chat.maximized)}" aria-label="${chat.maximized ? "Restaurar tamanho do chat" : "Maximizar chat"}">${maxIcon}</button>
        <button type="button" class="chat-close" data-action="close-chat" aria-label="Minimizar chat">−</button>
      </div></header>
    <p class="chat-privacy">As mensagens são enviadas ao provedor em uso (${escapeHtml(ai.label)}) e podem gerar cobrança. Não inclua credenciais.${state.ai.instructions?.trim() ? ` <button type="button" class="linkish" data-route="settings">Instruções padrão ativas</button>.` : ""}</p>
    <div class="chat-messages" role="log" aria-live="polite">
      ${messages || `<p class="chat-empty">Olá! Posso ajudar com perguntas gerais. Para perguntar sobre o Bitbucket ou o Jira, ative "Anexar contexto" abaixo.</p>`}
      ${chat.sending && !chat.pending ? `<p class="chat-empty">${escapeHtml(ai.label)} está respondendo…</p>` : ""}
      ${chat.sending && chat.activity.length ? `<ul class="chat-activity" aria-label="Atividade do assistente">${chat.activity.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : ""}
    </div>
    ${chat.pending ? confirmCard(chat.pending) : ""}
    ${chat.error ? `<p class="chat-error" role="alert">${escapeHtml(chat.error)}</p>` : ""}
    ${chat.truncated ? `<p class="chat-error">A resposta atingiu o limite de tamanho. Peça para continuar.</p>` : ""}
    ${!ai.apiKey ? `<p class="chat-setup">Configure a chave do ${escapeHtml(ai.label)} em <button type="button" class="linkish" data-route="settings">Configuração</button>.</p>` : ""}
    ${chat.useContext ? contextWindow(chat, ai) : ""}
    <form class="chat-compose" data-action="send-chat">
      <label class="chat-switch"><input id="chat-context-toggle" type="checkbox" role="switch" data-action="chat-context-toggle" ${chat.useContext ? "checked" : ""} ${chat.sending ? "disabled" : ""}><span class="chat-switch-track" aria-hidden="true"></span><span>Anexar contexto (Bitbucket / Jira)</span></label>
      <label class="chat-label" for="chat-draft">Mensagem</label>
      <textarea id="chat-draft" data-action="chat-draft" placeholder="Escreva sua mensagem" rows="2" ${chat.attachments.length ? "" : "required"} ${chat.sending ? "disabled" : ""}>${escapeHtml(chat.draft)}</textarea>
      ${chat.attachments.length ? `<ul class="chat-attachments" aria-label="Imagens anexadas">${chat.attachments.map((image, index) => `<li class="chat-chip" title="${escapeHtml(image.name)} · ${formatSize(image.size)}"><span class="chat-chip-name">${escapeHtml(image.name)}</span><small>${formatSize(image.size)}</small><button type="button" class="chat-chip-remove" data-action="remove-chat-image" data-index="${index}" aria-label="Remover ${escapeHtml(image.name)}" ${chat.sending ? "disabled" : ""}>×</button></li>`).join("")}</ul>` : ""}
      <input id="chat-image-input" data-action="chat-image-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden ${chat.sending ? "disabled" : ""}>
      <div class="chat-actions"><button type="button" class="ghost" data-action="clear-chat" ${chat.sending || !chat.messages.length ? "disabled" : ""}>Limpar conversa</button>
        <button type="button" class="ghost chat-clip" data-action="attach-chat-image" aria-label="Anexar imagem" title="Anexar imagem (PNG, JPEG, WebP ou GIF até 5 MB)" ${chat.sending || chat.attachments.length >= MAX_IMAGES_PER_MESSAGE ? "disabled" : ""}><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10.5 4.5 5.6 9.4a1.6 1.6 0 0 0 2.3 2.3l4.6-4.6a3 3 0 0 0-4.3-4.3L3.6 7.6a4.4 4.4 0 0 0 6.2 6.2l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
        <button type="submit" class="primary" ${chat.sending || !ai.apiKey ? "disabled" : ""}>Enviar</button></div>
    </form>
  </section>`;
}
