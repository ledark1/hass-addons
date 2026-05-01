# ── Local development launcher ────────────────────────────────────────────────
# Copy this file and rename it start-dev.local.ps1 (gitignored) to set your own values.
# Run with: .\start-dev.ps1  (from the addon/ directory)

$env:DATA_PATH = "$PSScriptRoot\dev-data"   # local folder instead of /data

# MQTT — comment out if you don't have a local broker
# $env:MQTT_HOST  = "192.168.1.x"
# $env:MQTT_PORT  = "1883"
# $env:MQTT_SSL   = "false"
# $env:MQTT_USER  = "user"
# $env:MQTT_PASS  = "password"

# Noble BLE gateway — leave as "none" to use the local BLE adapter directly
$env:GATEWAY = "none"

# Dev mode — enables stub locks & credentials in WsApi.js
# $env:DEV_MODE   = "1"

# Create the local data folder if it doesn't exist
if (-not (Test-Path $env:DATA_PATH)) {
    New-Item -ItemType Directory -Path $env:DATA_PATH | Out-Null
    Write-Host "Created dev data folder: $env:DATA_PATH"
}

Write-Host "Starting TTLock addon (dev mode)..."
node "$PSScriptRoot\index.js"
