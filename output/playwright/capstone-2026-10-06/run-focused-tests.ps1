$ErrorActionPreference = 'Stop'
$evidenceDir = $PSScriptRoot
$cases = @(
 @{Id='TC01';Name='Authentication and Role Access';Paths=@('modules/auth/auth.service.spec.ts','common/guards/roles.guard.spec.ts')},
 @{Id='TC02';Name='Coverage Checking';Paths=@('modules/coverage/coverage.service.spec.ts','modules/coverage/database-qualification.provider.spec.ts')},
 @{Id='TC03';Name='Subscription Management';Paths=@('modules/subscriptions/subscriptions.service.spec.ts','modules/payments/payments.service.spec.ts')},
 @{Id='TC04';Name='Duplicate Invoice Prevention';Paths=@('modules/invoices/invoices.service.spec.ts')},
 @{Id='TC05';Name='Cancellation and Refund';Paths=@('modules/cancellations/cancellations.service.spec.ts','modules/cancellations/cancellation-workflow-policy.service.spec.ts','modules/refunds/refund-policy.service.spec.ts')},
 @{Id='TC06';Name='Service Relocation';Paths=@('modules/relocations/relocations.service.spec.ts','modules/relocations/providers/mock-relocation.provider.spec.ts')},
 @{Id='TC07';Name='Ticket Escalation';Paths=@('common/workflow/ticket-workflow-policy.service.spec.ts')},
 @{Id='TC08';Name='Notifications';Paths=@('modules/notifications/in-app-notification.service.spec.ts','modules/notifications/notification.service.spec.ts')}
)
$summary=@()
Push-Location 'D:/MeroTelecom/apps/api'
try {
 foreach ($case in $cases) {
  $paths=$case.Paths | ForEach-Object {'src/'+$_}
  $jsonFile=Join-Path $evidenceDir ($case.Id+'-jest.json')
  $logFile=Join-Path $evidenceDir ($case.Id+'-console.txt')
  $jestArgs=@('--runInBand','--verbose','--no-colors','--json',('--outputFile='+$jsonFile),'--runTestsByPath')+$paths
  $started=[DateTime]::UtcNow.ToString('o')
  $timer=[Diagnostics.Stopwatch]::StartNew()
  $testOutput=& './node_modules/.bin/jest.cmd' @jestArgs 2>&1
  $exitCode=$LASTEXITCODE
  $timer.Stop()
  $lines=@(('Case: '+$case.Id+' - '+$case.Name),'Evidence: executed existing Jest unit/service tests with mocked dependencies.','Full browser acceptance: blocked by Docker/WSL ERROR_NO_SYSTEM_RESOURCES.',('Started (UTC): '+$started),('Command: jest '+($jestArgs -join ' ')),'')
  $lines += $testOutput | ForEach-Object {$_.ToString()}
  $lines += @('',('Exit code: '+$exitCode))
  $lines | Set-Content -LiteralPath $logFile -Encoding utf8
  $result=if(Test-Path -LiteralPath $jsonFile){Get-Content -LiteralPath $jsonFile -Raw | ConvertFrom-Json}else{$null}
  $entry=[ordered]@{id=$case.Id;name=$case.Name;startedUtc=$started;durationSeconds=[math]::Round($timer.Elapsed.TotalSeconds,2);exitCode=$exitCode;passed=$result.numPassedTests;failed=$result.numFailedTests;pending=$result.numPendingTests;suites=$result.numTotalTestSuites;browserAcceptance='BLOCKED';evidenceScope='Unit/service tests with mocked dependencies; no database-backed browser workflow verified';paths=$paths}
  $summary += $entry
  ConvertTo-Json -InputObject @($summary) -Depth 8 | Set-Content -LiteralPath (Join-Path $evidenceDir 'focused-test-results.json') -Encoding utf8
  Write-Output ($case.Id+': '+$entry.passed+' passed, '+$entry.failed+' failed, exit '+$exitCode)
 }
}finally{Pop-Location}
