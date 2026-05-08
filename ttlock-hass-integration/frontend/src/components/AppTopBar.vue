<template>
  <v-app-bar
    color="surface"
    flat
    density="default"
    border="b-thin"
    height="64"
  >
    <v-app-bar-nav-icon
      v-if="mobile"
      @click="$emit('toggle-drawer')"
    />

    <div class="d-flex align-center flex-grow-1 px-4" style="min-width: 0;">
      <v-breadcrumbs
        :items="breadcrumbs"
        density="compact"
        class="pa-0"
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
    </div>

    <template #append>
      <div class="d-flex align-center ga-1 pr-2">
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
  </v-app-bar>
</template>

<script>
import { useDisplay } from 'vuetify'

export default {
  name: 'AppTopBar',
  emits: ['toggle-drawer', 'edit-config', 'start-scan', 'refresh-credentials'],
  setup() {
    const display = useDisplay()
    return { display }
  },
  computed: {
    mobile() {
      return this.display.smAndDown.value
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
    isScanning() {
      return this.$store.state.scanStatus == 1
    },
    isCredentialsRoute() {
      return this.$route.name === 'Credentials'
    },
    isWaitingCredentials() {
      return this.$store.state.waitingCredentials
    },
    activeLockName() {
      const addr = this.$route.params.address
      if (!addr) return null
      const lock = this.$store.state.locks.find(l => l.address === addr)
      return lock?.name || addr
    },
    breadcrumbs() {
      const crumbs = [
        { title: this.$t('breadcrumb.home'), to: '/', disabled: this.$route.name === 'Home' },
      ]
      if (this.$route.name === 'Settings') {
        crumbs.push({ title: this.activeLockName, to: '/', disabled: false })
        crumbs.push({ title: this.$t('breadcrumb.settings'), disabled: true })
      } else if (this.$route.name === 'Operations') {
        crumbs.push({ title: this.$t('breadcrumb.operations'), to: '/operations', disabled: false })
        crumbs.push({ title: this.activeLockName, disabled: true })
      } else if (this.$route.name === 'Credentials') {
        crumbs.push({ title: this.$t('breadcrumb.credentials'), to: '/credentials', disabled: false })
        crumbs.push({ title: this.activeLockName, disabled: true })
      } else if (this.$route.name === 'CredentialsAll') {
        crumbs.push({ title: this.$t('breadcrumb.credentials'), disabled: true })
      } else if (this.$route.name === 'OperationsAll') {
        crumbs.push({ title: this.$t('breadcrumb.operations'), disabled: true })
      }
      return crumbs
    },
  },
}
</script>
