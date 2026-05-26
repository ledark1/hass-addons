<template>
  <div v-if="lock.address">

    <div class="d-flex flex-wrap align-center justify-space-between mb-6 ga-3">
      <div class="d-flex align-center ga-3">
        <v-btn icon="mdi-arrow-left" variant="text" size="small" @click="cancel" />
        <div>
          <div class="d-flex align-center ga-2">
            <h1 class="text-h5 font-weight-bold mb-0">{{ lock.name }}</h1>
            <v-chip
              :color="lock.connected ? 'success' : 'secondary'"
              size="small"
              variant="tonal"
              :prepend-icon="lock.connected ? 'mdi-bluetooth-connect' : 'mdi-bluetooth-off'"
            >{{ lock.connected ? $t('lock.connected') : $t('lock.disconnected') }}</v-chip>
          </div>
          <div class="text-caption text-medium-emphasis font-mono">{{ lock.address }}</div>
        </div>
      </div>
    </div>

    <SettingsManager :address="address" @unpaired="onUnpaired" />
  </div>
</template>

<script>
import SettingsManager from "@/components/SettingsManager.vue"

export default {
  name: "Settings",
  components: { SettingsManager },
  data() {
    return {
      address: this.$route.params.address,
    }
  },
  computed: {
    lock() {
      return this.$store.state.locks.find(l => l.address == this.address) || {}
    },
  },
  created() {
    if (!this.lock.address) {
      this.$router.push({ name: "Home" })
    }
  },
  methods: {
    cancel() {
      this.$router.push({ name: "Home" })
    },
    onUnpaired() {
      this.$router.push({ name: "Home" })
    },
  },
}
</script>

<style scoped>
.font-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.72rem;
}
</style>
