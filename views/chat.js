import { escapeHtml } from "../models/format.js";

export function renderChat(state) {
  const chat = state.chat;
  if (!chat.open) {
    return `<button type="button" class="chat-launcher" data-action="open-chat" aria-label="Abrir chat com Claude" aria-expanded="false">✦ <span>Chat IA</span></button>`;
  }
  const messages = chat.messages.map((message) => `<div class="chat-message ${message.role === "user" ? "chat-user" : "chat-assistant"}"><strong>${message.role === "user" ? "Você" : "Claude"}</strong><p>${escapeHtml(message.content)}</p></div>`).join("");
  return `<section class="chat-panel" aria-label="Chat com Claude">
    <header class="chat-head"><div><strong>Chat IA</strong><span>Claude · sem acesso ao Bitbucket</span></div>
      <button type="button" class="chat-close" data-action="close-chat" aria-label="Minimizar chat">−</button></header>
    <p class="chat-privacy">As mensagens são enviadas à Anthropic e podem gerar cobrança. Não inclua dados privados ou credenciais.</p>
    <div class="chat-messages" role="log" aria-live="polite">
      ${messages || `<p class="chat-empty">Olá! Posso ajudar com perguntas gerais. Não tenho acesso aos dados do painel.</p>`}
      ${chat.sending ? `<p class="chat-empty">Claude está respondendo…</p>` : ""}
    </div>
    ${chat.error ? `<p class="chat-error" role="alert">${escapeHtml(chat.error)}</p>` : ""}
    ${chat.truncated ? `<p class="chat-error">A resposta atingiu o limite de tamanho. Peça para continuar.</p>` : ""}
    ${!state.claude.apiKey ? `<p class="chat-setup">Configure a chave em <button type="button" class="linkish" data-route="settings">Configuração</button>.</p>` : ""}
    <form class="chat-compose" data-action="send-chat">
      <label class="chat-label" for="chat-draft">Mensagem</label>
      <textarea id="chat-draft" data-action="chat-draft" placeholder="Escreva sua mensagem" rows="2" required ${chat.sending ? "disabled" : ""}>${escapeHtml(chat.draft)}</textarea>
      <div class="chat-actions"><button type="button" class="ghost" data-action="clear-chat" ${chat.sending || !chat.messages.length ? "disabled" : ""}>Limpar conversa</button>
        <button type="submit" class="primary" ${chat.sending || !state.claude.apiKey ? "disabled" : ""}>Enviar</button></div>
    </form>
  </section>`;
}
