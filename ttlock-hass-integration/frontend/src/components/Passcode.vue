<template>
  <v-dialog v-model="localShow" persistent max-width="480px" transition="dialog-bottom-transition">
    <v-card rounded="lg">

      <!-- En-tête -->
      <v-card-item class="bg-primary pa-4">
        <template #prepend>
          <v-icon icon="mdi-gesture-tap" size="26" color="white" class="mr-1" />
        </template>
        <v-card-title class="text-white text-body-1 font-weight-medium">
          <template v-if="value == -1">{{ $t('common.add') }}</template>
          <template v-else>{{ $t('common.edit') }}</template>
          {{ $t('passcode.title') }}
        </v-card-title>
      </v-card-item>

      <v-divider />

      <v-card-text class="pa-5">
        <v-select
          v-model="passcode.type"
          :items="passcodeTypes"
          :label="$t('passcode.type')"
          prepend-inner-icon="mdi-format-list-bulleted-type"
          variant="outlined"
          density="comfortable"
          class="mb-4"
        />
        <v-text-field
          v-model="passcode.newPassCode"
          :label="value == -1 ? $t('passcode.title') : $t('passcode.newCode')"
          :hint="$t('passcode.hint')"
          persistent-hint
          prepend-inner-icon="mdi-numeric"
          variant="outlined"
          density="comfortable"
          inputmode="numeric"
          clearable
        />
      </v-card-text>

      <v-progress-linear v-if="busy" indeterminate color="primary" height="2" />
      <v-divider v-else />

      <!-- Actions -->
      <v-card-actions class="pa-4">
        <v-spacer />
        <v-btn
          variant="text"
          color="error"
          prepend-icon="mdi-close"
          :disabled="busy"
          @click="$emit('cancel')"
        >
          {{ $t('common.close') }}
        </v-btn>
        <v-btn
          variant="elevated"
          color="primary"
          prepend-icon="mdi-content-save"
          :loading="busy"
          :disabled="busy || !passcode.newPassCode || passcode.newPassCode.trim() === ''"
          @click="savePasscode"
        >
          {{ $t('common.save') }}
        </v-btn>
      </v-card-actions>

    </v-card>
  </v-dialog>
</template>
<script>
export default {
  name: "Passcode",
  props: ["show", "address", "value"],
  data: function () {
    return {
      localShow: false,
      passcode: {},
      busy: false,
    }
  },
  computed: {
    passcodeTypes() {
      return [
        { title: this.$t('passcode.permanent'), value: 1 },
        { title: this.$t('passcode.count'), value: 2, disabled: true },
        { title: this.$t('passcode.timed'), value: 3, disabled: true },
        { title: this.$t('passcode.cyclic'), value: 4, disabled: true },
      ]
    },
    storeIsWaiting() {
      return this.$store.state.waitingCredentials
    },
  },
  methods: {
    updatePasscode(passcode) {
      if (passcode == -1) {
        this.passcode = {
          type: 1,
          newPassCode: "",
          passCode: -1,
          startDate: "200001010000",
          endDate: "209912012359",
        }
      } else {
        this.passcode = JSON.parse(JSON.stringify(passcode))
        this.passcode.passCode = passcode.newPassCode || passcode.passCode || -1
        this.passcode.newPassCode = ""
        this.passcode.startDate = passcode.startDate || "200001010000"
        this.passcode.endDate = passcode.endDate || "209912012359"
      }
    },
    async savePasscode() {
      if (this.busy) return
      if (!this.passcode.newPassCode || this.passcode.newPassCode.trim() === "") {
        return
      }
      // S'assurer que passCode est explicitement -1 (nombre) pour un ajout
      if (this.passcode.passCode == null || this.passcode.passCode === "") {
        this.passcode.passCode = -1
      }
      this.busy = true
      console.log('savePasscode sending:', JSON.stringify(this.passcode))
      await this.$store.dispatch("setPasscode", {
        lockAddress: this.address,
        passcode: this.passcode,
      })
    },
  },
  created() {
    this.updatePasscode(this.value)
  },
  watch: {
    show(newVal) {
      this.localShow = newVal
    },
    value(newVal) {
      this.updatePasscode(newVal)
    },
    storeIsWaiting(newVal) {
      if (newVal === false && this.busy) {
        this.$emit("cancel")
        this.busy = false
      }
    },
  },
}
</script>
