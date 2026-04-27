<div align="center">

<img src="https://raw.githubusercontent.com/domodom30/hass-addons/master/ttlock-hass-integration/logo.png" alt="TTLock" width="100" />

# TTLock — Home Assistant Add-on

**Integrate your TTLock smart locks directly into Home Assistant — no cloud required.**

[![Version](https://img.shields.io/badge/version-1.4.1-blue?style=flat-square)](https://github.com/domodom30/hass-addons/blob/master/ttlock-hass-integration/CHANGELOG.md)
[![HA](https://img.shields.io/badge/Home%20Assistant-compatible-41BDF5?style=flat-square&logo=homeassistant)](https://www.home-assistant.io/)
[![BLE](https://img.shields.io/badge/Bluetooth-BLE-0082FC?style=flat-square&logo=bluetooth)](https://github.com/abandonware/noble)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE.md)

> ⚠️ **Work in progress** — Feedback and bug reports welcome: [open an issue](https://github.com/domodom30/hass-addons/issues)

</div>

---

## 📋 Requirements

| Component | Details |
|---|---|
| **Bluetooth** | Adapter compatible with [`@abandonware/noble`](https://github.com/abandonware/noble) or a remote Noble BLE gateway |
| **MQTT** | Optional broker — recommended for Home Assistant automations |

---

## ✨ Features

### 🔒 Lock Control
- Pair / unpair a lock
- Lock / unlock
- Real-time status (locked, unlocked, battery level, signal strength)

### 🗝️ Access Management
- PIN codes: add, edit, delete
- IC Cards: add, delete
- Fingerprints: add, delete

### ⚙️ Settings
- Auto-lock with configurable delay
- Confirmation beep (on/off)
- Clock synchronisation
- Device information (manufacturer, model, firmware)
- Operation log

### 🏠 Home Assistant Integration (via MQTT)
- Automatic discovery via MQTT Discovery
- `lock` entity with LOCK / UNLOCK commands
- Battery sensor (`%`)
- RSSI signal sensor (`dB`)

---

## 📸 Screenshots

<table>
  <tr>
    <td align="center"><strong>Lock list</strong></td>
    <td align="center"><strong>Credentials</strong></td>
  </tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/domodom30/hass-addons/master/ttlock-hass-integration/img/frontend1.png" alt="Lock list" width="360"/></td>
    <td><img src="https://raw.githubusercontent.com/domodom30/hass-addons/master/ttlock-hass-integration/img/frontend2.png" alt="Credentials" width="360"/></td>
  </tr>
  <tr>
    <td align="center"><strong>Add fingerprint</strong></td>
    <td align="center"><strong>Add Card</strong></td>
  </tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/domodom30/hass-addons/master/ttlock-hass-integration/img/frontend3.png" alt="Add fingerprint" width="360"/></td>
    <td><img src="https://raw.githubusercontent.com/domodom30/hass-addons/master/ttlock-hass-integration/img/frontend4.png" alt="HA device" width="360"/></td>
  </tr>
   <tr>
    <td align="center"><strong>Log Operations</strong></td>
    <td align="center"><strong>HA Mqtt</strong></td>
  </tr>
  <tr>
    <td><img src="https://raw.githubusercontent.com/domodom30/hass-addons/master/ttlock-hass-integration/img/frontend4.png" alt="Lock list" width="360"/></td>
    <td><img src="https://raw.githubusercontent.com/domodom30/hass-addons/master/ttlock-hass-integration/img/ha1.png" alt="Lock list" width="360"/></td>
  </tr>
</table>

---

## ⚙️ Configuration

```yaml
gateway: "none"         # "none" = local BLE, "noble" = remote Noble BLE gateway
gateway_host: ""        # Noble gateway hostname or IP (if gateway: noble)
gateway_port: 9000      # Gateway port
gateway_key: ""         # Gateway AES key
gateway_user: ""        # Gateway username
gateway_pass: ""        # Gateway password
```

> The MQTT broker is configured automatically if the **Mosquitto** add-on is installed in Home Assistant.

---

## 📡 ESP32 BLE Gateway

If your Home Assistant server doesn't have Bluetooth, or if your locks are out of range, you can use an **ESP32 as a remote BLE gateway**.

👉 **[esp32-ble-gateway](https://github.com/domodom30/esp32-ble-gateway)**

This gateway bridges WiFi and BLE using the Noble WebSocket protocol — fully compatible with this add-on.

### Gateway features

| Feature | Details |
|---|---|
| 🔧 **Stack** | NimBLE-Arduino 2.x + Vue 3 / Vite WebUI |
| 🌐 **Network** | DHCP or static IP, mDNS (`<name>.local`) |
| 🔑 **Auth** | AES-128-CBC key + configurable admin login/password |
| 🔒 **TLS** | HTTPS web interface (self-signed certificate) |
| 📦 **Hardware** | ESP32-WROVER board |

### Quick setup

1. Flash the filesystem then the firmware via PlatformIO
2. Connect to the `ESP32GW` WiFi AP (password: `87654321`)
3. Open `https://esp32gw.local`, configure your WiFi, AES key and admin credentials
4. Set the add-on configuration:

```yaml
gateway: "noble"
gateway_host: "IP_OR_HOSTNAME_OF_ESP32"
gateway_port: 8080
gateway_key: "AES_KEY_FROM_ESP_CONFIG"
gateway_user: "YOUR_ADMIN_LOGIN"
gateway_pass: "YOUR_ADMIN_PASSWORD"
```

---

## 🔗 Useful Links

- 📝 [Changelog](CHANGELOG.md)
- 📖 [Full Documentation](DOCS.md)
- 🐛 [Report a Bug](https://github.com/domodom30/hass-addons/issues)

---
