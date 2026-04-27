<template>
  <v-container v-if="lock.name" style="max-width: 600px">

    <!-- Header -->
    <v-card class="mb-4" rounded="lg" elevation="2">
      <v-card-item class="bg-primary pa-4">
        <template #prepend>
          <v-avatar color="white" size="44">
            <v-icon icon="mdi-cog" color="primary" size="26" />
          </v-avatar>
        </template>
        <v-card-title class="text-white text-h6">{{ lock.name }}</v-card-title>
        <v-card-subtitle class="text-blue-lighten-3 text-caption font-mono">{{ lock.address }}</v-card-subtitle>
        <template #append>
          <v-chip
            :color="lock.connected ? 'success' : 'grey'"
            size="small"
            variant="flat"
            :prepend-icon="lock.connected ? 'mdi-bluetooth-connect' : 'mdi-bluetooth-off'"
          >{{ lock.connected ? $t('lock.connected') : $t('lock.disconnected') }}</v-chip>
        </template>
      </v-card-item>
    </v-card>

    <!-- Paramètres -->
    <v-card class="mb-4" rounded="lg" elevation="1">
      <div class="bg-primary pa-3 d-flex align-center rounded-t-lg">
        <v-icon icon="mdi-tune" color="white" class="mr-2" size="20" />
        <span class="text-white text-body-2 font-weight-medium">{{ $t('settings.title') }}</span>
      </div>
      <v-card-text class="pt-4 pb-2">
        <v-row>
          <v-col cols="12">
            <div class="d-flex align-center mb-1">
              <v-icon icon="mdi-lock-clock" size="20" class="mr-2 text-medium-emphasis" />
              <span class="text-body-2 font-weight-medium">{{ $t('settings.autoLockTime') }}</span>
            </div>
            <v-slider
              v-model="autoLockTime"
              :disabled="!lock.hasAutoLock"
              thumb-label="always"
              :hint="autoLockHint"
              persistent-hint
              color="primary"
              max="60"
              min="0"
              class="mt-6"
            />
          </v-col>
          <v-col cols="12">
            <v-divider class="mb-3" />
            <v-switch
              v-model="audio"
              prepend-icon="mdi-volume-high"
              :label="$t('lock.sound')"
              persistent-hint
              :hint="$t('settings.soundHint')"
              color="primary"
              inset
            />
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions class="px-4 pb-4">
        <v-btn variant="elevated" color="error" size="small" prepend-icon="mdi-close" @click="cancel">{{ $t('common.cancel') }}</v-btn>
        <v-spacer />
        <v-btn
          color="success"
          variant="elevated"
          prepend-icon="mdi-content-save"
          :disabled="!changesMade"
          :loading="waitingSettings"
          @click="saveSettings"
        >{{ $t('common.save') }}</v-btn>
      </v-card-actions>
    </v-card>

    <!-- Informations appareil -->
    <v-card class="mb-4" rounded="lg" elevation="1" v-if="lock.manufacturer || lock.model || lock.firmware">
      <div class="bg-warning pa-3 d-flex align-center rounded-t-lg">
        <v-icon icon="mdi-information-outline" color="white" class="mr-2" size="20" />
        <span class="text-white text-body-2 font-weight-medium">{{ $t('settings.deviceInfo') }}</span>
      </div>
      <v-list density="compact" lines="two" class="py-2">
        <v-list-item v-if="lock.manufacturer" prepend-icon="mdi-factory">
          <v-list-item-title class="text-body-2 font-weight-medium">{{ $t('settings.manufacturer') }}</v-list-item-title>
          <v-list-item-subtitle>{{ lock.manufacturer }}</v-list-item-subtitle>
        </v-list-item>
        <v-divider v-if="lock.manufacturer && (lock.model || lock.firmware)" inset />
        <v-list-item v-if="lock.model" prepend-icon="mdi-barcode">
          <v-list-item-title class="text-body-2 font-weight-medium">{{ $t('settings.model') }}</v-list-item-title>
          <v-list-item-subtitle>{{ lock.model }}</v-list-item-subtitle>
        </v-list-item>
        <v-divider v-if="lock.model && lock.firmware" inset />
        <v-list-item v-if="lock.firmware" prepend-icon="mdi-memory">
          <v-list-item-title class="text-body-2 font-weight-medium">{{ $t('settings.firmware') }}</v-list-item-title>
          <v-list-item-subtitle>
            <v-chip size="x-small" color="teal" variant="tonal" class="mr-1">{{ lock.firmware }}</v-chip>
          </v-list-item-subtitle>
        </v-list-item>
      </v-list>
    </v-card>

    <!-- Synchroniser l'horloge -->
    <v-card class="mb-4" rounded="lg" elevation="1">
      <div class="bg-primary pa-3 d-flex align-center rounded-t-lg">
        <v-icon icon="mdi-clock-outline" color="white" class="mr-2" size="20" />
        <span class="text-white text-body-2 font-weight-medium">{{ $t('settings.syncClock') }}</span>
      </div>
      <v-card-text>
        <div class="d-flex align-center justify-space-between flex-wrap gap-2">
          <div class="text-caption text-medium-emphasis">{{ $t('settings.syncClockHint') }}</div>
          <v-btn
            color="success"
            variant="tonal"
            size="small"
            prepend-icon="mdi-clock-sync-outline"
            :loading="waitingCalibrate"
            @click="calibrateTime"
          >{{ $t('settings.syncClock') }}</v-btn>
        </div>
      </v-card-text>
    </v-card>

    <!-- Zone dangereuse -->
    <v-card rounded="lg" elevation="1" border="error sm">
      <div class="bg-danger pa-3 d-flex align-center rounded-t-lg">
        <v-icon icon="mdi-alert-circle-outline" color="white" class="mr-2" size="20" />
        <span class="text-white text-body-2 font-weight-medium">{{ $t('settings.dangerZone') }}</span>
      </div>
      <v-card-text>
        <div class="d-flex align-center justify-space-between flex-wrap gap-2">
          <div class="text-caption text-medium-emphasis mr-4">{{ $t('settings.unpairWarning') }}</div>
          <v-btn color="error" variant="elevated" size="small" prepend-icon="mdi-link-off" @click="unpair">
            {{ $t('settings.unpair') }}
          </v-btn>
        </div>
      </v-card-text>
    </v-card>

    <ConfirmDlg ref="confirm" />
  </v-container>
