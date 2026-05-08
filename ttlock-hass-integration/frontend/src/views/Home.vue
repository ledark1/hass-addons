<template>
  <div>
    <!-- Page header -->
    <div class="d-flex flex-wrap align-end justify-space-between mb-6 ga-3">
      <div>
        <h1 class="text-h5 font-weight-bold mb-1">{{ $t('dashboard.title') }}</h1>
        <div class="text-body-2 text-medium-emphasis">{{ $t('dashboard.subtitle') }}</div>
      </div>
      <!-- <v-btn
        v-if="locks.length > 0"
        color="primary"
        variant="flat"
        prepend-icon="mdi-bluetooth-connect"
        :loading="isScanning"
        @click="startScan"
      >
        {{ $t('app.startScan') }}
      </v-btn> -->
    </div>

    <!-- KPI cards -->
    <v-row class="mb-2">
      <v-col cols="6" md="3">
        <v-card class="kpi-card pa-4">
          <div class="d-flex align-center justify-space-between mb-2">
            <span class="text-caption text-medium-emphasis text-uppercase font-weight-medium">
              {{ $t('dashboard.totalLocks') }}
            </span>
            <v-avatar size="32" color="primary" variant="tonal">
              <v-icon size="18">mdi-lock-outline</v-icon>
            </v-avatar>
          </div>
          <div class="text-h4 font-weight-bold">{{ totalLocks }}</div>
        </v-card>
      </v-col>

      <v-col cols="6" md="3">
        <v-card class="kpi-card pa-4">
          <div class="d-flex align-center justify-space-between mb-2">
            <span class="text-caption text-medium-emphasis text-uppercase font-weight-medium">
              {{ $t('dashboard.connected') }}
            </span>
            <v-avatar size="32" color="success" variant="tonal">
              <v-icon size="18">mdi-bluetooth-connect</v-icon>
            </v-avatar>
          </div>
          <div class="text-h4 font-weight-bold">
            {{ connectedLocks }}
            <span class="text-body-2 text-medium-emphasis font-weight-regular">/ {{ totalLocks }}</span>
          </div>
        </v-card>
      </v-col>

      <v-col cols="6" md="3">
        <v-card class="kpi-card pa-4">
          <div class="d-flex align-center justify-space-between mb-2">
            <span class="text-caption text-medium-emphasis text-uppercase font-weight-medium">
              {{ $t('dashboard.lowBattery') }}
            </span>
            <v-avatar size="32" :color="lowBattery > 0 ? 'warning' : 'secondary'" variant="tonal">
              <v-icon size="18">mdi-battery-alert-variant-outline</v-icon>
            </v-avatar>
          </div>
          <div class="text-h4 font-weight-bold">{{ lowBattery }}</div>
        </v-card>
      </v-col>

      <v-col cols="6" md="3">
        <v-card class="kpi-card pa-4">
          <div class="d-flex align-center justify-space-between mb-2">
            <span class="text-caption text-medium-emphasis text-uppercase font-weight-medium">
              {{ $t('dashboard.lastAction') }}
            </span>
            <v-avatar size="32" color="info" variant="tonal">
              <v-icon size="18">mdi-clock-time-four-outline</v-icon>
            </v-avatar>
          </div>
          <div class="text-h6 font-weight-bold text-truncate" :title="lastActionFull">
            {{ lastActionShort }}
          </div>
        </v-card>
      </v-col>
    </v-row>

    <!-- Empty state -->
    <v-card v-if="totalLocks === 0" class="pa-8 text-center mt-4">
      <v-avatar size="64" color="primary" variant="tonal" class="mb-4">
        <v-icon size="32">mdi-lock-plus-outline</v-icon>
      </v-avatar>
      <h2 class="text-h6 font-weight-bold mb-2">{{ $t('dashboard.empty.title') }}</h2>
      <p class="text-body-2 text-medium-emphasis mb-6 mx-auto" style="max-width: 420px;">
        {{ $t('dashboard.empty.subtitle') }}
      </p>
      <v-btn
        color="primary"
        variant="flat"
        prepend-icon="mdi-bluetooth-connect"
        :loading="isScanning"
        @click="startScan"
      >
        {{ $t('dashboard.empty.cta') }}
      </v-btn>
    </v-card>

    <!-- Locks grid -->
    <div v-else class="mt-6">
      <div class="d-flex align-end justify-space-between mb-4">
        <div>
          <h2 class="text-subtitle-1 font-weight-bold">{{ $t('dashboard.yourLocks') }}</h2>
          <div class="text-caption text-medium-emphasis">{{ $t('dashboard.yourLocksHint') }}</div>
        </div>
      </div>

      <v-row>
        <v-col v-for="lock in locks" :key="lock.address" cols="12" sm="6" lg="4" xl="3">
          <Lock :lock="lock" />
        </v-col>
      </v-row>
    </div>
  </div>
</template>

<script>
import moment from "moment"
import Lock from "@/components/Lock.vue"

export default {
  name: "Home",
  components: { Lock },
  computed: {
    locks() {
      return this.$store.state.locks
    },
    isScanning() {
      return this.$store.state.scanStatus == 1
    },
    totalLocks() {
      return this.locks.length
    },
    connectedLocks() {
      return this.locks.filter(l => l.connected).length
    },
    lowBattery() {
      return this.locks.filter(l => typeof l.battery === 'number' && l.battery > 0 && l.battery < 20).length
    },
    lastActionDate() {
      const all = []
      const ops = this.$store.state.operations
      for (const addr in ops) {
        for (const op of ops[addr] || []) {
          if (op.operateDate) all.push(op.operateDate)
        }
      }
      if (all.length === 0) return null
      return all.sort().reverse()[0]
    },
    lastActionShort() {
      if (!this.lastActionDate) return '—'
      const m = moment(this.lastActionDate, "YYYYMMDDHHmmss")
      return m.isValid() ? m.fromNow() : '—'
    },
    lastActionFull() {
      if (!this.lastActionDate) return ''
      const m = moment(this.lastActionDate, "YYYYMMDDHHmmss")
      return m.isValid() ? m.format("DD-MM-YYYY HH:mm:ss") : ''
    },
  },
  methods: {
    startScan() {
      this.$store.dispatch("scan")
    },
  },
}
</script>

<style scoped>
.kpi-card {
  height: 100%;
  transition: border-color 0.2s ease, transform 0.2s ease;
}
.kpi-card:hover {
  border-color: rgb(var(--v-theme-primary));
}
</style>
