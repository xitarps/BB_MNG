const CONFIG_KEY = "crizsopha.claude.config";
export const DEFAULT_CLAUDE_MODEL = "claude-haiku-5-5";

export function loadClaudeConfig() {
  const raw = localStorage.getItem(CONFIG_KEY);
  if (!raw) return { apiKey: "", model: DEFAULT_CLAUDE_MODEL };
  try {
    const saved = JSON.parse(raw);
    if (typeof saved.apiKey !== "string" || typeof saved.model !== "string") {
      throw new Error("Configuração do Claude inválida.");
    }
    return { apiKey: saved.apiKey, model: saved.model };
  } catch (error) {
    throw new Error("Não foi possível ler a configuração do Claude. Salve a configuração novamente.", { cause: error });
  }
}

export function saveClaudeConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ apiKey: config.apiKey, model: config.model }));
}

export async function sendClaudeMessage(config, messages, signal) {
  if (!config.apiKey) throw new Error("Configure a chave da API do Claude em Configuração.");
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(config.model)) throw new Error("Informe um ID de modelo Claude válido em Configuração.");
  if (!Array.isArray(messages) || !messages.length || messages.some((message) =>
    !["user", "assistant"].includes(message.role) || typeof message.content !== "string" || !message.content.trim()
  ) || messages[messages.length - 1].role !== "user") {
    throw new Error("Não foi possível enviar a conversa: mensagens inválidas.");
  }
  let response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 1024,
        system: "Responda em português. Você não tem acesso ao Bitbucket, ao Jira ou aos dados deste painel. Não afirme ter consultado esses dados.",
        messages: messages.map(({ role, content }) => ({ role, content }))
      }),
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: signal || AbortSignal.timeout(120000)
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    if (error.name === "TimeoutError") throw new Error("A Anthropic demorou para responder. Tente novamente.", { cause: error });
    throw new Error("Não foi possível conectar à API da Anthropic. Confira a rede e tente novamente.", { cause: error });
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error("A Anthropic recusou a chave de API. Confira a configuração.");
    if (response.status === 403) throw new Error("A chave não tem acesso ao Claude ou ao modelo escolhido.");
    if (response.status === 429) throw new Error("Limite de requisições da Anthropic atingido. Aguarde e tente novamente.");
    if (response.status === 404) throw new Error("Modelo não encontrado. Confira o ID configurado e o acesso da sua conta.");
    throw new Error(`A API da Anthropic retornou erro HTTP ${response.status}. Confira o modelo e o saldo da conta.`);
  }
  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error("A Anthropic retornou uma resposta inválida.", { cause: error });
  }
  if (!Array.isArray(result?.content)) throw new Error("A Anthropic retornou uma resposta sem conteúdo.");
  const text = result.content.filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text).join("\n").trim();
  if (!text) throw new Error("A Anthropic não retornou texto nesta resposta.");
  return { text, truncated: result.stop_reason === "max_tokens" };
}
