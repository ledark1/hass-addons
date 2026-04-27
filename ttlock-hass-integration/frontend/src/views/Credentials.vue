<template>
  <v-container v-if="lock.name">
    <v-card class="mb-4" variant="tonal" color="primary">
      <v-card-item>
        <template #prepend>
          <v-icon icon="mdi-key-chain" size="28" />
        </template>
        <v-card-title>{{ lock.name }}</v-card-title>
        <v-card-subtitle class="text-caption font-mono">{{ lock.address }}</v-card-subtitle>
      </v-card-item>
    </v-card>

    <v-card v-if="lock.hasPasscode" class="mb-4">
      <v-toolbar density="compact" color="transparent">
        <v-toolbar-title class="d-flex align-center ga-2">
          <v-icon icon="mdi-gesture-tap" />
          <span>{{ $t('credentials.pins') }}</span>
        </v-toolbar-title>
        <v-spacer />
        <v-progress-circular v-if="passcodes === -1" indeterminate color="primary" size="22" width="2" class="mr-2" />
        <v-btn v-else color="primary" variant="elevated" prepend-icon="mdi-key-plus" size="small" class="mr-2" @click="showEditPasscodeDialog">
          {{ $t('credentials.addPin') }}
        </v-btn>
      </v-toolbar>
      <v-divider />
      <v-card-text v-if="passcodes === -1" class="text-center py-6">
        <v-progress-circular indeterminate color="primary" />
        <div class="mt-2 text-grey">{{ $t('credentials.loading') }}</div>
      </v-card-text>
      <v-table v-else density="compact">
        <thead>
          <tr>
            <th class="text-left">{{ $t('credentials.type') }}</th>
            <th class="text-left">{{ $t('credentials.pinCode') }}</th>
            <th class="text-left">{{ $t('credentials.validFrom') }}</th>
            <th class="text-left">{{ $t('credentials.validTo') }}</th>
            <th class="text-right">{{ $t('common.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="passcode in passcodes" :key="passcode.newPassCode">
            <td><v-chip size="x-small" variant="tonal" color="primary">{{ passcodeTypeText[passcode.type] }}</v-chip></td>
            <td><code class="font-weight-bold">{{ passcode.newPassCode }}</code></td>
            <td class="text-caption">{{ dateTime(passcode.startDate) }}</td>
            <td class="text-caption">{{ dateTime(passcode.endDate) }}</td>
            <td class="text-right">
              <v-tooltip :text="$t('credentials.changePin')">
                <template #activator="{ props }">
                  <v-btn v-bind="props" icon="mdi-pencil" size="x-small" variant="tonal" color="blue" class="mr-1" @click="showEditPasscodeDialog(passcode)" />
                </template>
              </v-tooltip>
              <v-tooltip :text="$t('credentials.deletePin')">
                <template #activator="{ props }">
                  <v-btn v-bind="props" icon="mdi-delete" size="x-small" variant="tonal" color="red" @click="showDeletePasscodeDialog(passcode)" />
                </template>
              </v-tooltip>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <v-card v-if="lock.hasCard" class="mb-4">
      <v-toolbar density="compact" color="transparent">
        <v-toolbar-title class="d-flex align-center ga-2">
          <v-icon icon="mdi-credit-card-wireless" />
          <span>{{ $t('credentials.cards') }}</span>
        </v-toolbar-title>
        <v-spacer />
        <v-progress-circular v-if="cards === -1" indeterminate color="primary" size="22" width="2" class="mr-2" />
        <v-btn v-else color="primary" variant="elevated" prepend-icon="mdi-key-plus" size="small" class="mr-2" @click="showEditCardDialog">
          {{ $t('credentials.addCard') }}
        </v-btn>
      </v-toolbar>
      <v-divider />
      <v-card-text v-if="cards === -1" class="text-center py-6">
        <v-progress-circular indeterminate color="primary" />
        <div class="mt-2 text-grey">{{ $t('credentials.loading') }}</div>
      </v-card-text>
      <v-table v-else density="compact">
        <thead>
          <tr>
            <th class="text-left">{{ $t('credentials.cardSn') }}</th>
            <th class="text-left">{{ $t('credentials.validFrom') }}</th>
            <th class="text-left">{{ $t('credentials.validTo') }}</th>
            <th class="text-right">{{ $t('common.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="card of cards" :key="card.cardNumber">
            <td>
              <span class="font-weight-medium">{{ card.alias != card.cardNumber ? card.alias : card.cardNumber }}</span>
              <div v-if="card.alias != card.cardNumber" class="text-caption text-grey">{{ card.cardNumber }}</div>
            </td>
            <td class="text-caption">{{ dateTime(card.startDate) }}</td>
            <td class="text-caption">{{ dateTime(card.endDate) }}</td>
            <td class="text-right">
              <v-tooltip :text="$t('credentials.editCard')">
                <template #activator="{ props }">
                  <v-btn v-bind="props" icon="mdi-pencil" size="x-small" variant="tonal" color="blue" class="mr-1" @click="showEditCardDialog(card)" />
                </template>
              </v-tooltip>
              <v-tooltip :text="$t('credentials.deleteCard')">
                <template #activator="{ props }">
                  <v-btn v-bind="props" icon="mdi-delete" size="x-small" variant="tonal" color="red" @click="showDeleteCardDialog(card)" />
                </template>
              </v-tooltip>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <v-card v-if="lock.hasFinger" class="mb-4">
      <v-toolbar density="compact" color="transparent">
        <v-toolbar-title class="d-flex align-center ga-2">
          <v-icon icon="mdi-fingerprint" />
          <span>{{ $t('credentials.fingers') }}</span>
        </v-toolbar-title>
        <v-spacer />
        <v-progress-circular v-if="fingers === -1" indeterminate color="primary" size="22" width="2" class="mr-2" />
        <v-btn v-else color="primary" variant="elevated" prepend-icon="mdi-fingerprint" size="small" class="mr-2" @click="showEditFingerDialog">
          {{ $t('credentials.addFinger') }}
        </v-btn>
      </v-toolbar>
      <v-divider />
      <v-card-text v-if="fingers === -1" class="text-center py-6">
        <v-progress-circular indeterminate color="primary" />
        <div class="mt-2 text-grey">{{ $t('credentials.loading') }}</div>
      </v-card-text>
      <v-table v-else density="compact">
        <thead>
          <tr>
            <th class="text-left">{{ $t('credentials.fingerprintId') }}</th>
            <th class="text-left">{{ $t('credentials.validFrom') }}</th>
            <th class="text-left">{{ $t('credentials.validTo') }}</th>
            <th class="text-right">{{ $t('common.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="finger of fingers" :key="finger.fpNumber">
            <td>
              <span class="font-weight-medium">{{ finger.alias != finger.fpNumber ? finger.alias : finger.fpNumber }}</span>
              <div v-if="finger.alias != finger.fpNumber" class="text-caption text-grey">{{ finger.fpNumber }}</div>
            </td>
            <td class="text-caption">{{ dateTime(finger.startDate) }}</td>
            <td class="text-caption">{{ dateTime(finger.endDate) }}</td>
            <td class="text-right">
              <v-tooltip :text="$t('credentials.editFinger')">
                <template #activator="{ props }">
                  <v-btn v-bind="props" icon="mdi-pencil" size="x-small" variant="tonal" color="blue" class="mr-1" @click="showEditFingerDialog(finger)" />
                </template>
              </v-tooltip>
              <v-tooltip :text="$t('credentials.deleteFinger')">
                <template #activator="{ props }">
                  <v-btn v-bind="props" icon="mdi-delete" size="x-small" variant="tonal" color="red" @click="showDeleteFingerDialog(finger)" />
                </template>
              </v-tooltip>
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <Passcode :address="address" :value="editPasscode" :show="showEditPasscode" v-on:cancel="cancelEditPasscodeDialog" />
    <Card :address="address" :value="editCard" :show="showEditCard" v-on:cancel="cancelEditCardDialog" />
    <Finger :address="address" :value="editFinger" :show="showEditFinger" v-on:cancel="cancelEditFingerDialog" />
    <ConfirmDlg ref="confirm" />
  </v-container>
</template>

<script>
import moment from "moment"
import Passcode from "@/components/Passcode"
import Card from "@/components/Card"
import Finger from "@/components/Finger"
import ConfirmDlg from "@/components/ConfirmDlg"

export default {
  name: "Credentials",
  params: ["address"],
  components: { Passcode, Card, Finger, ConfirmDlg },
  data() {
    return {
      address: this.$route.params.address || this.address,
      passcodes: -1,
      cards: -1,
      fingers: -1,
      editPasscode: -1,
      showEditPasscode: false,
      editCard: -1,
      showEditCard: false,
      editFinger: -1,
      showEditFinger: false,
    }
  },
  computed: {
    lock() {
      return this.$store.state.locks.find(l => l.address == this.address) || {}
    },
    waitingCredentials() {
      return this.$store.state.waitingCredentials
    },
    passcodeTypeText() {
      return {
        1: this.$t('passcode.permanent'),
        2: this.$t('passcode.count'),
        3: this.$t('passcode.timed'),
        4: this.$t('passcode.cyclic'),
      }
    },
  },
  created() {
    if (!this.lock.name) {
      this.$router.push({ name: "Home" })
    } else {
      this.$store.commit("setActiveLockAddress", this.lock.address)
      this.$store.dispatch("readCredentials", this.lock.address)
    }
  },
  beforeUnmount() {
    this.$store.commit("setActiveLockAddress", "")
  },
  methods: {
    dateTime(str) {
      return moment(str, "YYYYMMDDHHmm").format("DD-MM-YYYY HH:mm")
    },
    showEditPasscodeDialog(passcode) {
      this.editPasscode = passcode ?? -1
      this.showEditPasscode = true
    },
    async showDeletePasscodeDialog(passcode) {
      if (passcode !== undefined) {
        if (await this.$refs.confirm.open(this.$t('common.confirm'), this.$t('credentials.confirmDeletePin'))) {
          let p = structuredClone(passcode)
          p.passCode = passcode.newPassCode
          p.newPassCode = -1
          this.$store.dispatch("setPasscode", { lockAddress: this.address, passcode: p })
          this.passcodes = -1
        }
      }
    },
    cancelEditPasscodeDialog() {
      this.editPasscode = -1
      this.showEditPasscode = false
    },
    showEditCardDialog(card) {
      this.editCard = card ?? -1
      this.showEditCard = true
    },
    async showDeleteCardDialog(card) {
      if (card !== undefined) {
        if (await this.$refs.confirm.open(this.$t('common.confirm'), this.$t('credentials.confirmDeleteCard'))) {
          card.startDate = -1
          this.$store.dispatch("setCard", { lockAddress: this.address, card: card })
          this.cards = -1
        }
      }
    },
    cancelEditCardDialog() {
      this.editCard = -1
      this.showEditCard = false
    },
    showEditFingerDialog(finger) {
      this.editFinger = finger ?? -1
      this.showEditFinger = true
    },
    async showDeleteFingerDialog(finger) {
      if (finger !== undefined) {
        if (await this.$refs.confirm.open(this.$t('common.confirm'), this.$t('credentials.confirmDeleteFinger'))) {
          finger.startDate = -1
          this.$store.dispatch("setFinger", { lockAddress: this.address, finger: finger })
          this.fingers = -1
        }
      }
    },
    cancelEditFingerDialog() {
      this.editFinger = -1
      this.showEditFinger = false
    },
  },
  watch: {
    waitingCredentials(newVal) {
      if (newVal === false) {
        this.passcodes = this.$store.state.passcodes[this.address]
        this.cards = this.$store.state.cards[this.address]
        this.fingers = this.$store.state.fingers[this.address]
      }
    },
  },
}
</script>
