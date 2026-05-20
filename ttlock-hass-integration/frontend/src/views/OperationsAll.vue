<template>
  <div>
    <!-- Page header -->
    <div class="d-flex flex-wrap align-end justify-space-between mb-6 ga-3">
      <div>
        <h1 class="text-h5 font-weight-bold mb-1">{{ $t('operations.allTitle') }}</h1>
        <div class="text-body-2 text-medium-emphasis">{{ $t('operations.allSubtitle') }}</div>
      </div>
      <div class="d-flex align-center ga-2">
        <v-chip variant="tonal" color="secondary" size="small">
          {{ $t('operations.totalEntries', { count: filteredOperations.length }) }}
        </v-chip>
        <v-btn
          color="primary"
          variant="tonal"
          prepend-icon="mdi-refresh"
          size="small"
          :loading="waitingOperations"
          :disabled="pairedLocks.length === 0"
          @click="refreshAll"
        >{{ $t('operations.refreshAll') }}</v-btn>
      </div>
    </div>

    <!-- Empty state -->
    <v-card v-if="pairedLocks.length === 0" class="pa-8 text-center">
      <v-avatar size="64" color="primary" variant="tonal" class="mb-4">
        <v-icon size="32">mdi-history</v-icon>
      </v-avatar>
      <h2 class="text-h6 font-weight-bold mb-2">{{ $t('credentials.noLockPaired') }}</h2>
    </v-card>

    <template v-else>
      <!-- Filters -->
      <v-card class="pa-4 mb-4">
        <v-row dense align="center">
          <v-col cols="12" md="6">
            <div class="text-caption text-medium-emphasis mb-1">{{ $t('operations.filterByLock') }}</div>
            <v-select
              v-model="selectedLockAddresses"
              :items="lockSelectItems"
              item-title="title"
              item-value="value"
              multiple
              chips
              closable-chips
              density="comfortable"
              hide-details
              variant="outlined"
            />
          </v-col>
          <v-col cols="12" md="6">
            <div class="text-caption text-medium-emphasis mb-1">{{ $t('operations.filterByType') }}</div>
            <v-btn-toggle
              v-model="typeFilter"
              mandatory
              color="primary"
              density="comfortable"
              variant="outlined"
              divided
            >
              <v-btn value="all">{{ $t('operations.typeAll') }}</v-btn>
              <v-btn value="LOCK" prepend-icon="mdi-lock">{{ $t('operations.typeLock') }}</v-btn>
              <v-btn value="UNLOCK" prepend-icon="mdi-lock-open-variant">{{ $t('operations.typeUnlock') }}</v-btn>
            </v-btn-toggle>
          </v-col>
        </v-row>
      </v-card>

      <!-- Table -->
      <v-card>
        <v-data-table
          :headers="headers"
          :items="filteredOperations"
          :loading="waitingOperations"
          :items-per-page="50"
          :items-per-page-options="[10, 25, 50, 100, -1]"
          density="comfortable"
          hover
          :no-data-text="$t('operations.empty')"
          class="operations-table"
        >
          <template #item.recordTypeCategory="{ item }">
            <v-icon v-if="item.recordTypeCategory === 'LOCK'" color="error" size="20">mdi-lock</v-icon>
            <v-icon v-else-if="item.recordTypeCategory === 'UNLOCK'" color="success" size="20">mdi-lock-open-variant</v-icon>
            <v-icon v-else-if="item.recordTypeCategory === 'ALARM'" color="warning" size="20">mdi-shield-lock-open</v-icon>
          </template>
          <template #item.operateDate="{ item }">
            <span class="text-caption">{{ dateTime(item.operateDate) }}</span>
          </template>
          <template #item.lockName="{ item }">
            <div class="font-weight-medium">{{ item.lockName }}</div>
            <div class="text-caption text-medium-emphasis font-mono">{{ item.lockAddress }}</div>
          </template>
          <template #item.electricQuantity="{ item }">
            <v-chip size="x-small" :color="batteryColor(item.electricQuantity)" variant="tonal">
              <v-icon start size="12" :icon="batteryIcon(item.electricQuantity)" />
              {{ item.electricQuantity }}%
            </v-chip>
          </template>
          <template #item.password="{ item }">
            <span v-if="item.passwordName" class="font-weight-medium">{{ item.passwordName }}</span>
            <span v-if="item.password" class="text-caption text-medium-emphasis ml-1">({{ item.password }})</span>
          </template>
        </v-data-table>
      </v-card>
    </template>
  </div>
