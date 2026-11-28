# Rede Wi-Fi propria da Nara (Hotspot movel do Windows) para o Atom S3R.
# Assim o Atom conversa direto com este PC, sem depender do roteador da operadora
# (que muitas vezes isola os aparelhos do Wi-Fi uns dos outros).
#   powershell -File nara-hotspot.ps1 -Action start -Ssid Nara-Atom -Pass senha123
#   powershell -File nara-hotspot.ps1 -Action status
#   powershell -File nara-hotspot.ps1 -Action stop
param(
  [ValidateSet('start', 'status', 'stop')][string]$Action = 'status',
  [string]$Ssid = '',
  [string]$Pass = ''
)
$ErrorActionPreference = 'Stop'
function Out-Json($o) { $o | ConvertTo-Json -Compress; exit 0 }
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $methods = [System.WindowsRuntimeSystemExtensions].GetMethods()
  $asTaskT = ($methods | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $asTaskA = ($methods | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
  function Wait-Op($op, $type) { $t = $asTaskT.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
  function Wait-Act($op) { $t = $asTaskA.Invoke($null, @($op)); $t.Wait(-1) | Out-Null }
  [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime] | Out-Null
  [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime] | Out-Null
  [Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime] | Out-Null

  $profile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
  if (-not $profile) { Out-Json @{ ok = $false; state = 'Off'; error = 'O PC esta sem internet/Wi-Fi conectado' } }
  $tm = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
  $state = [string]$tm.TetheringOperationalState

  if ($Action -eq 'status') {
    $cfg = $tm.GetCurrentAccessPointConfiguration()
    Out-Json @{ ok = $true; state = $state; ssid = $cfg.Ssid; clients = $tm.ClientCount }
  }
  if ($Action -eq 'stop') {
    if ($state -ne 'Off') { $r = Wait-Op ($tm.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult]) }
    Out-Json @{ ok = $true; state = 'Off' }
  }
  # start: confere nome/senha e liga
  $cfg = $tm.GetCurrentAccessPointConfiguration()
  if ($Ssid -and ($cfg.Ssid -ne $Ssid -or $cfg.Passphrase -ne $Pass)) {
    if ($state -ne 'Off') { Wait-Op ($tm.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult]) | Out-Null }
    $cfg.Ssid = $Ssid
    $cfg.Passphrase = $Pass
    Wait-Act ($tm.ConfigureAccessPointAsync($cfg))
    $state = 'Off'
  }
  if ($state -eq 'Off') {
    $r = Wait-Op ($tm.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
    if ([string]$r.Status -ne 'Success') { Out-Json @{ ok = $false; state = 'Off'; error = ('Windows recusou ligar o hotspot: ' + $r.Status + ' ' + $r.AdditionalErrorMessage) } }
  }
  Out-Json @{ ok = $true; state = [string]$tm.TetheringOperationalState; ssid = $tm.GetCurrentAccessPointConfiguration().Ssid; clients = $tm.ClientCount }
} catch {
  Out-Json @{ ok = $false; state = 'Off'; error = $_.Exception.Message }
}
