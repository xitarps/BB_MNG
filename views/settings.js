import { escapeHtml } from "../models/format.js";
import { JIRA_SCOPES } from "../models/jira-config.js";
import { DECLARED_SCOPES } from "../models/scopes.js";
import { pageHead, tag } from "./html.js";

function modeOption(value, current, label) {
  return `<option value="${value}" ${value === current ? "selected" : ""}>${label}</option>`;
}

export function renderSettings(state) {
  const config = state.config;
  const jira = state.jiraConfig;
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
        <button type="button" class="ghost" data-action="download-bitbucket-context">Baixar JSON do Bitbucket</button>
      </div>
      <p class="help wide">Access token de workspace usa o modo Access token (Bearer). A requisição manda esse esquema e prova o token em /2.0/repositories/{workspace}. Esse token normalmente não responde /2.0/user — isso não invalida o token. O menu escolhido é o esquema enviado; esse modo não é trocado por Basic. API token e app password usam Basic.</p>
      <p class="help wide">Esquema ativo: ${config.authMode === "bearer" ? "Bearer" : "Basic"}.</p>
      ${state.user ? `<p class="help wide">Conectado como ${escapeHtml(state.user.display_name)} (${escapeHtml(state.user.nickname || "sem nickname")}).</p>` : ""}
      ${state.userError ? `<p class="help wide">${escapeHtml(state.userError)}</p>` : ""}
    </form>
    <form class="card form" data-action="save-jira" autocomplete="off">
      <h2 class="wide">Jira Cloud</h2>
      <p class="help wide">O e-mail e o API token ficam no localStorage deste navegador. As consultas passam pelo servidor local do painel (iniciar.bat ou iniciar.sh), porque o Jira não aceita chamadas diretas do navegador; o servidor só repassa a requisição e não grava o token. Use um API token da Atlassian <b>sem escopos</b> (id.atlassian.com → Segurança → API tokens).</p>
      <label class="field wide"><span>Endereço do Jira</span><input name="site" value="${escapeHtml(jira.site)}" placeholder="empresa.atlassian.net" spellcheck="false" autocomplete="off"></label>
      <label class="field"><span>E-mail da conta Atlassian</span><input name="email" type="email" value="${escapeHtml(jira.email)}" placeholder="voce@empresa.com" autocomplete="off"></label>
      <label class="field"><span>API token ${jira.token ? "— já salvo; preencha apenas para substituir" : ""}</span>
        <input name="token" type="password" placeholder="${jira.token ? "token armazenado localmente" : "cole o API token"}" autocomplete="off" spellcheck="false"></label>
      <label class="field"><span>Projetos (opcional, separados por vírgula)</span><input name="projects" value="${escapeHtml(jira.projects)}" placeholder="ABC, XYZ — vazio lê todos os visíveis" spellcheck="false" autocomplete="off"></label>
      <label class="field"><span>Quais issues buscar</span>
        <select name="scope">${Object.entries(JIRA_SCOPES).map(([value, label]) => `<option value="${value}" ${value === jira.scope ? "selected" : ""}>${label}</option>`).join("")}</select>
      </label>
      <label class="field"><span>Limite de issues (50 a 1000)</span><input name="maxIssues" type="number" min="50" max="1000" value="${jira.maxIssues}" autocomplete="off"></label>
      <label class="field wide"><span>JQL personalizada (opcional; substitui projetos e filtro acima)</span><input name="jql" value="${escapeHtml(jira.jql)}" placeholder='assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC' spellcheck="false" autocomplete="off"></label>
      <div class="btn-row wide">
        <button type="submit" class="primary">Salvar Jira</button>
        <button type="button" class="ghost" data-action="test-jira">Testar conexão</button>
        <button type="button" class="danger" data-action="forget-jira">Esquecer token</button>
        <button type="button" class="ghost" data-action="clear-jira-cache">Limpar cache do Jira</button>
        <button type="button" class="ghost" data-action="download-jira-context">Baixar JSON do Jira</button>
      </div>
      ${state.jiraUser ? `<p class="help wide">Conectado ao Jira como ${escapeHtml(state.jiraUser.display_name)}.</p>` : ""}
      <p class="help wide">A consulta precisa de uma restrição (por exemplo, status ou datas): o Jira recusa buscas sem limites. A leitura usa apenas GET e o escopo equivalente a "ler issues e projetos".</p>
    </form>
    <form class="card form" data-action="save-claude" autocomplete="off">
      <h2 class="wide">IA pessoal · Claude</h2>
      <p class="help wide">A chave fica no localStorage deste navegador, acessível a scripts desta origem. Use apenas um computador confiável. As conversas são enviadas diretamente à Anthropic e podem gerar cobrança; não inclua credenciais. O Claude só recebe dados do Bitbucket ou do Jira quando você liga "Anexar contexto" no chat e envia a mensagem; você escolhe, campo a campo, o que anexar antes do envio.</p>
      <label class="field wide"><span>Chave de API ${state.claude.apiKey ? "— já salva; preencha apenas para substituir" : ""}</span>
        <input name="apiKey" type="password" placeholder="${state.claude.apiKey ? "chave armazenada neste navegador" : "chave da API Anthropic"}" autocomplete="off" spellcheck="false">
      </label>
      <label class="field wide"><span>ID do modelo Claude</span><input name="model" value="${escapeHtml(state.claude.model)}" required spellcheck="false" autocomplete="off"></label>
      <div class="btn-row wide"><button type="submit" class="primary">Salvar IA</button>
        <button type="button" class="danger" data-action="forget-claude" ${state.claude.apiKey && !state.chat.sending ? "" : "disabled"}>Esquecer chave</button></div>
      <p class="help wide">Configure uma chave da API Anthropic; a assinatura do aplicativo Claude pode não incluir acesso à API. A conversa permanece apenas nesta página e é perdida ao recarregar.</p>
    </form>
    <article class="card">
      <h2>O que este token deve alcançar</h2>
      <p class="sub">Conferência com a tela de scopes que você gerou. Itens desligados não aparecem no painel de propósito.</p>
      <div class="scopes">${DECLARED_SCOPES.map((scope) => `<div class="scope"><b>${escapeHtml(scope.group)} · ${escapeHtml(scope.name)}</b>${tag(scope.state === "off" ? "desligado" : scope.state === "implied" ? "implícito" : "marcado", scope.state === "off" ? "off" : "ok")}<span>${escapeHtml(scope.note)}</span></div>`).join("")}</div>
    </article>
    <article class="card">
      <h2>Como abrir no Windows</h2>
      <p class="help">Dê dois cliques em iniciar.bat. Ele sobe um servidor só em 127.0.0.1:8765 e você abre http://127.0.0.1:8765. O navegador chama api.bitbucket.org direto. Se a rede bloquear essa chamada, o mesmo servidor encaminha /bitbucket sem gravar o token. O Jira sempre passa por esse servidor (rota /jira), porque ele não aceita chamadas diretas do navegador.</p>
      <p class="help">No Linux o equivalente é ./iniciar.sh. O interruptor de clone, na aba Clonar, troca o script entre Windows e Linux sem mudar essa parte.</p>
    </article>`;
}
