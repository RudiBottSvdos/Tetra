import { describe, it, expect, vi } from 'vitest'
import {
  createNotificationService, createCostAlertHook, type NotificationRepo, type NotificationRecord, type NotificationChannel
} from '../server/domain/notifications'
import { BudgetExceededError } from '../server/domain/cost-guard'
import { withBudgetPause, type BudgetPauseDeps } from '../server/queue/with-budget-pause'
import { toPanelNotification } from '../server/utils/notification-dto'
import { isPublicApi } from '../server/utils/access'

function memRepo(): NotificationRepo & { rows: NotificationRecord[] } {
  const rows: NotificationRecord[] = []
  let n = 0
  return {
    rows,
    findByDedupeKey: async k => rows.find(r => r.dedupeKey === k),
    insert: async (x) => {
      if (x.dedupeKey && rows.some(r => r.dedupeKey === x.dedupeKey)) return undefined
      const r: NotificationRecord = { id: `n${++n}`, readAt: null, resolvedAt: null, createdAt: new Date(2026, 9, 5, 0, 0, n), ...x }
      rows.push(r)
      return r
    },
    listUnread: async limit => rows.filter(r => !r.readAt).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit),
    markRead: async (id, at) => {
      const r = rows.find(x => x.id === id)
      if (r && !r.readAt) r.readAt = at
      return r
    }
  }
}

describe('Notification-Service', () => {
  it('create ist ueber dedupe_key idempotent', async () => {
    const svc = createNotificationService({ repo: memRepo() })
    const a = await svc.create({ type: 'info', message: 'x', dedupeKey: 'k' })
    const b = await svc.create({ type: 'info', message: 'y', dedupeKey: 'k' })
    expect(a.created).toBe(true)
    expect(b.created).toBe(false)
    expect(b.notification.id).toBe(a.notification.id)
    expect((await svc.listUnread()).length).toBe(1)
  })

  it('Standard-Severity je Typ, ohne dedupe_key immer neu', async () => {
    const svc = createNotificationService({ repo: memRepo() })
    expect((await svc.create({ type: 'budget_pause', message: 'a' })).notification.severity).toBe('error')
    expect((await svc.create({ type: 'cost_alert', message: 'a' })).notification.severity).toBe('warning')
    await svc.create({ type: 'info', message: 'a' })
    expect((await svc.listUnread()).length).toBe(3)
  })

  it('dismiss blendet aus, ist idempotent, unbekannte ID -> undefined', async () => {
    const svc = createNotificationService({ repo: memRepo() })
    const { notification } = await svc.create({ type: 'error', message: 'boom' })
    expect(await svc.dismiss(notification.id)).toBeDefined()
    expect(await svc.dismiss(notification.id)).toBeDefined()
    expect(await svc.listUnread()).toEqual([])
    expect(await svc.dismiss('nope')).toBeUndefined()
  })

  it('Kanalfehler kippen create nicht; Kanal wird nur bei neuer Notification gerufen', async () => {
    const deliver = vi.fn().mockRejectedValue(new Error('smtp down'))
    const ch: NotificationChannel = { name: 't', deliver }
    const svc = createNotificationService({ repo: memRepo(), channels: [ch] })
    await expect(svc.create({ type: 'info', message: 'x', dedupeKey: 'k' })).resolves.toMatchObject({ created: true })
    await svc.create({ type: 'info', message: 'x', dedupeKey: 'k' })
    expect(deliver).toHaveBeenCalledTimes(1)
  })
})

describe('CostAlertHook-Adapter', () => {
  const ev = (threshold: number) => ({
    scope: 'day' as const, projectId: 'p1', threshold, usedCents: 240, limitCents: 300,
    windowStart: new Date('2026-10-04T22:00:00Z'), windowEnd: new Date('2026-10-05T22:00:00Z')
  })

  it('80 % = warning, 100 % = error, Wiederholung dedupliziert', async () => {
    const repo = memRepo()
    const hook = createCostAlertHook(createNotificationService({ repo }))
    await hook.onAlert(ev(80))
    await hook.onAlert(ev(80))
    await hook.onAlert(ev(100))
    expect(repo.rows.map(r => [r.type, r.severity])).toEqual([['cost_alert', 'warning'], ['cost_alert', 'error']])
    expect(repo.rows[0]!.message).toContain('80 %')
    expect(repo.rows[0]!.projectId).toBe('p1')
  })
})

describe('withBudgetPause', () => {
  function deps() {
    const repo = memRepo()
    const d: BudgetPauseDeps & { pauseProject: ReturnType<typeof vi.fn>, pauseVideo: ReturnType<typeof vi.fn> } = {
      notifications: createNotificationService({ repo }),
      pauseProject: vi.fn().mockResolvedValue(undefined),
      pauseVideo: vi.fn().mockResolvedValue(undefined)
    }
    return { d, repo }
  }
  const boom = () => new BudgetExceededError('day', 300, 290, 50, 'p1')

  it('gibt Wert durch, wenn kein Budgetfehler', async () => {
    const { d } = deps()
    expect(await withBudgetPause({ projectId: 'p1' }, async () => 42, d)).toEqual({ paused: false, value: 42 })
    expect(d.pauseProject).not.toHaveBeenCalled()
  })

  it('pausiert Projekt + Video und erzeugt Notification (einmal pro Tag/Scope)', async () => {
    const { d, repo } = deps()
    const run = () => withBudgetPause({ projectId: 'p1', videoId: 'v1', videoStatus: 'rendering' }, async () => { throw boom() }, d)
    const r = await run()
    await run()
    expect(r.paused).toBe(true)
    expect(d.pauseProject).toHaveBeenCalledWith('p1', expect.stringContaining('Tagesbudget'))
    expect(d.pauseVideo).toHaveBeenCalledWith('v1', 'rendering', expect.any(String))
    expect(repo.rows).toHaveLength(1)
    expect(repo.rows[0]).toMatchObject({ type: 'budget_pause', projectId: 'p1', severity: 'error' })
  })

  it('Video-Pause-Fehler wird toleriert; andere Fehler werden weitergeworfen', async () => {
    const { d } = deps()
    d.pauseVideo.mockRejectedValue(new Error('invalid transition'))
    const r = await withBudgetPause({ projectId: 'p1', videoId: 'v1', videoStatus: 'uploading' }, async () => { throw boom() }, d)
    expect(r.paused).toBe(true)
    await expect(withBudgetPause({ projectId: 'p1' }, async () => { throw new Error('other') }, d)).rejects.toThrow('other')
  })
})

describe('API-Form und Schutz', () => {
  it('DTO mappt Typ auf Titel/Aktion, unbekannter Typ -> info', () => {
    const base = { id: 'i', projectId: null, severity: 'info', message: 'm', dedupeKey: null, readAt: null, resolvedAt: null, createdAt: new Date('2026-10-05T00:00:00Z') }
    expect(toPanelNotification({ ...base, type: 'cost_alert' })).toMatchObject({ type: 'cost_alert', title: 'Kostenalarm', actionTo: '/costs' })
    expect(toPanelNotification({ ...base, type: 'weird' })).toMatchObject({ type: 'info' })
  })

  it('/api/notifications ist nicht oeffentlich (deny-by-default)', () => {
    expect(isPublicApi('/api/notifications')).toBe(false)
    expect(isPublicApi('/api/notifications/abc')).toBe(false)
  })
})
