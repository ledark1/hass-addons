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

# --- Free the BLE adapter so noble can grab the exclusive HCI_CHANNEL_USER ---
# On Home Assistant OS bluetoothd keeps hci0 UP/managed, forcing noble onto the
# shared RAW channel where passive scan works but "LE Create Connection" gets
# clobbered (every connect() times out). Powering the adapter off via BlueZ frees
# it; noble then opens it on its OWN exclusive HCI user channel and brings it back
# up itself — which requires the NET_ADMIN capability (see config.json privileged).
# Skipped in gateway mode (BLE runs on the remote ESP32, not the local adapter).
if [ "${GATEWAY}" != "noble" ]; then
  echo "Releasing local BLE adapter from BlueZ for noble exclusive access"
  rfkill unblock bluetooth 2>/dev/null || true
  # Only power down when BlueZ actually has the adapter UP. On an add-on restart
  # the previous noble session may have left it down/mid-transition; powering it
  # off again then races bluetoothd re-powering it and leaves noble unable to
  # acquire the exclusive HCI_CHANNEL_USER ("BLE adapter not ready"). Skip the
  # toggle if it's already off, and give BlueZ time to fully settle if we do it.
  if bluetoothctl show 2>/dev/null | grep -q "Powered: yes"; then
    bluetoothctl power off 2>/dev/null || true
    sleep 4
  else
    echo "Adapter already powered down — leaving it for noble"
    sleep 1
  fi
fi

cd /app
npm start