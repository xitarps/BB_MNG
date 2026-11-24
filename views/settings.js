import { escapeHtml } from "../models/format.js";
import { DECLARED_SCOPES } from "../models/scopes.js";
import { pageHead, tag } from "./html.js";

function modeOption(value, current, label) {
  return `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`;
}

export function renderSettings(state) {
  const config = state.config;
  const hasToken = Boolean(config.token);
  return `${pageHead("Configuração", "O token fica no localStorage deste navegador. Nada é gravado em arquivo pelo painel.")}
    <form class="card form" data-action="save-config" autocomplete="off">
      <label class="field wide"><span>Modo do token</span>
        <select name="authMode">
          ${modeOption("basic-email", config.authMode, "API token — e-mail Atlassian + token")}
          ${modeOption("bearer", config.authMode, "Access token — Bearer, sem e-mail")}
          ${modeOption("basic-user", config.authMode, "App password — usuário Bitbucket + token")}
        </select>
      </label>
      <label class="field"><span>E-mail Atlassian</span><input name="email" type="email" value="${escapeHtml(config.email)}" placeholder="voce@empresa.com" autocomplete="username"></label>
      <label class="field"><span>Usuário Bitbucket</span><input name="username" value="${escapeHtml(config.username)}" placeholder="o usuário da tela de perfil, não o e-mail" spellcheck="false" autocomplete="off"></label>
      <label class="field wide"><span>Token ${hasToken ? "— já salvo neste navegador. Cole outro só para substituir." : ""}</span>
        <input name="token" type="password" value="" placeholder="${hasToken ? "token armazenado localmente" : "cole o token gerado"}" autocomplete="off" spellcheck="false">
      </label>
      <label class="field"><span>Workspace</span><input name="workspace" value="${escapeHtml(config.workspace)}" placeholder="minha-empresa ou a URL do Bitbucket" spellcheck="false" autocomplete="off"></label>
      <label class="field"><span>Limite de repositórios na amostra</span><input name="maxRepos" type="number" min="10" max="200" value="${config.maxRepos}" autocomplete="off"></label>
      <label class="field"><span>Repositórios na amostra de pipelines</span><input name="pipelineRepos" type="number" min="0" max="40" value="${config.pipelineRepos}" autocomplete="off"></label>
      <label class="field"><span>Estado dos pull requests</span>
        <select name="prState">
          ${["OPEN", "MERGED", "DECLINED", "SUPERSEDED"].map((item) => `<option ${item === config.prState ? "selected" : ""}>${item}</option>`).join("")}
        </select>
      </label>
      <div class="btn-row wide">
        <button type="submit" class="primary">Salvar</button>
        <button type="button" class="ghost" data-action="test-connection">Testar conexão</button>
        <button type="button" class="danger" data-action="forget-token">Esquecer token</button>
        <button type="button" class="ghost" data-action="clear-cache">Limpar cache dos dados</button>
      </div>
      <p class="help wide">Access token de workspace usa o modo Access token (Bearer). A requisição manda esse esquema e prova o token em /2.0/repositories/{workspace}. Esse token normalmente não responde /2.0/user — isso não invalida o token. O menu escolhido é o esquema enviado; esse modo não é trocado por Basic. API token e app password usam Basic.</p>
      <p class="help wide">Esquema ativo: ${config.authMode === "bearer" ? "Bearer" : "Basic"}.</p>
      ${state.user ? `<p class="help wide">Conectado como ${escapeHtml(state.user.display_name)} (${escapeHtml(state.user.nickname || "sem nickname")}).</p>` : ""}
      ${state.userError ? `<p class="help wide">${escapeHtml(state.userError)}</p>` : ""}
    </form>
    <article class="card">
      <h2>O que este token deve alcançar</h2>
      <p class="sub">Conferência com a tela de scopes que você gerou. Itens desligados não aparecem no painel de propósito.</p>
      <div class="scopes">${DECLARED_SCOPES.map((scope) => `<div class="scope"><b>${escapeHtml(scope.group)} · ${escapeHtml(scope.name)}</b>${tag(scope.state === "off" ? "desligado" : scope.state === "implied" ? "implícito" : "marcado", scope.state === "off" ? "off" : "ok")}<span>${escapeHtml(scope.note)}</span></div>`).join("")}</div>
    </article>
    <article class="card">
      <h2>Como abrir no Windows</h2>
      <p class="help">Dê dois cliques em iniciar.bat. Ele sobe um servidor só em 127.0.0.1:8765 e você abre http://127.0.0.1:8765. O navegador chama api.bitbucket.org direto. Se a rede bloquear essa chamada, o mesmo servidor encaminha /bitbucket sem gravar o token.</p>
      <p class="help">No Linux o equivalente é ./iniciar.sh. O interruptor de clone, na aba Clonar, troca o script entre Windows e Linux sem mudar essa parte.</p>
    </article>`;
}
