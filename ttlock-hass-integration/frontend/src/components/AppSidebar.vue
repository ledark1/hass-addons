<template>
  <v-navigation-drawer
    v-model="drawerOpen"
    :rail="rail && !mobile"
    :permanent="!mobile"
    :temporary="mobile"
    :width="260"
    color="surface"
    class="app-sidebar"
    border="end"
  >
    <div class="d-flex align-center px-4 py-4" style="height: 64px;">
      <v-avatar size="32" color="primary" class="flex-shrink-0">
        <v-icon color="white" size="20">mdi-lock-smart</v-icon>
      </v-avatar>
      <div v-if="!rail || mobile" class="ml-3 overflow-hidden">
        <div class="text-body-2 font-weight-bold text-truncate">TTLock</div>
        <div class="text-caption text-medium-emphasis text-truncate">v{{ version }}</div>
      </div>
    </div>

    <v-divider />

    <v-list nav density="comfortable" class="px-2 py-2">
      <v-list-item
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        :prepend-icon="item.icon"
        :title="$t(item.label)"
        :active="isActive(item)"
        rounded="lg"
        color="primary"
        class="mb-1"
      />
    </v-list>

    <template #append>
      <v-divider />
      <v-list nav density="comfortable" class="px-2 py-2">
        <v-list-item
          rounded="lg"
          :prepend-icon="isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
          :title="isDark ? $t('theme.light') : $t('theme.dark')"
          @click="toggleTheme"
        />
      </v-list>
    </template>
  </v-navigation-drawer>
</template>

<script>
import { useDisplay } from 'vuetify'
import { useTheme } from '@/composables/useTheme'

export default {
  name: 'AppSidebar',
  props: {
    modelValue: { type: Boolean, default: true },
  },
  emits: ['update:modelValue'],
  setup() {
    const display = useDisplay()
    const { isDark, toggleTheme } = useTheme()
    return { display, isDark, toggleTheme }
  },
  data() {
    return {
      navItems: [
        { to: '/', icon: 'mdi-view-dashboard-outline', label: 'nav.dashboard', match: ['Home'] },
        { to: '/credentials', icon: 'mdi-key-chain-variant', label: 'nav.credentials', match: ['CredentialsAll', 'Credentials'] },
        { to: '/operations', icon: 'mdi-history', label: 'nav.operations', match: ['OperationsAll', 'Operations'] },
      ],
    }
  },
  computed: {
    drawerOpen: {
      get() { return this.modelValue },
      set(v) { this.$emit('update:modelValue', v) },
    },
    mobile() {
      return this.display.smAndDown.value
    },
    rail() {
      return this.display.mdAndDown.value && !this.display.smAndDown.value
    },
    version() {
      return import.meta.env.VITE_APP_VERSION || '2.1.0'
    },
  },
  methods: {
    isActive(item) {
      if (item.match?.includes(this.$route.name)) return true
      return this.$route.path === item.to
    },
  },
}
</script>

<style scoped>
.app-sidebar :deep(.v-list-item--active) {
  background: rgb(var(--v-theme-primary), 0.08);
}
</style>
