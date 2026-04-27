<template>
  <v-card :loading="busy" class="ma-2">
    <v-card-item>
      <v-card-title>{{ lock.name }}</v-card-title>
      <v-card-subtitle class="text-caption text-mono">{{ lock.address }}</v-card-subtitle>
      <template #append>
        <div class="d-flex align-center ga-1">
          <v-chip size="x-small" :color="batteryColor" variant="tonal">
            <v-icon start size="14" :icon="batteryIcon" />
            {{ lock.battery }}%
          </v-chip>
          <v-chip size="x-small" :color="rssiColor" variant="tonal">
            <v-icon start size="14" :icon="rssiIcon" />
            {{ lock.rssi }}dB
          </v-chip>
        </div>
      </template>
    </v-card-item>

    <v-divider />

    <v-card-text class="pa-4">
      <div class="text-center py-4">
        <v-icon :icon="stateIcon" :color="stateColor" size="80" />
        <div class="text-subtitle-1 font-weight-medium mt-2" :class="`text-${stateColor}`">
          {{ stateLabel }}
        </div>
      </div>

      <div class="px-2 mb-4">
        <v-btn
          v-if="canUnlock"
          block size="large" variant="elevated" color="success"
          prepend-icon="mdi-lock-open-variant"
          :loading="waiting" :disabled="waiting"
          @click="unlockLock"
        >{{ $t('lock.unlock') }}</v-btn>

        <v-btn
          v-else-if="canLock"
          block size="large" variant="elevated" color="primary"
          prepend-icon="mdi-lock"
          :loading="waiting" :disabled="waiting"
          @click="lockLock"
        >{{ $t('lock.lock') }}</v-btn>

        <v-btn
          v-else-if="canPair"
          block size="large" variant="elevated" color="secondary"
          prepend-icon="mdi-bluetooth-connect"
          :loading="busy" :disabled="busy"
          @click="pairLock"
        >{{ $t('lock.pair') }}</v-btn>

        <v-btn
          v-else
          block size="large" variant="tonal" color="grey"
          prepend-icon="mdi-lock-question"
          disabled
        >{{ stateLabel }}</v-btn>
      </div>

      <div v-if="!canPair" class="d-flex justify-center ga-2 flex-wrap">
        <v-chip
          v-if="lock.hasAutoLock && lock.autoLockTime >= 0"
          size="small" variant="outlined"
          prepend-icon="mdi-lock-clock"
        >
          {{ lock.autoLockTime > 0 ? lock.autoLockTime + 's' : $t('lock.autoLockOff') }}
        </v-chip>
        <v-chip
          v-if="lock.hasAudio"
          size="small" variant="outlined"
          :color="lock.audio ? undefined : 'grey'"
          :prepend-icon="lock.audio ? 'mdi-volume-high' : 'mdi-volume-off'"
        >
          {{ lock.audio ? $t('lock.soundOn') : $t('lock.soundOff') }}
        </v-chip>
      </div>
    </v-card-text>

    <template v-if="!canPair">
      <v-divider />
      <v-card-actions>
        <v-btn variant="text" prepend-icon="mdi-key-chain" size="small" @click="credentials">
          {{ $t('lock.credentials') }}
        </v-btn>
        <v-spacer />
        <v-menu>
          <template #activator="{ props }">
            <v-btn v-bind="props" icon="mdi-dots-vertical" variant="text" size="small" />
          </template>
          <v-list density="compact">
            <v-list-item prepend-icon="mdi-cog" @click="settings">
              {{ $t('lock.settings') }}
            </v-list-item>
            <v-list-item prepend-icon="mdi-history" :disabled="waiting" @click="operations">
              {{ $t('lock.operationLog') }}
            </v-list-item>
          </v-list>
        </v-menu>
      </v-card-actions>
    </template>
  </v-card>
</template>

<script>
export default {
  props: ["lock"],
  data() {
    return { busy: false }
  },
  computed: {
    canLock() {
      return this.lock.paired && this.lock.locked == 1
    },
    canUnlock() {
      return this.lock.paired && this.lock.locked == 0
    },
    canPair() {
      return !this.lock.paired
    },
    waiting() {
      return this.$store.state.waiting || this.$store.state.waitingCredentials || this.$store.state.scanStatus == 1
    },
    batteryIcon() {
      const b = this.lock.battery
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
    batteryColor() {
      const b = this.lock.battery
      if (b > 50) return 'success'
      if (b > 20) return 'warning'
      return 'error'
    },
    rssiIcon() {
      const r = this.lock.rssi
      if (r < -86) return 'mdi-signal-cellular-outline'
      if (r < -80) return 'mdi-signal-cellular-1'
      if (r < -70) return 'mdi-signal-cellular-2'
      return 'mdi-signal-cellular-3'
    },
    rssiColor() {
      const r = this.lock.rssi
      if (r < -86) return 'error'
      if (r < -80) return 'warning'
      return 'success'
    },
    stateIcon() {
      if (this.lock.locked === 0) return 'mdi-lock'
      if (this.lock.locked === 1) return 'mdi-lock-open-variant'
      return 'mdi-lock-question'
    },
    stateColor() {
      if (this.lock.locked === 0) return 'error'
      if (this.lock.locked === 1) return 'success'
      return 'grey'
    },
    stateLabel() {
      if (this.lock.locked === 0) return this.$t('lock.locked')
      if (this.lock.locked === 1) return this.$t('lock.unlocked')
      return this.$t('lock.unknown')
    },
  },
  methods: {
    async unlockLock() {
      if (this.busy) return
      this.busy = true
      try {
        await this.$store.dispatch("unlock", this.lock.address)
      } catch (error) {
        console.error(error)
      }
    },
    async lockLock() {
      if (this.busy) return
      this.busy = true
      try {
        await this.$store.dispatch("lock", this.lock.address)
      } catch (error) {
        console.error(error)
      }
    },
    async pairLock() {
      if (this.busy) return
      this.busy = true
      try {
        await this.$store.dispatch("pair", this.lock.address)
      } catch (error) {
        console.error(error)
      }
    },
    credentials() {
      this.$router.push({ name: "Credentials", params: { address: this.lock.address } })
    },
    settings() {
      this.$router.push({ name: "Settings", params: { address: this.lock.address } })
    },
    operations() {
      this.$router.push({ name: "Operations", params: { address: this.lock.address } })
    },
  },
  watch: {
    waiting(newVal) {
      if (!newVal) this.busy = false
    },
  },
}
</script>