</template>

<script>
import moment from "moment"
import ConfirmDlg from "@/components/ConfirmDlg"

export default {
  name: "Settings",
  params: ["address"],
  components: { ConfirmDlg },
  data() {
    return {
      address: this.$route.params.address || this.address,
      autoLockTime: -1,
      audio: false,
    }
  },
  computed: {
    lock() {
      return this.$store.state.locks.find(l => l.address == this.address) || {}
    },
    waitingSettings() {
      return this.$store.state.waitingSettings
    },
    waitingCalibrate() {
      return this.$store.state.waitingCalibrate
    },
    autoLockHint() {
      if (this.lock.hasAutoLock) {
        return this.$t('settings.autoLockHint', { value: this.lock.autoLockTime })
      }
      return this.$t('settings.autoLockNotSupported')
    },
    autoLockChanged() {
      return this.autoLockTime != this.lock.autoLockTime
    },
    audioChanged() {
      return this.audio != this.lock.audio
    },
    changesMade() {
      return this.autoLockChanged || this.audioChanged
    },
  },
  created() {
    if (!this.lock.name) {
      this.$router.push({ name: "Home" })
    } else {
      this.autoLockTime = this.lock.autoLockTime
      this.audio = this.lock.audio
      this.$store.commit("setActiveLockAddress", this.lock.address)
      this.$store.dispatch("saveSettings", {
        lockAddress: this.address,
        settings: { getAudio: true }
      })
    }
  },
  beforeUnmount() {
    this.$store.commit("setActiveLockAddress", "")
  },
  methods: {
    dateTime(str) {
      return moment(str, "YYYYMMDDHHmm").format("DD-MM-YYYY HH:mm")
    },
    async unpair() {
      if (await this.$refs.confirm.open(this.$t('common.confirm'), this.$t('settings.confirmUnpair'))) {
        await this.$store.dispatch("unpair", this.lock.address)
        this.$router.push({ name: "Home" })
      }
    },
    cancel() {
      this.$router.push({ name: "Home" })
    },
    calibrateTime() {
      this.$store.dispatch("calibrateTime", this.lock.address)
    },
    saveSettings() {
      const settings = {}
      if (this.autoLockChanged) settings.autolock = this.autoLockTime
      if (this.audioChanged) settings.audio = this.audio
      this.$store.dispatch("saveSettings", { lockAddress: this.lock.address, settings })
    },
  },
  watch: {
    waitingSettings(newVal) {
      if (newVal === false) {
        this.autoLockTime = this.lock.autoLockTime
        this.audio = this.lock.audio
      }
    },
  },
}
</script>
