<template>
  <v-dialog
    v-model="dialog"
    :max-width="options.width"
    :style="{ zIndex: options.zIndex }"
    @keydown.esc="cancel"
  >
    <v-card>
      <v-toolbar theme="dark" :color="options.color" density="compact" flat>
        <v-toolbar-title class="text-body-2 font-weight-bold text-grey">
          {{ title }}
        </v-toolbar-title>
      </v-toolbar>
      <v-card-text
        v-show="!!message"
        class="pa-4 text-black"
        v-html="message"
      ></v-card-text>
      <v-card-actions class="pt-3">
        <v-spacer></v-spacer>
        <v-btn
          v-if="!options.noconfirm"
          color="red-darken-4"
          variant="elevated"
          class="body-2 font-weight-bold"
          @click="cancel"
          >{{ $t('common.cancel') }}</v-btn
        >
        <v-btn
          color="green-darken-4"
          class="body-2 font-weight-bold"
          variant="elevated"
          @click="agree"
          >{{ $t('common.ok') }}</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
export default {
  name: "ConfirmDlg",
  data() {
    return {
      dialog: false,
      resolve: null,
      reject: null,
      message: null,
      title: null,
      options: {
        color: "grey-lighten-3",
        width: 400,
        zIndex: 200,
        noconfirm: false,
      },
    }
  },
  methods: {
    open(title, message, options) {
      this.dialog = true
      this.title = title
      this.message = message
      this.options = Object.assign(this.options, options)
      return new Promise((resolve, reject) => {
        this.resolve = resolve
        this.reject = reject
      })
    },
    agree() {
      this.resolve(true)
      this.dialog = false
    },
    cancel() {
      this.resolve(false)
      this.dialog = false
    },
  },
}
</script>
