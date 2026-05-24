<template>
  <v-app-bar
    color="surface"
    flat
    density="default"
    border="b-thin"
    height="56"
  >
    <!-- GAUCHE : logo + titre -->
    <div class="d-flex align-center gap-2 px-3">
      <!-- Logo avec tooltip version -->
      <v-tooltip :text="`TTLock v${version}`" location="bottom">
        <template #activator="{ props }">
          <v-avatar v-bind="props" size="32" color="primary" style="cursor: default; flex-shrink: 0;">
            <v-icon color="white" size="20">mdi-lock-smart</v-icon>
          </v-avatar>
        </template>
      </v-tooltip>

      <!-- Titre app -->
      <span class="text-body-1 font-weight-bold ml-1">TTLock</span>
    </div>

    <v-spacer />

    <!-- DROITE : boutons d'action -->
    <template #append>
      <div class="d-flex align-center ga-1 pr-2">
        <!-- Indicateur de statut démarrage -->
        <v-tooltip v-if="startupStatus !== 0" :text="startupStatusTxt" location="bottom">
          <template #activator="{ props }">
            <v-chip
              v-bind="props"
              :color="startupStatus === 1 ? 'error' : 'warning'"
              variant="tonal"
              size="small"
              class="mr-1"
            >
              <v-progress-circular
                v-if="startupStatus !== 1"
                indeterminate
                size="14"
                width="2"
                class="mr-1"
              />
              <v-icon v-else start size="14">mdi-alert-circle</v-icon>
              {{ startupStatusShort }}
            </v-chip>
          </template>
        </v-tooltip>

        <!-- Menu statut gateway -->
        <v-menu v-if="showGatewayChip" location="bottom end">
          <template #activator="{ props: menuProps }">
            <v-tooltip :text="gatewayStatusTxt" location="bottom">
              <template #activator="{ props: tooltipProps }">
                <v-btn
                  v-bind="{ ...menuProps, ...tooltipProps }"
                  :icon="isRestartingGateway || isRebootingEsp32 ? null : gatewayIcon"
                  :loading="isRestartingGateway || isRebootingEsp32"
                  :color="gatewayChipColor"
                  variant="text"
                  size="small"
                />
              </template>
            </v-tooltip>
          </template>
          <v-list density="compact" min-width="220">
            <v-list-item
              :disabled="isRestartingGateway || isRebootingEsp32"
              @click="$store.dispatch('restartGateway')"
            >
              <template #prepend>
                <v-icon color="warning" size="18" class="mr-3">mdi-lan-pending</v-icon>
              </template>
              <template #title>
                <span class="text-caption">{{ $t('app.gateway.restart') }}</span>
              </template>
            </v-list-item>
            <v-list-item
              :disabled="isRestartingGateway || isRebootingEsp32"
              @click="$store.dispatch('rebootEsp32')"
            >
              <template #prepend>
                <v-icon color="error" size="18" class="mr-3">mdi-restart</v-icon>
              </template>
              <template #title>
                <span class="text-caption">{{ $t('app.gateway.rebootEsp32') }}</span>
              </template>
            </v-list-item>
            <v-divider class="my-1" />
            <v-list-item
              v-if="gatewayWebUrl"
              :href="gatewayWebUrl"
              target="_blank"
              rel="noopener noreferrer"
            >
              <template #prepend>
                <v-icon color="primary" size="18" class="mr-3">mdi-open-in-new</v-icon>
              </template>
              <template #title>
                <span class="text-caption">{{ $t('app.gateway.openWeb') }}</span>
              </template>
            </v-list-item>
          </v-list>
        </v-menu>

        <!-- Toggle thème -->
        <v-tooltip :text="$t('theme.toggle')" location="bottom">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              :icon="isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
              variant="text"
              size="small"
              @click="toggleTheme"
            />
          </template>
        </v-tooltip>

        <!-- Modifier la configuration -->
        <v-tooltip :text="$t('app.editConfig')" location="bottom">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon="mdi-tune-variant"
              variant="text"
              size="small"
              :disabled="isScanning"
              @click="$emit('edit-config')"
            />
          </template>
        </v-tooltip>

        <!-- Rafraîchir les credentials (uniquement sur la route Credentials) -->
        <v-tooltip v-if="isCredentialsRoute" :text="$t('app.refreshCredentials')" location="bottom">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              :icon="isWaitingCredentials ? null : 'mdi-refresh'"
              :loading="isWaitingCredentials"
              variant="text"
              size="small"
              @click="$emit('refresh-credentials')"
            />
          </template>
        </v-tooltip>

        <!-- Lancer un scan BLE -->
        <v-tooltip :text="$t('app.startScan')" location="bottom">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              :icon="isScanning ? null : 'mdi-bluetooth-connect'"
              :loading="isScanning"
              variant="tonal"
              color="primary"
              size="small"
              @click="$emit('start-scan')"
            />
          </template>
        </v-tooltip>
      </div>
    </template>

    <!-- EXTENSION : breadcrumbs sur les routes détail uniquement -->
    <template v-if="showBreadcrumbs" #extension>
      <v-breadcrumbs
        :items="breadcrumbs"
        density="compact"
        class="pa-0 px-4 pb-1"
      >
        <template #divider>
          <v-icon icon="mdi-chevron-right" size="16" class="text-medium-emphasis" />
        </template>
        <template #item="{ item }">
          <v-breadcrumbs-item
            :to="item.to"
            :disabled="item.disabled"
            class="text-body-2"
            :class="item.disabled ? 'text-high-emphasis font-weight-medium' : 'text-medium-emphasis'"
          >
            {{ item.title }}
          </v-breadcrumbs-item>
        </template>
      </v-breadcrumbs>
    </template>
  </v-app-bar>
