import { escapeHtml } from "../models/format.js";
import { PROVIDERS, PROVIDER_IDS } from "../models/ai.js";
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
    <form class="card form" data-action="save-ai" autocomplete="off">
      <h2 class="wide">IA pessoal</h2>
      <p class="help wide">As chaves ficam no localStorage deste navegador, acessíveis a scripts desta origem. Use apenas um computador confiável. As conversas são enviadas diretamente ao provedor em uso e podem gerar cobrança; não inclua credenciais. A IA só recebe dados do Bitbucket ou do Jira quando você liga "Anexar contexto" no chat e envia a mensagem; você escolhe, campo a campo, o que anexar antes do envio.</p>
      <label class="field wide"><span>Provedor em uso (também dá para trocar no cabeçalho do chat)</span>
        <select name="provider" aria-label="Provedor de IA em uso">${PROVIDER_IDS.map((id) => `<option value="${id}" ${id === state.ai.provider ? "selected" : ""}>${escapeHtml(PROVIDERS[id].label)}</option>`).join("")}</select>
      </label>
      <label class="field wide"><span>Instruções padrão (contexto fixo enviado em todas as mensagens)</span>
        <textarea name="instructions" rows="5" spellcheck="true" aria-label="Instruções padrão para a IA" placeholder="Ex.: Sempre usar o source_branch no lugar do id quando se tratar de pull requests do Bitbucket.">${escapeHtml(state.ai.instructions)}</textarea>
        <span class="help">Vão no prompt de sistema do provedor em uso, a cada resposta, sem se repetir no histórico. Até 4.000 caracteres. Não coloque credenciais: o texto é enviado ao provedor. O botão Testar não usa estas instruções.</span>
      </label>
      ${PROVIDER_IDS.map((id) => {
        const provider = PROVIDERS[id];
        const saved = state.ai.providers[id];
        return `<fieldset class="ai-provider wide ${id === state.ai.provider ? "active" : ""}">
          <legend>${escapeHtml(provider.label)}${id === state.ai.provider ? " · em uso" : ""}</legend>
          <label class="field"><span>Chave de API ${saved.apiKey ? "— já salva; preencha apenas para substituir" : ""}</span>
            <input name="key-${id}" type="password" placeholder="${saved.apiKey ? "chave armazenada neste navegador" : escapeHtml(provider.keyHint)}" autocomplete="off" spellcheck="false"></label>
          <label class="field"><span>ID do modelo</span>
            <input name="model-${id}" list="models-${id}" value="${escapeHtml(saved.model)}" required spellcheck="false" autocomplete="off">
            <datalist id="models-${id}">${provider.models.map((model) => `<option value="${escapeHtml(model)}"></option>`).join("")}</datalist></label>
          <p class="help wide">${escapeHtml(provider.help)}</p>
          <div class="btn-row wide">
            <button type="button" class="ghost" data-action="test-ai" data-provider="${id}" ${state.chat.sending || state.syncing ? "disabled" : ""}>Testar ${escapeHtml(provider.label)}</button>
            <button type="button" class="danger" data-action="forget-ai" data-provider="${id}" ${saved.apiKey && !state.chat.sending ? "" : "disabled"}>Esquecer chave do ${escapeHtml(provider.label)}</button>
          </div>
        </fieldset>`;
      }).join("")}
      <div class="btn-row wide"><button type="submit" class="primary">Salvar IA</button></div>
      <p class="help wide">A conversa permanece apenas nesta página e é perdida ao recarregar. Ao trocar de provedor, o histórico da conversa atual é reenviado ao novo provedor.</p>
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
