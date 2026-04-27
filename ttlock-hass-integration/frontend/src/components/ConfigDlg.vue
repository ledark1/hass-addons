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
          <v-btn color="red-darken-4" variant="elevated" v-on:click="cancelConfig" :disabled="busy"> {{ $t('common.close') }} </v-btn>
          <v-btn color="green-darken-4" variant="elevated" v-on:click="saveConfig" :disabled="busy || !configValid"> {{ $t('common.save') }} </v-btn>
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
    validateJson(val) {
      try {
        JSON.parse(val)
        this.configValid = true
      } catch (e) {
        this.configValid = false
      }
    },
    async saveConfig() {
      if (this.busy || !this.configValid) return
      try {
        const data = JSON.parse(this.configText)
        this.busy = true
        await this.$store.dispatch("saveConfig", JSON.stringify(data))
      } catch (e) {
        this.configValid = false
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
      if (newVal != "") {
        try {
          this.configText = JSON.stringify(JSON.parse(newVal), null, 2)
        } catch (e) {
          this.configText = newVal
        }
        this.configValid = true
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
