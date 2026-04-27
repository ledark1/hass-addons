import { createVuetify } from 'vuetify'
import { en, fr } from 'vuetify/locale'
import { aliases, mdi } from 'vuetify/iconsets/mdi'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'

export default createVuetify({
  locale: {
    locale: 'en',
    fallback: 'en',
    messages: { en, fr }
  },
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi }
  }
})
