<template>
  <v-app>
    <AppTopBar
      @edit-config="editConfig"
      @start-scan="startScan"
      @refresh-credentials="refreshCredentials"
    />

    <v-main class="bg-background">
      <div class="page-container">

        <v-breadcrumbs
          v-if="showBreadcrumbs"
          :items="breadcrumbs"
          density="compact"
          class="pa-0 mb-4"
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
  computed: {
    showBreadcrumbs() {
      return [
        'Settings', 'SettingsAll',
        'Credentials', 'CredentialsAll',
        'Operations', 'OperationsAll',
      ].includes(this.$route.name)
    },
    activeLockName() {
      const addr = this.$route.params.address
      if (!addr) return null
      const lock = this.$store.state.locks.find(l => l.address === addr)
      return lock?.name || addr
    },
    breadcrumbs() {
      const name = this.$route.name
      const extras = {
        SettingsAll:    [{ title: this.$t('breadcrumb.settings'),    disabled: true }],
        Settings:       [{ title: this.$t('breadcrumb.settings'),    to: '/settings',    disabled: false },
                         { title: this.activeLockName,               disabled: true }],
        OperationsAll:  [{ title: this.$t('breadcrumb.operations'),  disabled: true }],
        Operations:     [{ title: this.$t('breadcrumb.operations'),  to: '/operations',  disabled: false },
                         { title: this.activeLockName,               disabled: true }],
        CredentialsAll: [{ title: this.$t('breadcrumb.credentials'), disabled: true }],
        Credentials:    [{ title: this.$t('breadcrumb.credentials'), to: '/credentials', disabled: false },
                         { title: this.activeLockName,               disabled: true }],
      }
      return [
        { title: this.$t('breadcrumb.home'), to: '/', disabled: false },
        ...(extras[name] ?? []),
      ]
    },
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
