import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { isPublicPage } from '../server/utils/access'
import LegalIndex from '../app/pages/legal/index.vue'
import Datenschutz from '../app/pages/legal/datenschutz.vue'
import Nutzungsbedingungen from '../app/pages/legal/nutzungsbedingungen.vue'
import Impressum from '../app/pages/legal/impressum.vue'

const pages = [
  { path: '/legal', comp: LegalIndex, heading: 'Über diesen Dienst', placeholder: '[NAME]' },
  { path: '/legal/datenschutz', comp: Datenschutz, heading: 'Datenschutzerklärung', placeholder: '[ANSCHRIFT]' },
  { path: '/legal/nutzungsbedingungen', comp: Nutzungsbedingungen, heading: 'Nutzungsbedingungen', placeholder: '[E-MAIL]' },
  { path: '/legal/impressum', comp: Impressum, heading: 'Impressum', placeholder: '[NAME]' }
]

describe('legal pages', () => {
  for (const p of pages) {
    it(`${p.path} is public, renders, shows placeholders and the review notice`, async () => {
      expect(isPublicPage(p.path)).toBe(true)
      const wrapper = await mountSuspended(p.comp)
      const text = wrapper.text()
      expect(text).toContain(p.heading)
      expect(text).toContain(p.placeholder)
      expect(text).toContain('Prüfung durch den Betreiber erforderlich')
    })
  }

  it('privacy page names all third-party providers', async () => {
    const text = (await mountSuspended(Datenschutz)).text()
    for (const n of ['YouTube', 'TikTok', 'HeyGen', 'Deepseek', 'OneDrive', 'OAuth']) {
      expect(text).toContain(n)
    }
  })
})
