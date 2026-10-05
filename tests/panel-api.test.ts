import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { createApp, createRouter, toWebHandler } from 'h3'
import { createSecretStore, type SecretRepo } from '../server/utils/secrets'
import {
  createPanelService, type PanelRepo, type ProjectRow, type ScheduleRuleRow
} from '../server/utils/panel-service'
import {
  parseGlobalBudget, parseProjectInput, parseScheduleRules, parseSecretKey, parseSecretValue
} from '../server/utils/validation'
import { isPublicApi } from '../server/utils/access'

const saved = process.env.ENCRYPTION_KEY
beforeEach(() => { process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex') })
afterEach(() => {
  if (saved === undefined) delete process.env.ENCRYPTION_KEY
  else process.env.ENCRYPTION_KEY = saved
})

const PID = '11111111-1111-4111-8111-111111111111'

function memSecretRepo(): SecretRepo & { g: Map<string, string>, p: Map<string, string> } {
  const g = new Map<string, string>()
  const p = new Map<string, string>()
  return {
    g, p,
    getGlobal: async k => g.get(k),
    setGlobal: async (k, v) => { g.set(k, v) },
    deleteGlobal: async (k) => { g.delete(k) },
    listGlobal: async () => [...g].map(([key, valueEnc]) => ({ key, valueEnc })),
    getProject: async (id, k) => p.get(`${id}:${k}`),
    setProject: async (id, k, v) => { p.set(`${id}:${k}`, v) },
    deleteProject: async (id, k) => { p.delete(`${id}:${k}`) },
    listProject: async id => [...p].filter(([k]) => k.startsWith(`${id}:`)).map(([k, valueEnc]) => ({ key: k.slice(id.length + 1), valueEnc }))
  }
}

function memPanelRepo(): PanelRepo {
  const projects = new Map<string, ProjectRow>()
  const rules = new Map<string, ScheduleRuleRow[]>()
  const settings = new Map<string, unknown>()
  let n = 0
  return {
    listProjects: async () => [...projects.values()],
    getProject: async id => projects.get(id),
    insertProject: async (data) => {
      const row = {
        id: PID.replace(/1/g, String(++n)), name: '', niche: '', language: 'de', stylePrompt: '', visualStylePrompt: '',
        heygenAvatarId: null, heygenVoiceId: null, videoProvider: 'heygen', scriptApprovalRequired: true,
        dailyBudgetCents: 300, monthlyBudgetCents: 6000, productionPaused: false, pauseReason: null,
        targetVideoLengthS: 40, topicBatchSize: 20, maxRetries: 3, maxVideosInReview: 3, timezone: 'Europe/Berlin',
        createdAt: new Date(), updatedAt: new Date(), ...data
      } as ProjectRow
      projects.set(row.id, row)
      return row
    },
    updateProject: async (id, data) => {
      const cur = projects.get(id)
      if (!cur) return undefined
      const next = { ...cur, ...data } as ProjectRow
      projects.set(id, next)
      return next
    },
    deleteProject: async id => projects.delete(id),
    listSchedule: async id => rules.get(id) ?? [],
    replaceSchedule: async (id, tz, rs) => {
      rules.set(id, rs.map((r, i) => ({ id: `r${i}`, timezone: tz, ...r })))
    },
    getSetting: async k => settings.get(k),
    setSetting: async (k, v) => { settings.set(k, v) }
  }
}

describe('Projekt-Validierung', () => {
  it('akzeptiert gueltige Eingabe und trimmt Text', () => {
    const r = parseProjectInput({ name: '  Finanzen  ', targetVideoLengthS: 45, language: 'en', scriptApprovalRequired: false }, 'create')
    expect(r).toEqual({ ok: true, data: { name: 'Finanzen', targetVideoLengthS: 45, language: 'en', scriptApprovalRequired: false } })
  })

  it('verlangt Namen beim Anlegen, nicht beim Update', () => {
    expect(parseProjectInput({}, 'create')).toMatchObject({ ok: false, errors: { name: expect.any(String) } })
    expect(parseProjectInput({ niche: 'x' }, 'update')).toMatchObject({ ok: true })
  })

  it.each([29, 46, 40.5, '40', null])('lehnt Ziellaenge %s ab', (v) => {
    expect(parseProjectInput({ name: 'a', targetVideoLengthS: v }, 'create')).toMatchObject({ ok: false, errors: { targetVideoLengthS: expect.any(String) } })
  })

  it('prueft Sprache, Anbieter, Zeitzone, Budgets', () => {
    const r = parseProjectInput({ name: 'a', language: 'xx', videoProvider: 'foo', timezone: 'Mars/Base', dailyBudgetCents: -1, monthlyBudgetCents: 1.5 }, 'create')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['dailyBudgetCents', 'language', 'monthlyBudgetCents', 'timezone', 'videoProvider'])
  })

  it('Tagesbudget darf Monatsbudget nicht uebersteigen', () => {
    expect(parseProjectInput({ name: 'a', dailyBudgetCents: 500, monthlyBudgetCents: 100 }, 'create')).toMatchObject({ ok: false })
  })

  it('leere Avatar-ID wird zu null (avatarlos)', () => {
    expect(parseProjectInput({ heygenAvatarId: '' }, 'update')).toEqual({ ok: true, data: { heygenAvatarId: null } })
  })

  it('ignoriert unbekannte Felder (kein Mass-Assignment) und lehnt leere Updates ab', () => {
    expect(parseProjectInput({ name: 'a', productionPaused: true, id: 'x' }, 'create')).toEqual({ ok: true, data: { name: 'a' } })
    expect(parseProjectInput({ productionPaused: true }, 'update')).toMatchObject({ ok: false })
  })

  it('lehnt Nicht-Objekte ab', () => {
    expect(parseProjectInput(null, 'create').ok).toBe(false)
    expect(parseProjectInput([], 'create').ok).toBe(false)
  })
})

describe('Weitere Validierung', () => {
  it('Zeitplan: Format und Bereiche', () => {
    expect(parseScheduleRules({ rules: [{ weekday: 1, timeLocal: '09:30', videosPerDay: 2 }] })).toEqual({
      ok: true, data: [{ weekday: 1, timeLocal: '09:30', videosPerDay: 2, enabled: true }]
    })
    const bad = parseScheduleRules({ rules: [{ weekday: 7, timeLocal: '25:00', videosPerDay: 0 }] })
    expect(bad.ok).toBe(false)
    expect(parseScheduleRules({}).ok).toBe(false)
  })

  it('Secret-Keys: nur Allowlist, Override nur wo erlaubt', () => {
    expect(parseSecretKey('heygen.apiKey', 'project').ok).toBe(true)
    expect(parseSecretKey('onedrive.clientId', 'global').ok).toBe(true)
    expect(parseSecretKey('onedrive.clientId', 'project').ok).toBe(false)
    expect(parseSecretKey('evil.key', 'global').ok).toBe(false)
  })

  it('Secret-Wert und globales Budget', () => {
    expect(parseSecretValue({ value: '' }).ok).toBe(false)
    expect(parseSecretValue({ value: '  abc  ' })).toEqual({ ok: true, data: 'abc' })
    expect(parseGlobalBudget({ globalMonthlyBudgetCents: 20000 }).ok).toBe(true)
    expect(parseGlobalBudget({ globalMonthlyBudgetCents: -5 }).ok).toBe(false)
    expect(parseGlobalBudget({ globalMonthlyBudgetCents: '5' }).ok).toBe(false)
  })

  it('API-Routen sind nicht in der Allowlist (Deny-by-default)', () => {
    for (const p of ['/api/projects', `/api/projects/${PID}`, '/api/settings', '/api/settings/secrets/heygen.apiKey', '/api/settings/budget']) {
      expect(isPublicApi(p)).toBe(false)
    }
  })
})

describe('Panel-Service (gemockte DB und Secrets)', () => {
  function setup() {
    const secretRepo = memSecretRepo()
    const svc = createPanelService(memPanelRepo(), createSecretStore(secretRepo))
    return { svc, secretRepo }
  }

  it('Secrets werden nur maskiert geliefert, nie im Klartext', async () => {
    const { svc, secretRepo } = setup()
    await svc.setSecret('heygen.apiKey', 'sk-super-geheim-1234')
    const list = await svc.globalSecrets()
    const hey = list.find(s => s.key === 'heygen.apiKey')!
    expect(hey).toMatchObject({ configured: true, masked: '****1234', source: 'global' })
    const json = JSON.stringify(list)
    expect(json).not.toContain('super-geheim')
    // in der Persistenz liegt nur der verschluesselte Wert
    expect(secretRepo.g.get('heygen.apiKey')).not.toContain('super-geheim')
    expect(list.find(s => s.key === 'deepseek.apiKey')).toMatchObject({ configured: false, masked: '', source: null })
  })

  it('Projekt-Override ueberschreibt Standard und Loeschen faellt zurueck', async () => {
    const { svc } = setup()
    const p = await svc.createProject({ name: 'P' })
    await svc.setSecret('deepseek.apiKey', 'global-key-AAAA')
    await svc.setSecret('deepseek.apiKey', 'projekt-key-BBBB', p.id)
    let ds = (await svc.projectSecrets(p.id)).find(s => s.key === 'deepseek.apiKey')!
    expect(ds).toMatchObject({ source: 'project', masked: '****BBBB' })
    await svc.deleteSecret('deepseek.apiKey', p.id)
    ds = (await svc.projectSecrets(p.id)).find(s => s.key === 'deepseek.apiKey')!
    expect(ds).toMatchObject({ source: 'global', masked: '****AAAA' })
    expect((await svc.projectSecrets(p.id)).some(s => s.key.startsWith('onedrive'))).toBe(false)
  })

  it('Secret fuer unbekanntes Projekt -> 404', async () => {
    const { svc } = setup()
    await expect(svc.setSecret('heygen.apiKey', 'x-1234567890', PID)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('Projekt CRUD mit Standardwerten', async () => {
    const { svc } = setup()
    const p = await svc.createProject({ name: 'Mein Kanal', targetVideoLengthS: 35 })
    expect(p).toMatchObject({ scriptApprovalRequired: true, heygenAvatarId: null, targetVideoLengthS: 35 })
    const u = await svc.updateProject(p.id, { niche: 'Finanzen', heygenAvatarId: 'av-1' })
    expect(u).toMatchObject({ niche: 'Finanzen', heygenAvatarId: 'av-1', name: 'Mein Kanal' })
    expect(await svc.listProjects()).toHaveLength(1)
    await svc.deleteProject(p.id)
    await expect(svc.getProject(p.id)).rejects.toMatchObject({ statusCode: 404 })
    await expect(svc.deleteProject(p.id)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('Teil-Update prueft Budget gegen gespeicherten Wert', async () => {
    const { svc } = setup()
    const p = await svc.createProject({ name: 'P', monthlyBudgetCents: 1000, dailyBudgetCents: 100 })
    await expect(svc.updateProject(p.id, { dailyBudgetCents: 5000 })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('Wochenplan ersetzen und globales Monatslimit (Standard 15000)', async () => {
    const { svc } = setup()
    const p = await svc.createProject({ name: 'P', timezone: 'Europe/Vienna' })
    const rs = await svc.setSchedule(p.id, [{ weekday: 2, timeLocal: '10:00', videosPerDay: 1, enabled: true }])
    expect(rs).toHaveLength(1)
    expect(rs[0]!.timezone).toBe('Europe/Vienna')
    expect(await svc.getGlobalBudget()).toBe(15000)
    await svc.setGlobalBudget(20000)
    expect(await svc.getGlobalBudget()).toBe(20000)
  })
})

describe('HTTP-Handler (h3, Service gemockt)', () => {
  it('liefert 400 mit Feldfehlern bei ungueltiger Eingabe und 201 bei Erfolg', async () => {
    const svc = createPanelService(memPanelRepo(), createSecretStore(memSecretRepo()))
    vi.resetModules()
    vi.doMock('../server/utils/panel-service', () => ({ panelService: () => svc }))
    const post = (await import('../server/api/projects/index.post')).default
    const put = (await import('../server/api/settings/secrets/[key].put')).default
    const get = (await import('../server/api/settings/index.get')).default
    const router = createRouter()
    router.post('/api/projects', post)
    router.put('/api/settings/secrets/:key', put)
    router.get('/api/settings', get)
    const handler = toWebHandler(createApp().use(router))
    const req = (method: string, path: string, body?: unknown) =>
      handler(new Request(`http://localhost${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }))

    const bad = await req('POST', '/api/projects', { name: 'x', targetVideoLengthS: 10 })
    expect(bad.status).toBe(400)
    expect((await bad.json()).data.errors.targetVideoLengthS).toBeTruthy()

    const ok = await req('POST', '/api/projects', { name: 'x', targetVideoLengthS: 30 })
    expect(ok.status).toBe(201)

    expect((await req('PUT', '/api/settings/secrets/unknown.key', { value: 'abc' })).status).toBe(400)
    const set = await req('PUT', '/api/settings/secrets/heygen.apiKey', { value: 'sk-test-abcdef99' })
    expect(set.status).toBe(200)
    const text = await set.text()
    expect(text).not.toContain('sk-test-abcdef99')
    expect(text).toContain('****ef99')

    const settings = await (await req('GET', '/api/settings')).text()
    expect(settings).not.toContain('sk-test')
    expect(settings).toContain('"globalMonthlyBudgetCents":15000')
    vi.doUnmock('../server/utils/panel-service')
  })
})
