import { cleanToken, effectiveShell, gitIdentity } from "./config.js";
import { bashDest, maskSecrets, quote } from "./clone-script.js";

function basicCredential(config) {
  const bytes = new TextEncoder().encode(`${gitIdentity(config).user}:${cleanToken(config.token)}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bashScript(dest, names, credential) {
  const lines = [
    "#!/usr/bin/env bash",
    "# Este arquivo pode conter credenciais. Apague-o depois de usar.",
    "(",
    "set -u",
    "command -v git >/dev/null 2>&1 || { echo 'Git nao esta no PATH.'; exit 1; }",
    `dest=${bashDest(dest)}`,
    "fail=0"
  ];
  if (credential) lines.push(
    "export GIT_TERMINAL_PROMPT=0 GIT_CONFIG_COUNT=1",
    "export GIT_CONFIG_KEY_0='http.https://bitbucket.org/.extraheader'",
    `export GIT_CONFIG_VALUE_0=${quote("bash", `Authorization: Basic ${credential}`)}`
  );
  for (const name of names) lines.push(
    `repo="$dest"/${quote("bash", name)}`,
    `echo ${quote("bash", `Atualizando ${name}`)}`,
    'if [ ! -e "$repo/.git" ]; then',
    '  echo "Repositorio nao encontrado: $repo" >&2; fail=1',
    'else',
    '  branch=$(git -C "$repo" symbolic-ref --quiet --short HEAD) || branch=""',
    '  case "$branch" in',
    '    main|master) git -C "$repo" pull --ff-only origin "$branch" || fail=1 ;;',
    '    *) echo "Branch atual nao e main ou master: $repo" >&2; fail=1 ;;',
    '  esac',
    'fi'
  );
  lines.push('if [ "$fail" -ne 0 ]; then echo "Uma ou mais atualizacoes falharam." >&2; exit 1; fi', "echo Concluido.", ")");
  return lines.join("\n") + "\n";
}

function powershellScript(dest, names, credential) {
  const lines = [
    "# Este arquivo pode conter credenciais. Apague-o depois de usar.",
    "if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Error 'Git nao encontrado no PATH.'; exit 1 }",
    `$dest = ${quote("powershell", dest)}`,
    `$repos = @(${names.map((name) => quote("powershell", name)).join(", ")})`,
    "$failed = @()",
    "$keys = @('GIT_TERMINAL_PROMPT', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0')",
    "$previous = @{}",
    "foreach ($key in $keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }",
    "try {"
  ];
  if (credential) lines.push(
    "  $env:GIT_TERMINAL_PROMPT = '0'",
    "  $env:GIT_CONFIG_COUNT = '1'",
    "  $env:GIT_CONFIG_KEY_0 = 'http.https://bitbucket.org/.extraheader'",
    `  $env:GIT_CONFIG_VALUE_0 = ${quote("powershell", `Authorization: Basic ${credential}`)}`
  );
  lines.push(
    "  foreach ($name in $repos) {",
    "    $repo = Join-Path $dest $name",
    "    Write-Host ('Atualizando ' + $name)",
    "    if (-not (Test-Path -LiteralPath (Join-Path $repo '.git'))) { Write-Host ('Repositorio nao encontrado: ' + $repo); $failed += $name; continue }",
    "    $branch = git -C $repo symbolic-ref --quiet --short HEAD",
    "    if ($LASTEXITCODE -ne 0 -or ($branch -cne 'main' -and $branch -cne 'master')) { Write-Host ('Branch atual nao e main ou master: ' + $name); $failed += $name; continue }",
    "    git -C $repo pull --ff-only origin $branch",
    "    if ($LASTEXITCODE -ne 0) { $failed += $name }",
    "  }",
    "} finally {",
    "  foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }",
    "}",
    "if ($failed.Count -gt 0) { Write-Error ('Falhou: ' + ($failed -join ', ')); exit 1 }",
    "Write-Host 'Concluido.'"
  );
  return lines.join("\r\n") + "\r\n";
}

function cmdScript(dest, names, credential) {
  const lines = [
    "@echo off",
    "setlocal DisableDelayedExpansion",
    "REM Este arquivo pode conter credenciais. Apague-o depois de usar.",
    "where git >nul 2>&1",
    "if errorlevel 1 (echo Git nao encontrado no PATH. & exit /b 1)",
    "set FAIL=0"
  ];
  if (credential) lines.push(
    'set "GIT_TERMINAL_PROMPT=0"',
    'set "GIT_CONFIG_COUNT=1"',
    'set "GIT_CONFIG_KEY_0=http.https://bitbucket.org/.extraheader"',
    `set "GIT_CONFIG_VALUE_0=Authorization: Basic ${credential}"`
  );
  for (const name of names) {
    const path = quote("cmd", `${dest.replace(/[\\/]$/, "")}\\${name}`);
    lines.push(
      `echo Atualizando ${quote("cmd", name)}`,
      'set "BRANCH="',
      `if not exist ${path}\\.git (echo Repositorio nao encontrado: ${path} & set FAIL=1) else for /f "delims=" %%B in ('git -C ${path} symbolic-ref --quiet --short HEAD') do set "BRANCH=%%B"`,
      `if "%BRANCH%"=="main" (git -C ${path} pull --ff-only origin main || set FAIL=1)`,
      `if "%BRANCH%"=="master" (git -C ${path} pull --ff-only origin master || set FAIL=1)`,
      'if not "%BRANCH%"=="main" if not "%BRANCH%"=="master" (echo Branch atual nao e main ou master. & set FAIL=1)'
    );
  }
  lines.push('if not "%FAIL%"=="0" (echo Uma ou mais atualizacoes falharam. & exit /b 1)', "echo Concluido.");
  return lines.join("\r\n") + "\r\n";
}

export function buildUpdatePlan(repos, config) {
  const shell = effectiveShell(config);
  const names = repos.map((repo) => repo.slug || repo.name);
  const warnings = ["Atualiza somente a branch atual main ou master, com fast-forward; não troca de branch nem descarta alterações. Cada pasta deve ter o nome do slug e um remoto origin correspondente ao protocolo escolhido."];
  if (!names.length) warnings.push("Marque ao menos um repositório.");
  const invalid = names.some((name) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name));
  if (invalid) warnings.push("Há um slug inválido na seleção.");
  const useToken = config.protocol === "https";
  if (useToken) warnings.push("O script contém o token codificado, não criptografado. Não compartilhe e apague o arquivo após o uso. O token só é enviado a origin HTTPS no bitbucket.org.");
  else warnings.push("SSH usa a chave configurada no Git, não o token.");
  if (useToken && !cleanToken(config.token)) warnings.push("Salve um token na configuração antes de gerar o script.");
  if (useToken && !gitIdentity(config).user) warnings.push("Informe o usuário Bitbucket na configuração.");
  const credential = useToken && cleanToken(config.token) && gitIdentity(config).user ? basicCredential(config) : "";
  let script = "";
  if (names.length && !invalid && (!useToken || credential)) {
    script = shell === "powershell" ? powershellScript(config.cloneDest, names, credential)
      : shell === "cmd" ? cmdScript(config.cloneDest, names, credential)
        : bashScript(config.cloneDest, names, credential);
  }
  return {
    shell,
    filename: `atualizar-bitbucket.${shell === "powershell" ? "ps1" : shell === "cmd" ? "bat" : "sh"}`,
    script,
    maskedScript: maskSecrets(credential ? script.split(credential).join("***") : script, config.token),
    example: "",
    maskedExample: "",
    warnings,
    count: names.length
  };
}
