export const DEFAULT_CONFIG = {
  authMode: "basic-email",
  email: "",
  username: "",
  token: "",
  workspace: "",
  os: "windows",
  shell: "powershell",
  cloneDest: "C:\\dev\\bitbucket",
  includeTokenInUrl: false,
  protocol: "https",
  maxRepos: 50,
  pipelineRepos: 12,
  prState: "OPEN",
  lastAuthMode: ""
};

export const WIN_DEST = "C:\\dev\\bitbucket";
export const LIN_DEST = "$HOME/dev/bitbucket";

export function cleanToken(value) {
  let token = String(value || "").trim();
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }
  return token.replace(/^(Bearer|Basic)\s+/i, "").trim();
}

export function normalizeWorkspace(value) {
  let slug = String(value || "").trim().replace(/\/+$/, "");
  const fromUrl = slug.match(/bitbucket\.org\/([^/?#]+)/i);
  if (fromUrl) slug = fromUrl[1];
  slug = slug.replace(/^\/+/, "");
  if (slug.includes("/")) slug = slug.split("/")[0];
  return slug.replace(/\.git$/i, "").toLowerCase();
}

export function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function activeAuthMode(config) {
  return config?.authMode || "bearer";
}

export function authHeader(config, mode = activeAuthMode(config)) {
  const token = cleanToken(config.token);
  if (!token) throw new Error("Salve um token antes de consultar o Bitbucket.");
  if (mode === "bearer") return `Bearer ${token}`;
  const user = mode === "basic-user" ? config.username.trim() : config.email.trim();
  if (!user) {
    throw new Error(
      mode === "basic-user"
        ? "Informe o usuário Bitbucket para o app password."
        : "Informe o e-mail da conta Atlassian para o API token."
    );
  }
  const bytes = new TextEncoder().encode(`${user}:${token}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

export function validateConfig(config, { requireWorkspace = false } = {}) {
  if (!cleanToken(config.token)) return "Cole o token gerado no Bitbucket.";
  if (config.authMode === "basic-email" && !config.email.includes("@")) {
    return "No modo API token, use o e-mail da conta Atlassian (não o usuário do Bitbucket).";
  }
  if (config.authMode === "basic-user" && !config.username.trim()) {
    return "No modo app password, informe o usuário Bitbucket.";
  }
  if (requireWorkspace && !normalizeWorkspace(config.workspace)) {
    return config.authMode === "bearer"
      ? "Token de workspace precisa do slug, por exemplo sophatech."
      : "Informe o slug do workspace, por exemplo minha-empresa.";
  }
  return "";
}

export function gitIdentity(config) {
  if (activeAuthMode(config) === "basic-user") {
    return { user: config.username.trim(), hint: "usuário Bitbucket" };
  }
  if (activeAuthMode(config) === "bearer") {
    return { user: "x-token-auth", hint: "usuário fixo de access token" };
  }
  if (config.username.trim()) {
    return { user: config.username.trim(), hint: "usuário Bitbucket, diferente do e-mail" };
  }
  return { user: "x-bitbucket-api-token-auth", hint: "usuário fixo de API token" };
}

export function effectiveShell(config) {
  if (config.os === "linux") return "bash";
  return config.shell === "cmd" ? "cmd" : "powershell";
}

export function destinationFor(os, current) {
  if (os === "linux" && (!current || current === WIN_DEST)) return LIN_DEST;
  if (os === "windows" && (!current || current === LIN_DEST)) return WIN_DEST;
  return current || (os === "linux" ? LIN_DEST : WIN_DEST);
}
