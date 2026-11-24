import { escapeHtml } from "../models/format.js";
import { buildContextTree, leavesOf, selectedContextText } from "../models/context-tree.js";

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

function contextWindow(chat) {
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
    <p class="chat-context-note">Será enviado à Anthropic com a sua pergunta.</p>
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

export function renderChat(state) {
  const chat = state.chat;
  if (!chat.open) {
    return `<button type="button" class="chat-launcher" data-action="open-chat" aria-label="Abrir chat com Claude" aria-expanded="false">✦ <span>Chat IA</span></button>`;
  }
  const messages = chat.messages.map((message) => `<div class="chat-message ${message.role === "user" ? "chat-user" : "chat-assistant"}"><strong>${message.role === "user" ? "Você" : "Claude"}</strong><p>${escapeHtml(message.content)}</p>${message.context ? `<small class="chat-attach">Contexto anexado · ${message.context.length.toLocaleString("pt-BR")} caracteres</small>` : ""}</div>`).join("");
  const expandedContext = chat.useContext && !chat.contextCollapsed;
  const maxIcon = chat.maximized
    ? `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M5.5 5.5h8v8h-8zM2.5 10.5v-8h8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`
    : `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2.5 2.5h11v11h-11z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  return `<section class="chat-panel${expandedContext ? " has-context" : ""}${chat.maximized ? " is-max" : ""}" aria-label="Chat com Claude">
    <header class="chat-head"><div><strong>Chat IA</strong><span>Claude · dados do Bitbucket e do Jira só se você anexar</span></div>
      <div class="chat-head-actions">
        <button type="button" class="chat-close" id="chat-maximize" data-action="toggle-chat-maximize" aria-pressed="${Boolean(chat.maximized)}" aria-label="${chat.maximized ? "Restaurar tamanho do chat" : "Maximizar chat"}">${maxIcon}</button>
        <button type="button" class="chat-close" data-action="close-chat" aria-label="Minimizar chat">−</button>
      </div></header>
    <p class="chat-privacy">As mensagens são enviadas à Anthropic e podem gerar cobrança. Não inclua credenciais.</p>
    <div class="chat-messages" role="log" aria-live="polite">
      ${messages || `<p class="chat-empty">Olá! Posso ajudar com perguntas gerais. Para perguntar sobre o Bitbucket ou o Jira, ative "Anexar contexto" abaixo.</p>`}
      ${chat.sending ? `<p class="chat-empty">Claude está respondendo…</p>` : ""}
    </div>
    ${chat.error ? `<p class="chat-error" role="alert">${escapeHtml(chat.error)}</p>` : ""}
    ${chat.truncated ? `<p class="chat-error">A resposta atingiu o limite de tamanho. Peça para continuar.</p>` : ""}
    ${!state.claude.apiKey ? `<p class="chat-setup">Configure a chave em <button type="button" class="linkish" data-route="settings">Configuração</button>.</p>` : ""}
    ${chat.useContext ? contextWindow(chat) : ""}
    <form class="chat-compose" data-action="send-chat">
      <label class="chat-switch"><input id="chat-context-toggle" type="checkbox" role="switch" data-action="chat-context-toggle" ${chat.useContext ? "checked" : ""} ${chat.sending ? "disabled" : ""}><span class="chat-switch-track" aria-hidden="true"></span><span>Anexar contexto (Bitbucket / Jira)</span></label>
      <label class="chat-label" for="chat-draft">Mensagem</label>
      <textarea id="chat-draft" data-action="chat-draft" placeholder="Escreva sua mensagem" rows="2" required ${chat.sending ? "disabled" : ""}>${escapeHtml(chat.draft)}</textarea>
      <div class="chat-actions"><button type="button" class="ghost" data-action="clear-chat" ${chat.sending || !chat.messages.length ? "disabled" : ""}>Limpar conversa</button>
        <button type="submit" class="primary" ${chat.sending || !state.claude.apiKey ? "disabled" : ""}>Enviar</button></div>
    </form>
  </section>`;
}