</template>

<script>
import moment from "moment"

export default {
  name: "OperationsAll",
  data() {
    return {
      selectedLockAddresses: [],
      typeFilter: 'all',
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
    waitingOperations() {
      return this.$store.state.waitingOperations
    },
    allOperations() {
      const ops = this.$store.state.operations
      const flat = []
      for (const addr in ops) {
        const lock = this.$store.state.locks.find(l => l.address === addr)
        const lockName = lock?.name || addr
        for (const op of ops[addr] || []) {
          flat.push({
            ...op,
            lockAddress: addr,
            lockName,
          })
        }
      }
      return flat.sort((a, b) => {
        if (a.operateDate > b.operateDate) return -1
        if (a.operateDate < b.operateDate) return 1
        if (a.recordNumber > b.recordNumber) return -1
        if (a.recordNumber < b.recordNumber) return 1
        return 0
      })
    },
    filteredOperations() {
      const set = new Set(this.selectedLockAddresses)
      return this.allOperations.filter(op => {
        if (set.size > 0 && !set.has(op.lockAddress)) return false
        if (this.typeFilter !== 'all' && op.recordTypeCategory !== this.typeFilter) return false
        return true
      })
    },
    headers() {
      return [
        { title: this.$t('operations.index'), key: "recordNumber", width: "60px" },
        { title: "", key: "recordTypeCategory", sortable: false, width: "40px" },
        { title: this.$t('operations.date'), key: "operateDate" },
        { title: this.$t('operations.lock'), key: "lockName", sortable: false },
        { title: this.$t('operations.battery'), key: "electricQuantity", sortable: false },
        { title: this.$t('operations.credential'), key: "password", sortable: false },
        { title: this.$t('operations.description'), key: "recordTypeName", sortable: false },
      ]
    },
  },
  created() {
    // Default: all paired locks selected
    this.selectedLockAddresses = this.pairedLocks.map(l => l.address)
    // Auto-load the activity log so the view is never empty without clicking
    // "Refresh all" — the backend serves the cached lockData.json entries
    // immediately (no BLE round-trip required).
    this.autoLoad(this.pairedLocks)
  },
  watch: {
    pairedLocks(newVal) {
      // Keep selectedLockAddresses in sync with available locks
      const available = new Set(newVal.map(l => l.address))
      this.selectedLockAddresses = this.selectedLockAddresses.filter(a => available.has(a))
      // If empty, fill with all available
      if (this.selectedLockAddresses.length === 0 && newVal.length > 0) {
        this.selectedLockAddresses = newVal.map(l => l.address)
      }
      // Locks can arrive after created() (WS status race / late BLE
      // discovery): load any that have no operations cached yet.
      this.autoLoad(newVal)
    },
  },
  methods: {
    autoLoad(locks) {
      for (const lock of locks) {
        if (!this.$store.state.operations[lock.address]) {
          this.$store.dispatch("readOperations", lock.address)
        }
      }
    },
    refreshAll() {
      // The BLE mutex on the backend serialises operations — dispatching them all
      // at once is safe; the store will set waitingOperations once and the spinner
      // will reflect that.
      for (const lock of this.pairedLocks) {
        this.$store.dispatch("readOperations", lock.address)
      }
    },
    dateTime(str) {
      return moment(str, "YYYYMMDDHHmmss").format("DD-MM-YYYY HH:mm:ss")
    },
    batteryIcon(b) {
      if (b > 90) return 'mdi-battery-bluetooth'
      if (b > 80) return 'mdi-battery-90-bluetooth'
      if (b > 70) return 'mdi-battery-80-bluetooth'
      if (b > 60) return 'mdi-battery-70-bluetooth'
      if (b > 50) return 'mdi-battery-60-bluetooth'
      if (b > 40) return 'mdi-battery-50-bluetooth'
      if (b > 30) return 'mdi-battery-40-bluetooth'
      if (b > 20) return 'mdi-battery-30-bluetooth'
      return 'mdi-battery-alert-bluetooth'
    },
    batteryColor(b) {
      if (b > 50) return 'success'
      if (b > 20) return 'warning'
      return 'error'
    },
  },
}
</script>

<style scoped>
.font-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.72rem;
}
.operations-table :deep(thead th) {
  font-weight: 600 !important;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 0.7rem !important;
  color: rgb(var(--v-theme-on-surface-variant)) !important;
}
</style>
