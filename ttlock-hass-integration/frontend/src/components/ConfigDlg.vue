<template>
  <v-row justify="center">
    <v-dialog v-model="localShow" persistent max-width="600px" transition="dialog-bottom-transition">
      <v-card>
        <v-card-title>
          <v-icon>mdi-puzzle-edit-outline</v-icon>
          <span class="headline">
            {{ $t('app.editConfig') }}
          </span>
        </v-card-title>
        <v-card-text>
          <v-container>
            <v-textarea
              v-model="configText"
              rows="12"
              variant="outlined"
              :error="!configValid"
              :error-messages="configValid ? [] : [$t('common.invalidJson')]"
              @update:modelValue="validateJson"
              style="font-family: monospace; font-size: 12px;"
            ></v-textarea>
          </v-container>
          <v-progress-linear v-if="busy" indeterminate color="blue" class="mb-0"></v-progress-linear>
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="red-darken-4" variant="elevated" @click="cancelConfig" :disabled="busy"> {{ $t('common.close') }}</v-btn>
          <v-btn color="green-darken-4" variant="elevated" @click="saveConfig" :disabled="busy || !configValid"> {{ $t('common.save') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-row>
</template>
<script>
export default {
  name: "ConfigDlg",
  components: {},
  props: ["show"],
  data: function () {
    return {
      localShow: false,
      busy: false,
      configText: "",
      configValid: true
    }
  },
  computed: {
    storeConfig() {
      return this.$store.state.config
    },
    waitingConfig() {
      return this.$store.state.waitingConfig
    }
  },
  methods: {
    isValidJson(val) {
      if (!val) return false
      try {
        JSON.parse(val)
        return true
      } catch {
        return false
      }
    },
    async saveConfig() {
      if (this.busy || !this.configValid) return

      this.busy = true
      try {
        const data = JSON.parse(this.configText)
        await this.$store.dispatch("saveConfig", JSON.stringify(data))
      } finally {
        this.busy = false
      }
    },
    cancelConfig() {
      this.$store.commit("setConfig", "")
      this.$emit("cancel")
    }
  },
  watch: {
    show(newVal) {
      this.localShow = newVal
      if (newVal === true) {
        this.busy = true
        this.$store.dispatch("loadConfig")
      }
    },
    storeConfig(newVal) {
      if (!newVal) return

      try {
        const parsed = JSON.parse(newVal)
        this.configText = JSON.stringify(parsed, null, 2)
        this.configValid = true
      } catch (e) {
        console.error(e)
        this.configText = newVal
        this.configValid = false
      } finally {
        this.busy = false
      }
    },
    waitingConfig(newVal) {
      if (newVal === false && this.busy === true) {
        this.$emit("cancel")
        this.busy = false
      }
    }
  },
}
</script>
