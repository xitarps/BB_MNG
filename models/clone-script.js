import { effectiveShell, gitIdentity } from "./config.js";

function quote(shell, value) {
  const text = String(value ?? "");
  if (shell === "powershell" || shell === "bash") {
    return `'${text.replace(/'/g, shell === "bash" ? `'\\''` : `''`)}'`;
  }
  return `"${text.replace(/%/g, "%%").replace(/"/g, '""')}"`;
}

function encodeUserinfo(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function httpsUrl(repo, workspace) {
  const found = (repo.clone || []).find((link) => link.name === "https")?.href;
  if (found) return found;
  return `https://bitbucket.org/${workspace}/${repo.slug}.git`;
}

function sshUrl(repo, workspace) {
  const found = (repo.clone || []).find((link) => link.name === "ssh")?.href;
  if (found) return found;
  return `git@bitbucket.org:${workspace}/${repo.slug}.git`;
}

export function cloneUrl(repo, config) {
  const workspace = config.workspace;
  if (config.protocol === "ssh") return sshUrl(repo, workspace);
  const url = new URL(httpsUrl(repo, workspace));
  url.username = "";
  url.password = "";
  const identity = gitIdentity(config);
  const user = encodeUserinfo(identity.user);
  const secret = config.includeTokenInUrl && config.token ? `:${encodeUserinfo(config.token)}` : "";
  return url.toString().replace("https://", `https://${user}${secret}@`);
}

export function maskSecrets(script, token) {
  let masked = String(script || "").replace(/https:\/\/([^:\s'"]+):([^@\s'"]+)@/g, "https://$1:***@");
  if (!token) return masked;
  const variants = [token, encodeURIComponent(token), encodeUserinfo(token)].filter(Boolean);
  for (const variant of variants) masked = masked.split(variant).join("***");
  return masked;
}

function repoEntries(repos, config) {
  return repos.map((repo) => ({
    name: repo.slug || repo.name,
    url: cloneUrl(repo, config)
  }));
}

function powershellScript(dest, entries, includeToken) {
  const lines = [
    "# Gerado pelo Crizsopha. Apague este arquivo depois de clonar se ele contiver token.",
    includeToken ? "# ATENCAO: este script contem o token na URL." : "# O Git vai pedir o token como senha.",
    "$ErrorActionPreference = 'Continue'",
    `if (-not (Get-Command git -ErrorAction SilentlyContinue)) {`,
    `  Write-Error 'Git nao encontrado no PATH. Instale Git for Windows e abra um terminal novo.'`,
    `  exit 1`,
    `}`,
    `$dest = ${quote("powershell", dest)}`,
    "New-Item -ItemType Directory -Force -Path $dest | Out-Null",
    "Set-Location -LiteralPath $dest",
    "$repos = @("
  ];
  for (const entry of entries) {
    lines.push(`  @{ Name = ${quote("powershell", entry.name)}; Url = ${quote("powershell", entry.url)} }`);
  }
  lines.push(
    ")",
    "$failed = @()",
    "foreach ($repo in $repos) {",
    "  Write-Host ('Clonando ' + $repo.Name)",
    "  git clone -- $repo.Url",
    "  if ($LASTEXITCODE -ne 0) { $failed += $repo.Name }",
    "}",
    "if ($failed.Count -gt 0) {",
    "  Write-Error ('Falhou: ' + ($failed -join ', '))",
    "  exit 1",
    "}",
    "Write-Host 'Concluido.'"
  );
  return lines.join("\r\n") + "\r\n";
}

function cmdScript(dest, entries, includeToken) {
  const lines = [
    "@echo off",
    "setlocal DisableDelayedExpansion",
    includeToken ? "REM ATENCAO: este script contem o token na URL." : "REM O Git vai pedir o token como senha.",
    "where git >nul 2>&1",
    "if errorlevel 1 (",
    "  echo Git nao encontrado no PATH. Instale Git for Windows.",
    "  exit /b 1",
    ")",
    `if not exist ${quote("cmd", dest)} mkdir ${quote("cmd", dest)}`,
    `cd /d ${quote("cmd", dest)}`,
    "set FAIL=0"
  ];
  for (const entry of entries) {
    lines.push(`echo Clonando ${quote("cmd", entry.name)}`);
    lines.push(`git clone -- ${quote("cmd", entry.url)}`);
    lines.push("if errorlevel 1 set FAIL=1");
  }
  lines.push("if not \"%FAIL%\"==\"0\" exit /b 1", "echo Concluido.");
  return lines.join("\r\n") + "\r\n";
}

function bashDest(dest) {
  if (dest.startsWith("$HOME/") || dest.startsWith("~/") || dest === "$HOME") {
    return `"$HOME${dest.replace(/^(\$HOME|~)/, "")}"`;
  }
  return quote("bash", dest);
}

function bashScript(dest, entries, includeToken) {
  const folder = bashDest(dest);
  const lines = [
    "#!/usr/bin/env bash",
    "set -u",
    includeToken ? "# ATENCAO: este script contem o token na URL." : "# O Git vai pedir o token como senha.",
    "command -v git >/dev/null 2>&1 || { echo 'Git nao esta no PATH.'; exit 1; }",
    `dest=${folder}`,
    'mkdir -p -- "$dest"',
    'cd -- "$dest"',
    "fail=0"
  ];
  for (const entry of entries) {
    lines.push(`echo ${quote("bash", `Clonando ${entry.name}`)}`);
    lines.push(`git clone -- ${quote("bash", entry.url)} || fail=1`);
  }
  lines.push('if [ "$fail" -ne 0 ]; then exit 1; fi', "echo Concluido.");
  return lines.join("\n") + "\n";
}

export function buildClonePlan(repos, config) {
  const shell = effectiveShell(config);
  const entries = repoEntries(repos, config);
  const identity = gitIdentity(config);
  const warnings = [];
  if (!repos.length) warnings.push("Marque ao menos um repositório.");
  if (config.protocol === "ssh") {
    warnings.push("SSH não usa o token. A chave já precisa estar cadastrada no Bitbucket — este token não tem permissão para enviar chave.");
  } else if (config.includeTokenInUrl) {
    warnings.push("O token vai ficar na URL e no histórico do terminal. Apague o script depois de usar. Prefira deixar o Git pedir a senha.");
  } else {
    warnings.push(`Quando o Git pedir a senha, cole o token. Usuário: ${identity.user} (${identity.hint}). Não use a senha da conta.`);
  }
  let script = "";
  let filename = "clonar-bitbucket.txt";
  if (entries.length) {
    if (shell === "powershell") {
      script = powershellScript(config.cloneDest, entries, config.includeTokenInUrl);
      filename = "clonar-bitbucket.ps1";
    } else if (shell === "cmd") {
      script = cmdScript(config.cloneDest, entries, config.includeTokenInUrl);
      filename = "clonar-bitbucket.bat";
    } else {
      script = bashScript(config.cloneDest, entries, config.includeTokenInUrl);
      filename = "clonar-bitbucket.sh";
    }
  }
  const example = entries[0] ? `git clone -- ${quote(shell === "cmd" ? "cmd" : shell, entries[0].url)}` : "";
  return {
    shell,
    os: config.os,
    filename,
    script,
    example,
    maskedScript: maskSecrets(script, config.token),
    maskedExample: maskSecrets(example, config.token),
    warnings,
    count: entries.length,
    identity
  };
}
