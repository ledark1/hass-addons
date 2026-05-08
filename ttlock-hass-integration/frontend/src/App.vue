<template>
  <v-app>
    <v-app-bar color="primary" :elevation="2" density="compact">
      <v-app-bar-nav-icon @click="goHome">
        <v-icon>{{ isHome ? 'mdi-home-automation' : 'mdi-arrow-left' }}</v-icon>
      </v-app-bar-nav-icon>

      <v-app-bar-title>{{ $t('app.title') }}</v-app-bar-title>

      <template #append>
        <template v-if="isHome">
          <v-btn icon variant="text" color="white" :disabled="isScanning" :title="$t('app.editConfig')" @click="editConfig">
            <v-icon>mdi-tune</v-icon>
          </v-btn>
          <v-progress-circular v-if="isScanning" indeterminate color="white" size="22" width="2" class="mx-2" />
          <v-btn v-else icon variant="text" color="white" :title="$t('app.startScan')" @click="startScan">
            <v-icon>mdi-bluetooth-connect</v-icon>
          </v-btn>
        </template>
        <template v-else-if="isCredentials">
          <v-progress-circular v-if="isWaitingCredentials" indeterminate color="white" size="22" width="2" class="mx-2" />
          <v-btn v-else icon variant="text" color="white" :title="$t('app.refreshCredentials')" @click="refreshCredentials">
            <v-icon>mdi-refresh</v-icon>
          </v-btn>
        </template>
      </template>
    </v-app-bar>

    <v-main>
      <v-alert
        v-if="startupStatus !== 0"
        :type="startupStatus === 1 ? 'error' : 'info'"
        density="compact"
        rounded="0"
        class="mb-0"
      >
        <template #prepend>
          <v-progress-circular v-if="startupStatus !== 1" indeterminate size="18" width="2" class="mr-1" />
          <v-icon v-else icon="mdi-alert-circle" />
        </template>
        {{ startupStatusTxt }}
      </v-alert>

      <router-view />
      <ConfigDlg :show="showConfigDialog" v-on:cancel="hideConfigDialog" />
      <Errors />
      <Notices />
    </v-main>
  </v-app>
</template>

<script>
import ConfigDlg from "@/components/ConfigDlg"
import Errors from "@/components/Errors"
import Notices from "@/components/Notices"

export default {
  components: { ConfigDlg, Errors, Notices },
  data() {
    return {
      showConfigDialog: false
    }
  },
  computed: {
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
    isHome() {
      return this.$route.name === "Home"
    },
    isCredentials() {
      return this.$route.name === "Credentials"
    },
    isScanning() {
      return this.$store.state.scanStatus == 1
    },
    isWaitingCredentials() {
      return this.$store.state.waitingCredentials
    },
  },
  methods: {
    goHome() {
      if (!this.isHome) {
        this.$router.push({ name: "Home" })
      }
    },
    startScan() {
      this.$store.dispatch("scan")
    },
    refreshCredentials() {
      const address = this.$store.state.activeLockAddress
      if (address !== "") {
        this.$store.dispatch("readCredentials", address)
      }
    },
    editConfig() {
      this.showConfigDialog = true
    },
    hideConfigDialog() {
      this.showConfigDialog = false
    },
  },
}
</script>

<style>
@import url("https://fonts.googleapis.com/css?family=Roboto:300,400,500,700&display=swap");
</style>
