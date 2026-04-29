<template>
  <v-container v-if="lock.address">
    <v-card class="mb-4" variant="tonal" color="primary">
      <v-card-item>
        <template #prepend>
          <v-icon icon="mdi-history" size="28" />
        </template>
        <v-card-title>{{ lock.name }}</v-card-title>
        <v-card-subtitle class="text-caption font-mono">{{ lock.address }}</v-card-subtitle>
        <template #append>
          <v-btn
            icon="mdi-refresh"
            variant="text"
            color="white"
            :loading="waitingOperations"
            @click="refresh"
          />
        </template>
      </v-card-item>
    </v-card>

    <v-card>
      <v-data-table
        :headers="headers"
        :items="sortedOperations"
        :loading="waitingOperations"
        :items-per-page="50"
        :items-per-page-options="[10, 25, 50, 100, -1]"
        density="compact"
      >
        <template #item.recordTypeCategory="{ item }">
          <v-icon v-if="item.recordTypeCategory === 'LOCK'" color="error" size="20">mdi-lock</v-icon>
          <v-icon v-else-if="item.recordTypeCategory === 'UNLOCK'" color="success" size="20">mdi-lock-open-variant</v-icon>
        </template>
        <template #item.operateDate="{ item }">
          <span class="text-caption">{{ dateTime(item.operateDate) }}</span>
        </template>
        <template #item.electricQuantity="{ item }">
          <v-chip size="x-small" :color="batteryColor(item.electricQuantity)" variant="tonal">
            <v-icon start size="12" :icon="batteryIcon(item.electricQuantity)" />
            {{ item.electricQuantity }}%
          </v-chip>
        </template>
        <template #item.password="{ item }">
          <span v-if="item.passwordName" class="font-weight-medium">{{ item.passwordName }}</span>
          <span v-if="item.password" class="text-caption text-grey ml-1">({{ item.password }})</span>
        </template>
      </v-data-table>
    </v-card>
  </v-container>
</template>

<script>
import moment from "moment"

export default {
  name: "Operations",
  params: ["address"],
  data() {
    return {
      address: this.$route.params.address || this.address,
    }
  },
  computed: {
    lock() {
      return this.$store.state.locks.find(l => l.address == this.address) || {}
    },
    waitingOperations() {
      return this.$store.state.waitingOperations
    },
    operations() {
      return this.$store.state.operations[this.address] || []
    },
    headers() {
      return [
        { title: this.$t('operations.index'), key: "recordNumber", width: "60px" },
        { title: "", key: "recordTypeCategory", sortable: false, width: "40px" },
        { title: this.$t('operations.date'), key: "operateDate" },
        { title: this.$t('operations.battery'), key: "electricQuantity", sortable: false },
        { title: this.$t('operations.credential'), key: "password", sortable: false },
        { title: this.$t('operations.description'), key: "recordTypeName", sortable: false },
      ]
    },
    sortedOperations() {
      let sorted = structuredClone(this.operations);
      sorted.sort((a, b) => {
        if (a.operateDate > b.operateDate) {
          return -1;
        } else if (a.operateDate < b.operateDate) {
          return 1;
        } else if (a.recordNumber > b.recordNumber) {
          return -1;
        } else if (a.recordNumber < b.recordNumber) {
          return 1;
        }
        return 0;
      });
      return sorted;
    },
  },
  created() {
    if (this.lock.address) {
      this.$store.commit("setActiveLockAddress", this.lock.address)
      this.$store.dispatch("readOperations", this.lock.address)
    } else {
      this.$router.push({ name: "Home" })
    }
  },
  beforeUnmount() {
    this.$store.commit("setActiveLockAddress", "")
  },
  methods: {
    dateTime(str) {
      return moment(str, "YYYYMMDDHHmmss").format("DD-MM-YYYY HH:mm:ss")
    },
    refresh() {
      this.$store.dispatch("readOperations", this.lock.address)
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
