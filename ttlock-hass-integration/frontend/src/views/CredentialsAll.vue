<template>
  <div>
    <!-- Page header -->
    <div class="d-flex flex-wrap align-end justify-space-between mb-6 ga-3">
      <div>
        <h1 class="text-h5 font-weight-bold mb-1">{{ $t('credentials.allTitle') }}</h1>
        <div class="text-body-2 text-medium-emphasis">{{ $t('credentials.allSubtitle') }}</div>
      </div>
    </div>

    <!-- Empty state -->
    <v-card v-if="pairedLocks.length === 0" class="pa-8 text-center">
      <v-avatar size="64" color="primary" variant="tonal" class="mb-4">
        <v-icon size="32">mdi-key-chain-variant</v-icon>
      </v-avatar>
      <h2 class="text-h6 font-weight-bold mb-2">{{ $t('credentials.noLockPaired') }}</h2>
      <p class="text-body-2 text-medium-emphasis mx-auto" style="max-width: 420px;">
        {{ $t('dashboard.empty.subtitle') }}
      </p>
    </v-card>

    <template v-else>
      <!-- Lock selector -->
      <v-card class="pa-4 mb-4">
        <div class="d-flex align-center flex-wrap ga-3">
          <v-icon icon="mdi-lock-outline" class="text-medium-emphasis" />
          <span class="text-body-2 font-weight-medium">{{ $t('credentials.selectLock') }}</span>
          <v-spacer />
          <v-select
            v-model="selectedAddress"
            :items="lockSelectItems"
            item-title="title"
            item-value="value"
            density="comfortable"
            hide-details
            variant="outlined"
            style="max-width: 380px;"
          />
        </div>
      </v-card>

      <CredentialsManager v-if="selectedAddress" :address="selectedAddress" />
    </template>
  </div>
</template>

<script>
import CredentialsManager from "@/components/CredentialsManager.vue"

export default {
  name: "CredentialsAll",
  components: { CredentialsManager },
  data() {
    return {
      selectedAddress: null,
    }
  },
  computed: {
    pairedLocks() {
      return this.$store.state.locks.filter(l => l.paired)
    },
    lockSelectItems() {
      return this.pairedLocks.map(l => ({
        title: `${l.name} — ${l.address}`,
        value: l.address,
      }))
    },
  },
  created() {
    if (this.pairedLocks.length > 0) {
      this.selectedAddress = this.pairedLocks[0].address
    }
  },
  watch: {
    pairedLocks(newVal) {
      // If the previously selected lock disappeared (unpaired), pick the first available
      if (this.selectedAddress && !newVal.find(l => l.address === this.selectedAddress)) {
        this.selectedAddress = newVal[0]?.address || null
      } else if (!this.selectedAddress && newVal.length > 0) {
        this.selectedAddress = newVal[0].address
      }
    },
  },
}
</script>
