# 법률사무소 위드윤 칼럼 — 큐 자동 보충 작업 등록
#
#   pwsh -File scripts/author/register-task.ps1
#
# withyoon-column-refill   매일 23:10  scripts/author/refill-queue.mjs --git
#   blog/scheduled.json 이 10편 미만이면 claude 로 초안을 써서 20편까지 채운다.
#   렌더링 → 주소 정규화 → verify 를 통과한 것만 큐에 넣고 커밋·푸시한다.
#   발행은 GitHub Actions(publish-scheduled.yml)가 매일 00:05 KST 에 한다.
#
# 실패하면 바탕화면에 위드윤_칼럼보충_실패.txt 가 생긴다.

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$node = 'C:\Users\c\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.19.0-win-x64\node.exe'

if (-not (Test-Path $node)) { throw "node.exe 를 찾지 못했습니다: $node" }
if (-not (Test-Path (Join-Path $here 'scripts\author\refill-queue.mjs'))) { throw "저장소 경로가 아닙니다: $here" }

$action = New-ScheduledTaskAction -Execute $node -Argument 'scripts/author/refill-queue.mjs --git' -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -Daily -At '23:10'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive

Register-ScheduledTask -TaskName 'withyoon-column-refill' -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force `
  -Description '법률사무소 위드윤 칼럼 - 예약분이 10편 미만이면 claude 로 초안을 쓰고 verify 통과분만 큐에 넣어 푸시. 실패 시 바탕화면 알림' | Out-Null

Write-Host "등록: withyoon-column-refill (매일 23:10)  $here"
Get-ScheduledTaskInfo -TaskName 'withyoon-column-refill' | Select-Object TaskName, NextRunTime | Format-Table -AutoSize
