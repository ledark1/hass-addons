<template>
  <div v-if="lock.name">
    <!-- Page header -->
    <div class="d-flex flex-wrap align-center justify-space-between mb-6 ga-3">
      <div class="d-flex align-center ga-3">
        <v-btn icon="mdi-arrow-left" variant="text" size="small" @click="$router.push({ name: 'Home' })" />
        <div>
          <h1 class="text-h5 font-weight-bold mb-0">{{ $t('lock.credentials') }}</h1>
          <div class="text-caption text-medium-emphasis">
            {{ lock.name }} · <span class="font-mono">{{ lock.address }}</span>
          </div>
        </div>
      </div>
    </div>

    <CredentialsManager :address="address" />
  </div>
</template>

<script>
import CredentialsManager from "@/components/CredentialsManager.vue"

export default {
  name: "Credentials",
  components: { CredentialsManager },
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
    if (!this.lock.name) {
      this.$router.push({ name: "Home" })
    }
  },
}
</script>

<style scoped>
.font-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
</style>