</template>

<script>
import { useTheme } from '@/composables/useTheme'

export default {
  name: 'AppTopBar',
  emits: ['edit-config', 'start-scan', 'refresh-credentials'],
  setup() {
    const { isDark, toggleTheme } = useTheme()
    return { isDark, toggleTheme }
  },
  computed: {
    version() {
      return import.meta.env.VITE_APP_VERSION || '2.1.0'
    },
    // N'affiche les breadcrumbs que sur les routes détail (avec :address)
    showBreadcrumbs() {
      return ['Settings', 'Credentials', 'Operations'].includes(this.$route.name)
    },
    startupStatus() {
      return this.$store.state.startupStatus
    },
    startupStatusTxt() {
      switch (this.startupStatus) {
        case 0: return this.$t('app.status.ok')
        case 1: return this.$t('app.status.error')
        default: return this.$t('app.status.starting')
      }
    },
    startupStatusShort() {
      return this.startupStatus === 1 ? '!' : '...'
    },
    gatewayStatus() {
      return this.$store.state.gatewayStatus
    },
    gatewayHost() {
      return this.$store.state.gatewayHost
    },
    gatewayWebUrl() {
      const ip = this.gatewayHost.split(':')[0]
      return ip ? `https://${ip}` : null
    },
    showGatewayChip() {
      return this.gatewayStatus !== 'n/a' && this.gatewayStatus !== ''
    },
    gatewayChipColor() {
      switch (this.gatewayStatus) {
        case 'connected': return 'success'
        case 'disconnected': return 'error'
        default: return 'warning'
      }
    },
    gatewayIcon() {
      switch (this.gatewayStatus) {
        case 'connected': return 'mdi-lan-connect'
        case 'disconnected': return 'mdi-lan-disconnect'
        default: return 'mdi-help-network'
      }
    },
    gatewayStatusTxt() {
      switch (this.gatewayStatus) {
        case 'connected': return this.$t('app.gateway.connected', { host: this.gatewayHost })
        case 'connecting': return this.$t('app.gateway.connecting')
        case 'disconnected': return this.$t('app.gateway.disconnected')
        case 'unknown': return this.$t('app.gateway.unknown')
        default: return ''
      }
    },
    isScanning() {
      return this.$store.state.scanStatus == 1
    },
    isCredentialsRoute() {
      return this.$route.name === 'Credentials'
    },
    isWaitingCredentials() {
      return this.$store.state.waitingCredentials
    },
    isRestartingGateway() {
      return this.$store.state.waitingGatewayRestart
    },
    isRebootingEsp32() {
      return this.$store.state.waitingEsp32Reboot
    },
    activeLockName() {
      const addr = this.$route.params.address
      if (!addr) return null
      const lock = this.$store.state.locks.find(l => l.address === addr)
      return lock?.name || addr
    },
    breadcrumbs() {
      const crumbs = [
        { title: this.$t('breadcrumb.home'), to: '/', disabled: false },
      ]
      if (this.$route.name === 'Settings') {
        crumbs.push({ title: this.$t('breadcrumb.settings'), to: '/settings', disabled: false })
        crumbs.push({ title: this.activeLockName, disabled: true })
      } else if (this.$route.name === 'Operations') {
        crumbs.push({ title: this.$t('breadcrumb.operations'), to: '/operations', disabled: false })
        crumbs.push({ title: this.activeLockName, disabled: true })
      } else if (this.$route.name === 'Credentials') {
        crumbs.push({ title: this.$t('breadcrumb.credentials'), to: '/credentials', disabled: false })
        crumbs.push({ title: this.activeLockName, disabled: true })
      }
      return crumbs
    },
  },
}
</script>
