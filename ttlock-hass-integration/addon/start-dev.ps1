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

# Noble BLE gateway — set to "noble" to use a remote noble-websocket gateway
# Leave as "none" to use the local BLE adapter directly
$env:GATEWAY      = "none"
# $env:GATEWAY      = "noble"
# $env:GATEWAY_HOST = "192.168.1.x"    # IP or hostname of the noble gateway
# $env:GATEWAY_PORT = "2846"            # WebSocket port (default 2846)
# $env:GATEWAY_KEY  = "your-aes-key"   # AES key configured in the gateway
# $env:GATEWAY_USER = "user"            # WebSocket auth username (if any)
# $env:GATEWAY_PASS = "password"        # WebSocket auth password (if any)

# Dev mode — enables stub locks & credentials in WsApi.js
# $env:DEV_MODE   = "1"

# Create the local data folder if it doesn't exist
if (-not (Test-Path $env:DATA_PATH)) {
    New-Item -ItemType Directory -Path $env:DATA_PATH | Out-Null
    Write-Host "Created dev data folder: $env:DATA_PATH"
}

Write-Host "Starting TTLock addon (dev mode)..."
node "$PSScriptRoot\index.js"
