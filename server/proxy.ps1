# Static server + Bitbucket fallback proxy. ASCII only for Windows PowerShell 5.1.
#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $root.EndsWith([IO.Path]::DirectorySeparatorChar)) {
  $root = $root + [IO.Path]::DirectorySeparatorChar
}
$port = 8765
$prefix = "http://127.0.0.1:$port/"
$allowed = @{
  ".html" = "text/html; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
  ".svg" = "image/svg+xml"
  ".json" = "application/json; charset=utf-8"
  ".ico" = "image/x-icon"
  ".txt" = "text/plain; charset=utf-8"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
  $listener.Start()
} catch {
  Write-Host "Nao foi possivel abrir $prefix"
  Write-Host $_.Exception.Message
  Write-Host "Se pedir permissao, rode uma vez:"
  Write-Host "netsh http add urlacl url=http://127.0.0.1:8765/ user=$env:USERDOMAIN\$env:USERNAME"
  exit 1
}

Add-Type -AssemblyName System.Net.Http
$http = New-Object System.Net.Http.HttpClient
$http.Timeout = [TimeSpan]::FromSeconds(90)
# Jira client never follows redirects: a redirect would resend the Authorization header elsewhere.
$jiraHandler = New-Object System.Net.Http.HttpClientHandler
$jiraHandler.AllowAutoRedirect = $false
$jiraHttp = New-Object System.Net.Http.HttpClient($jiraHandler)
$jiraHttp.Timeout = [TimeSpan]::FromSeconds(90)
Write-Host "Crizsopha em $prefix"
Write-Host "Ctrl+C encerra. Os tokens nao sao gravados aqui."

function Send-Bytes($context, [int]$status, [byte[]]$bytes, [string]$contentType) {
  $context.Response.StatusCode = $status
  $context.Response.ContentType = $contentType
  $context.Response.Headers.Add("Cache-Control", "no-store")
  $context.Response.Headers.Add("X-Content-Type-Options", "nosniff")
  $context.Response.ContentLength64 = $bytes.Length
  if ($context.Request.HttpMethod -ne "HEAD") {
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  }
  $context.Response.Close()
}

function Send-Text($context, [int]$status, [string]$text, [string]$contentType) {
  Send-Bytes $context $status ([Text.Encoding]::UTF8.GetBytes($text)) $contentType
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $rawPath = $context.Request.Url.AbsolutePath
      $method = $context.Request.HttpMethod
      if ($method -eq "OPTIONS") {
        $context.Response.StatusCode = 204
        $context.Response.Close()
        continue
      }
      if ($method -ne "GET" -and $method -ne "HEAD") {
        Send-Text $context 405 "method not allowed" "text/plain; charset=utf-8"
        continue
      }
      if ($rawPath -eq "/health") {
        Send-Text $context 200 '{"ok":true,"service":"crizsopha"}' "application/json"
        continue
      }
      if ($rawPath -eq "/bitbucket" -or $rawPath.StartsWith("/bitbucket/")) {
        $upstream = "https://api.bitbucket.org" + $context.Request.Url.PathAndQuery.Substring("/bitbucket".Length)
        $msg = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, $upstream)
        $auth = $context.Request.Headers["Authorization"]
        if ($auth) { [void]$msg.Headers.TryAddWithoutValidation("Authorization", $auth) }
        [void]$msg.Headers.TryAddWithoutValidation("Accept", "application/json")
        [void]$msg.Headers.TryAddWithoutValidation("User-Agent", "crizsopha-local")
        $resp = $http.SendAsync($msg).GetAwaiter().GetResult()
        $bytes = $resp.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        $type = "application/json"
        if ($resp.Content.Headers.ContentType) { $type = $resp.Content.Headers.ContentType.ToString() }
        Send-Bytes $context ([int]$resp.StatusCode) $bytes $type
        $resp.Dispose()
        $msg.Dispose()
        continue
      }
      if ($rawPath -eq "/jira" -or $rawPath.StartsWith("/jira/")) {
        $pathAndQuery = $context.Request.Url.PathAndQuery
        $hostName = ""
        $restPath = ""
        if ($pathAndQuery.StartsWith("/jira/")) {
          $tail = $pathAndQuery.Substring(6)
          $slash = $tail.IndexOf("/")
          if ($slash -gt 0) {
            $hostName = $tail.Substring(0, $slash)
            $restPath = $tail.Substring($slash + 1)
          }
        }
        if (($hostName -cnotmatch '^[a-z0-9][a-z0-9-]*\.atlassian\.net$') -or (-not $restPath.StartsWith("rest/"))) {
          Send-Text $context 400 '{"error":{"message":"caminho invalido"}}' "application/json"
          continue
        }
        $jiraMsg = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, ("https://" + $hostName + "/" + $restPath))
        $jiraAuth = $context.Request.Headers["Authorization"]
        if ($jiraAuth) { [void]$jiraMsg.Headers.TryAddWithoutValidation("Authorization", $jiraAuth) }
        [void]$jiraMsg.Headers.TryAddWithoutValidation("Accept", "application/json")
        [void]$jiraMsg.Headers.TryAddWithoutValidation("User-Agent", "crizsopha-local")
        try {
          $jiraResp = $jiraHttp.SendAsync($jiraMsg).GetAwaiter().GetResult()
          $jiraBytes = $jiraResp.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
          $jiraType = "application/json"
          if ($jiraResp.Content.Headers.ContentType) { $jiraType = $jiraResp.Content.Headers.ContentType.ToString() }
          Send-Bytes $context ([int]$jiraResp.StatusCode) $jiraBytes $jiraType
          $jiraResp.Dispose()
        } catch {
          Send-Text $context 502 '{"error":{"message":"falha ao falar com o Jira"}}' "application/json"
        }
        $jiraMsg.Dispose()
        continue
      }
      $rel = [Uri]::UnescapeDataString($rawPath)
      if ($rel -eq "/") { $rel = "/index.html" }
      $rel = $rel.TrimStart("/").Replace("/", [IO.Path]::DirectorySeparatorChar)
      $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
      if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        Send-Text $context 403 "forbidden" "text/plain; charset=utf-8"
        continue
      }
      $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
      if (-not (Test-Path -LiteralPath $full -PathType Leaf) -or -not $allowed.ContainsKey($ext)) {
        Send-Text $context 404 "not found" "text/plain; charset=utf-8"
        continue
      }
      Send-Bytes $context 200 ([IO.File]::ReadAllBytes($full)) $allowed[$ext]
    } catch {
      try { Send-Text $context 500 "erro interno" "text/plain; charset=utf-8" } catch {}
    }
  }
} finally {
  $listener.Stop()
  $http.Dispose()
  $jiraHttp.Dispose()
}
