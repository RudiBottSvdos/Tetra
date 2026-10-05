import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import NotificationBanner from '../app/components/panel/NotificationBanner.vue'
import { panelNavItems } from '../app/utils/panel-navigation'

describe('panel', () => {
  it('rendert Benachrichtigungen mit Typ', async () => {
    const wrapper = await mountSuspended(NotificationBanner, {
      props: {
        notifications: [
          { id: '1', type: 'budget_pause', title: 'Budgetpause', message: 'Pausiert', createdAt: '2026-10-05T00:00:00Z' }
        ]
      }
    })
    expect(wrapper.text()).toContain('Budgetpause')
    expect(wrapper.find('[data-notification-type="budget_pause"]').exists()).toBe(true)
  })

  it('rendert nichts ohne Benachrichtigungen', async () => {
    const wrapper = await mountSuspended(NotificationBanner, { props: { notifications: [] } })
    expect(wrapper.text()).toBe('')
  })

  it('enthält alle Bereiche in der Navigation', () => {
    const labels = panelNavItems.map(i => i.label)
    for (const l of ['Projekte', 'Themen', 'Review', 'Zeitplan', 'Kosten', 'Kennzahlen', 'Einstellungen']) {
      expect(labels).toContain(l)
    }
  })
})
