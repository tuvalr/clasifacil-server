# Kills all locally running instances of this repo's server (main worktree only).
# Leaves untouched: other worktrees under .claude\worktrees\*, and unrelated repos/processes.
#
# Usage: powershell -File scripts\kill-server.ps1
#        or from inside PowerShell: .\scripts\kill-server.ps1

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')

$targets = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
	$_.CommandLine -like "*$repoRoot\node_modules*" -and $_.CommandLine -notlike "*worktrees*"
}

if (-not $targets) {
	Write-Host "No running server instances found for $repoRoot."
	exit 0
}

Write-Host "Killing $($targets.Count) process(es):"
$targets | ForEach-Object {
	Write-Host "  PID $($_.ProcessId): $($_.CommandLine)"
}

$targets | ForEach-Object {
	Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 1

# Orphaned nodemon watchers (global nodemon.js has no repo path in its own commandline, so it survives
# its cross-env parent's death as a zombie) - only kill ones whose parent PID no longer exists.
$orphans = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
	$_.CommandLine -like '*nodemon*' -and -not (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue)
}
if ($orphans) {
	Write-Host "Killing $($orphans.Count) orphaned nodemon watcher(s):"
	$orphans | ForEach-Object {
		Write-Host "  PID $($_.ProcessId)"
		Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
	}
}

Write-Host "Done."
