<template>
  <v-container v-if="lock.address" style="max-width: 1100px">

    <!-- Header -->
    <v-card class="mb-4" rounded="lg" elevation="2">
      <div class="bg-primary">
        <v-card-item class="pa-4">
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
        <div
          v-if="lock.manufacturer || lock.model || lock.firmware"
          class="px-4 pb-3 d-flex flex-wrap"
          style="gap: 8px"
        >
          <v-chip
            v-if="lock.manufacturer"
            size="x-small"
            color="white"
            variant="outlined"
            prepend-icon="mdi-factory"
          >{{ lock.manufacturer }}</v-chip>
          <v-chip
            v-if="lock.model"
            size="x-small"
            color="white"
            variant="outlined"
            prepend-icon="mdi-barcode"
          >{{ lock.model }}</v-chip>
          <v-chip
            v-if="lock.firmware"
            size="x-small"
            color="white"
            variant="outlined"
            prepend-icon="mdi-memory"
          >{{ lock.firmware }}</v-chip>
        </div>
      </div>
    </v-card>

    <v-row>
      <!-- Paramètres -->
      <v-col cols="12" md="6">
        <v-card class="h-100 d-flex flex-column" rounded="lg" elevation="1">
          <div class="bg-primary pa-3 d-flex align-center rounded-t-lg">
            <v-icon icon="mdi-tune" color="white" class="mr-2" size="20" />
            <span class="text-white text-body-2 font-weight-medium">{{ $t('settings.title') }}</span>
          </div>
          <v-card-text class="pt-4 pb-2 flex-grow-1">
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
                  density="compact"
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
              size="small"
              prepend-icon="mdi-content-save"
              :disabled="!changesMade"
              :loading="waitingSettings"
              @click="saveSettings"
            >{{ $t('common.save') }}</v-btn>
          </v-card-actions>
        </v-card>
      </v-col>

      <!-- Colonne droite : Synchro horloge + Zone dangereuse empilées -->
      <v-col cols="12" md="6">
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
          <div class="bg-error pa-3 d-flex align-center rounded-t-lg">
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
      </v-col>
    </v-row>

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
    if (this.lock.address) {
      this.autoLockTime = this.lock.autoLockTime
      this.audio = this.lock.audio
      this.$store.commit("setActiveLockAddress", this.lock.address)
    } else {
      this.$router.push({ name: "Home" })
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
