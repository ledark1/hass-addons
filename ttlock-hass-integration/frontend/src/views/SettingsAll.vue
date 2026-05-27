<template>
  <div>
    <div class="d-flex flex-wrap align-end justify-space-between mb-6 ga-3">
      <div>
        <h1 class="text-h5 font-weight-bold mb-1">{{ $t('settings.allTitle') }}</h1>
        <div class="text-body-2 text-medium-emphasis">{{ $t('settings.allSubtitle') }}</div>
      </div>
    </div>

    <!-- ── Gestion des alias (globale, indépendante des serrures) ────────── -->
    <v-card class="mb-6">
      <div class="px-5 pt-4 pb-2">
        <div class="d-flex align-center ga-2 mb-1">
          <v-icon icon="mdi-tag-multiple-outline" size="20" class="text-medium-emphasis" />
          <h2 class="text-subtitle-1 font-weight-bold">{{ $t('aliases.title') }}</h2>
        </div>
        <div class="text-body-2 text-medium-emphasis">{{ $t('aliases.hint') }}</div>
      </div>
      <v-divider />
      <v-card-text>
        <div class="d-flex align-center ga-3 flex-wrap">
          <v-btn
            variant="tonal"
            color="primary"
            prepend-icon="mdi-download-outline"
            @click="exportAliases"
          >{{ $t('aliases.export') }}</v-btn>
          <v-btn
            variant="tonal"
            color="secondary"
            prepend-icon="mdi-upload-outline"
            :loading="aliasImporting"
            @click="$refs.aliasInput.click()"
          >{{ $t('aliases.import') }}</v-btn>
          <input
            ref="aliasInput"
            type="file"
            accept=".json,application/json"
            style="display:none"
            @change="importAliases"
          />
        </div>
        <v-alert v-if="aliasImportError" type="error" density="compact" class="mt-3" closable @click:close="aliasImportError = null">
          {{ aliasImportError }}
        </v-alert>
        <v-alert v-if="aliasImportSuccess" type="success" density="compact" class="mt-3" closable @click:close="aliasImportSuccess = false">
          {{ $t('aliases.importSuccess') }}
        </v-alert>
      </v-card-text>
    </v-card>
    <!-- ──────────────────────────────────────────────────────────────────── -->

    <v-card v-if="pairedLocks.length === 0" class="pa-8 text-center">
      <v-avatar size="64" color="primary" variant="tonal" class="mb-4">
        <v-icon size="32">mdi-tune-variant</v-icon>
      </v-avatar>
      <h2 class="text-h6 font-weight-bold mb-2">{{ $t('settings.noLockPaired') }}</h2>
      <p class="text-body-2 text-medium-emphasis mx-auto" style="max-width: 420px;">
        {{ $t('dashboard.empty.subtitle') }}
      </p>
    </v-card>

    <template v-else>
      <v-card class="pa-4 mb-4">
        <div class="d-flex align-center flex-wrap ga-3">
          <v-icon icon="mdi-lock-outline" class="text-medium-emphasis" />
          <span class="text-body-2 font-weight-medium">{{ $t('settings.selectLock') }}</span>
          <v-spacer />
          <v-select
            v-model="selectedAddress"
            :items="lockSelectItems"
            item-title="title"
            item-value="value"
            density="comfortable"
            hide-details
            variant="outlined"
            style="max-width: 380px;"
          />
        </div>
      </v-card>

      <SettingsManager
        v-if="selectedAddress"
        :address="selectedAddress"
        @unpaired="onUnpaired"
      />
    </template>
  </div>
</template>

<script>
import SettingsManager from "@/components/SettingsManager.vue"

export default {
  name: "SettingsAll",
  components: { SettingsManager },
  data() {
    return {
      selectedAddress: null,
      aliasImporting: false,
      aliasImportError: null,
      aliasImportSuccess: false,
    }
  },
  computed: {
    pairedLocks() {
      return this.$store.state.locks.filter(l => l.paired)
    },
    lockSelectItems() {
      return this.pairedLocks.map(l => ({
        title: `${l.name} — ${l.address}`,
        value: l.address,
      }))
    },
  },
  created() {
    if (this.pairedLocks.length > 0) {
      this.selectedAddress = this.pairedLocks[0].address
    }
  },
  methods: {
    onUnpaired() {
      const remaining = this.pairedLocks
      this.selectedAddress = remaining.length > 0 ? remaining[0].address : null
    },

    /** Construit l'URL de base de l'API (fonctionne en HA ingress et en dev Vite). */
    _apiBase() {
      const loc = globalThis.location.href.replace(globalThis.location.hash, '');
      if (loc.includes('/frontend/')) {
        return loc.replace(/\/frontend\/.*$/, '/');
      }
      return '/';
    },

    exportAliases() {
      const url = this._apiBase() + 'api/aliases';
      const a = document.createElement('a');
      a.href = url;
      a.download = 'aliasData.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    },

    async importAliases(event) {
      const file = event.target.files[0];
      // Réinitialiser l'input pour permettre de re-sélectionner le même fichier
      event.target.value = '';
      if (!file) return;

      this.aliasImportError = null;
      this.aliasImportSuccess = false;
      this.aliasImporting = true;

      try {
        const text = await file.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          this.aliasImportError = this.$t('aliases.importErrorJson');
          return;
        }

        if (
          !data || typeof data !== 'object' || Array.isArray(data) ||
          typeof data.lock !== 'object' || Array.isArray(data.lock) ||
          typeof data.card !== 'object' || Array.isArray(data.card) ||
          typeof data.finger !== 'object' || Array.isArray(data.finger)
        ) {
          this.aliasImportError = this.$t('aliases.importErrorFormat');
          return;
        }

        const url = this._apiBase() + 'api/aliases';
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          this.aliasImportError = err.error || this.$t('aliases.importErrorServer');
          return;
        }

        this.aliasImportSuccess = true;
      } finally {
        this.aliasImporting = false;
      }
    },
  },
  watch: {
    pairedLocks(newVal) {
      if (this.selectedAddress && !newVal.some(l => l.address === this.selectedAddress)) {
        this.selectedAddress = newVal[0]?.address || null
      } else if (!this.selectedAddress && newVal.length > 0) {
        this.selectedAddress = newVal[0].address
      }
    },
  },
}
</script>
