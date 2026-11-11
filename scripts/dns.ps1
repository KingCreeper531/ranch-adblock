# Switches this PC's DNS to AdGuard's ad-blocking DNS, or back to how it was.
# Runs elevated (the app asks Windows for admin rights once per switch).
#
#   dns.ps1 -Mode on     -StateFile <json> -ResultFile <json>   remember current DNS, switch to AdGuard
#   dns.ps1 -Mode off    -StateFile <json> -ResultFile <json>   put back exactly what was there before
#   dns.ps1 -Mode dryrun -StateFile <json> -ResultFile <json>   only report what "on" would change
param(
  [Parameter(Mandatory)] [ValidateSet('on', 'off', 'dryrun')] [string]$Mode,
  [Parameter(Mandatory)] [string]$StateFile,
  [Parameter(Mandatory)] [string]$ResultFile
)
$ErrorActionPreference = 'Stop'

$V4 = @('94.140.14.14', '94.140.15.15')
$V6 = @('2a10:50c0::ad1:ff', '2a10:50c0::ad2:ff')
$TEMPLATE = 'https://dns.adguard-dns.com/dns-query'
$TCPIP = 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces'
$TCPIP6 = 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters\Interfaces'
$DOHIF = 'HKLM:\SYSTEM\CurrentControlSet\Services\Dnscache\InterfaceSpecificParameters'

function Save-Result($obj) {
  New-Item -ItemType Directory -Force (Split-Path $ResultFile) | Out-Null
  [IO.File]::WriteAllText($ResultFile, ($obj | ConvertTo-Json -Depth 6))
}

# Wi-Fi and Ethernet adapters (not VPNs or virtual switches)
function Get-Adapters {
  Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne 'Not Present' }
}

# DNS servers typed in by hand ("" = automatic from the router)
function Get-Static($root, $guid) {
  try { return [string](Get-ItemProperty -Path "$root\$guid" -Name NameServer -ErrorAction Stop).NameServer } catch { return '' }
}

function Split-List([string]$s) { @($s -split '[,\s]+' | Where-Object { $_ }) }

function Set-DohFlags($guid, [bool]$on) {
  foreach ($pair in @(@('Doh', $V4), @('Doh6', $V6))) {
    foreach ($ip in $pair[1]) {
      $key = "$DOHIF\$guid\DohInterfaceSettings\$($pair[0])\$ip"
      if ($on) {
        New-Item -Path $key -Force | Out-Null
        New-ItemProperty -Path $key -Name DohFlags -PropertyType QWord -Value 1 -Force | Out-Null # automatic template
      } elseif (Test-Path $key) {
        Remove-Item -Path $key -Recurse -Force
      }
    }
  }
}

function Test-Resolve {
  try { Resolve-DnsName 'www.google.com' -Type A -DnsOnly -QuickTimeout -ErrorAction Stop | Out-Null; return $true } catch { return $false }
}

function Restore-From($state) {
  foreach ($a in $state.adapters) {
    $idx = (Get-NetAdapter -InterfaceDescription $a.description -ErrorAction SilentlyContinue | Select-Object -First 1).ifIndex
    if (-not $idx) { $idx = $a.ifIndex }
    try {
      Set-DnsClientServerAddress -InterfaceIndex $idx -ResetServerAddresses -ErrorAction Stop
      $saved = @(Split-List $a.v4) + @(Split-List $a.v6)
      if ($saved.Count) { Set-DnsClientServerAddress -InterfaceIndex $idx -ServerAddresses $saved -ErrorAction Stop }
    } catch { }
    try { Set-DohFlags $a.guid $false } catch { }
  }
}

try {
  if ($Mode -eq 'off') {
    if (-not (Test-Path $StateFile)) {
      # Nothing remembered (e.g. turned on by an older copy): fall back to automatic DNS on adapters using AdGuard
      foreach ($ad in Get-Adapters) {
        $cur = (Get-DnsClientServerAddress -InterfaceIndex $ad.ifIndex -ErrorAction SilentlyContinue).ServerAddresses
        if ($cur | Where-Object { $V4 -contains $_ -or $V6 -contains $_ }) {
          Set-DnsClientServerAddress -InterfaceIndex $ad.ifIndex -ResetServerAddresses
          Set-DohFlags $ad.InterfaceGuid $false
        }
      }
    } else {
      Restore-From (Get-Content $StateFile -Raw | ConvertFrom-Json)
      Remove-Item $StateFile -Force
    }
    Clear-DnsClientCache
    Save-Result @{ ok = $true; mode = 'off' }
    exit 0
  }

  $adapters = @(Get-Adapters)
  if (-not $adapters.Count) { throw 'No Wi-Fi or Ethernet adapter found.' }

  # Remember what was there before (only the first time, so "off" restores your own settings)
  $state = $null
  if (Test-Path $StateFile) { $state = Get-Content $StateFile -Raw | ConvertFrom-Json }
  if (-not $state) {
    $state = @{ savedAt = (Get-Date).ToString('o'); adapters = @($adapters | ForEach-Object {
      @{ name = $_.Name; description = $_.InterfaceDescription; ifIndex = $_.ifIndex; guid = $_.InterfaceGuid
         v4 = Get-Static $TCPIP $_.InterfaceGuid; v6 = Get-Static $TCPIP6 $_.InterfaceGuid }
    }) }
  }

  if ($Mode -eq 'dryrun') {
    Save-Result @{ ok = $true; mode = 'dryrun'; wouldSet = @($V4 + $V6); remembered = $state.adapters; doh = [bool](Get-Command Add-DnsClientDohServerAddress -ErrorAction SilentlyContinue) }
    exit 0
  }

  if (-not (Test-Path $StateFile)) {
    New-Item -ItemType Directory -Force (Split-Path $StateFile) | Out-Null
    [IO.File]::WriteAllText($StateFile, ($state | ConvertTo-Json -Depth 6))
  }

  # Encrypted DNS (Windows 11): tell Windows the AdGuard addresses speak DNS over HTTPS.
  # Plain DNS stays allowed as a fallback, so the internet keeps working either way.
  $doh = [bool](Get-Command Add-DnsClientDohServerAddress -ErrorAction SilentlyContinue)
  if ($doh) {
    foreach ($ip in $V4 + $V6) {
      if (-not (Get-DnsClientDohServerAddress -ServerAddress $ip -ErrorAction SilentlyContinue)) {
        Add-DnsClientDohServerAddress -ServerAddress $ip -DohTemplate $TEMPLATE -AllowFallbackToUdp $true -AutoUpgrade $true | Out-Null
      }
    }
  }
  foreach ($ad in $adapters) {
    Set-DnsClientServerAddress -InterfaceIndex $ad.ifIndex -ServerAddresses @($V4 + $V6)
    if ($doh) { try { Set-DohFlags $ad.InterfaceGuid $true } catch { } }
  }
  Clear-DnsClientCache

  # Safety check: if names stop resolving, put everything back
  Start-Sleep -Milliseconds 800
  $connected = @($adapters | Where-Object Status -eq 'Up').Count -gt 0
  if ($connected -and -not (Test-Resolve)) {
    Restore-From $state
    Remove-Item $StateFile -Force -ErrorAction SilentlyContinue
    Clear-DnsClientCache
    throw 'AdGuard DNS did not answer, so your previous DNS settings were put back.'
  }
  Save-Result @{ ok = $true; mode = 'on'; adapters = @($adapters | ForEach-Object Name); encrypted = $doh }
  exit 0
} catch {
  Save-Result @{ ok = $false; error = $_.Exception.Message }
  exit 1
}
