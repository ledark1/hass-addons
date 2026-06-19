#!/usr/bin/env bashio

export MQTT_HOST=$(bashio::services mqtt "host")
export MQTT_PORT=$(bashio::services mqtt "port")
export MQTT_SSL=$(bashio::services mqtt "ssl")
export MQTT_USER=$(bashio::services mqtt "username")
export MQTT_PASS=$(bashio::services mqtt "password")
export MQTT_DISCOVERY_PREFIX=$(bashio::config "discovery_prefix")
export GATEWAY=$(bashio::config "gateway")
export GATEWAY_HOST=$(bashio::config "gateway_host")
export GATEWAY_PORT=$(bashio::config "gateway_port")
export GATEWAY_KEY=$(bashio::config "gateway_key")
export GATEWAY_USER=$(bashio::config "gateway_user")
export GATEWAY_PASS=$(bashio::config "gateway_pass")
if $(bashio::config.true "ignore_crc"); then
  echo "IGNORE CRC TRUE"
  export TTLOCK_IGNORE_CRC=1
fi
if $(bashio::config.equals "gateway" "noble"); then
  echo "Disable noble auto-binding"
  export NOBLE_WEBSOCKET=1
fi
if $(bashio::config.true "debug_communication"); then
  echo "Debug communication ON"
  export TTLOCK_DEBUG_COMM=1
fi
if $(bashio::config.true "debug_mqtt"); then
  echo "Debug MQTT"
  export MQTT_DEBUG=1
fi
if $(bashio::config.true "gateway_debug"); then
  echo "Debug gateway"
  export WEBSOCKET_DEBUG=1
fi

# --- Free the BLE adapter for noble (local adapter mode only) ---
# noble needs the HCI device DOWN to grab the exclusive HCI_CHANNEL_USER. On
# Home Assistant OS bluetoothd keeps hci0 UP/managed, so noble falls back to the
# shared RAW channel: passive scan works but "LE Create Connection" gets clobbered
# and every connect() times out. Powering the adapter off via BlueZ (host D-Bus)
# releases it so noble can take exclusive control and bring it up itself.
# Skipped in gateway mode (BLE runs on the remote ESP32, not the local adapter).
if [ "${GATEWAY}" != "noble" ]; then
  echo "Releasing local BLE adapter from BlueZ for noble exclusive access"
  rfkill unblock bluetooth 2>/dev/null || true
  bluetoothctl power off 2>/dev/null || true
  sleep 2
fi

cd /app
npm start