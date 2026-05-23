<template>
  <v-app>
    <AppTopBar
      @edit-config="editConfig"
      @start-scan="startScan"
      @refresh-credentials="refreshCredentials"
    />

    <v-main class="bg-background">
      <div class="page-container">
        <router-view />
      </div>

      <ConfigDlg :show="showConfigDialog" v-on:cancel="hideConfigDialog" />
      <Errors />
      <Notices />
    </v-main>
  </v-app>
</template>

<script>
import AppTopBar from "@/components/AppTopBar.vue"
import ConfigDlg from "@/components/ConfigDlg.vue"
import Errors from "@/components/Errors.vue"
import Notices from "@/components/Notices.vue"

export default {
  components: { AppTopBar, ConfigDlg, Errors, Notices },
  data() {
    return {
      showConfigDialog: false,
    }
  },
  methods: {
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
.page-container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 24px;
}

@media (max-width: 600px) {
  .page-container {
    padding: 16px;
  }
}

/* Soft scrollbar tuned for both themes */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: rgba(128, 128, 128, 0.25);
  border-radius: 8px;
}
::-webkit-scrollbar-thumb:hover { background: rgba(128, 128, 128, 0.45); }
</style>
