import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { createGoogleOAuth, OAuthStateError, type ChannelTokenPatch, type ChannelTokenRepo, type ChannelTokenRow } from '../server/oauth/google'
import { AuthExpiredError, PermanentError, RetryableError } from '../server/providers/errors'
import { decrypt, encrypt } from '../server/utils/crypto'
import { brokenJsonResponse, jsonResponse } from './helpers/mocks'

const KEY = randomBytes(32).toString('hex')
const saved = process.env.ENCRYPTION_KEY
const P = '11111111-1111-4111-8111-111111111111'
const U = 'user-1'
const SECRETS = ['ACCESS-OLD-SECRET', 'REFRESH-OLD-SECRET', 'ACCESS-NEW-SECRET', 'REFRESH-NEW-SECRET', 'client-secret-xyz']

beforeEach(() => { process.env.ENCRYPTION_KEY = KEY })
afterEach(() => {
  vi.unstubAllGlobals()
  if (saved === undefined) delete process.env.ENCRYPTION_KEY
  else process.env.ENCRYPTION_KEY = saved
})

function memRepo() {
  const rows = new Map<string, ChannelTokenRow>()
  let seq = 0
  const repo: ChannelTokenRepo = {
    get: async id => rows.get(id),
    projectExists: async id => id === P,
    update: async (id, patch: ChannelTokenPatch) => { rows.set(id, { ...rows.get(id)!, ...patch }) },
    upsertConnected: async ({ projectId, channelId, externalId, displayName, patch }) => {
      const hit = [...rows.values()].find(r => r.id === channelId || (r.projectId === projectId && r.externalId === externalId))
      const id = hit?.id ?? `c${++seq}`
      rows.set(id, { id, projectId, displayName, externalId, accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, scopes: null, status: 'connected', ...hit, ...patch })
      return id
    }
  }
  return { repo, rows }
}

function setup(opts: { now?: () => number, onExpired?: () => void } = {}) {
  const { repo, rows } = memRepo()
  const fetchMock = vi.fn()
  const oauth = createGoogleOAuth({
    repo,
    getCredentials: async () => ({ clientId: 'cid', clientSecret: 'client-secret-xyz' }),
    redirectUri: () => 'https://panel.example/api/oauth/google/callback',
    fetch: fetchMock as unknown as typeof fetch,
    now: opts.now,
    onExpired: opts.onExpired
  })
  return { oauth, rows, repo, fetchMock }
}
type OAuth = ReturnType<typeof setup>['oauth']

async function authorize(oauth: OAuth, extra: { channelId?: string } = {}) {
  const { url, nonce } = await oauth.createAuthorization({ projectId: P, userId: U, ...extra })
  const u = new URL(url)
  return { u, nonce, state: u.searchParams.get('state')! }
}

const tokenOk = (o: Record<string, unknown> = {}) =>
  jsonResponse({ access_token: 'ACCESS-NEW-SECRET', refresh_token: 'REFRESH-NEW-SECRET', expires_in: 3600, scope: 'a b', ...o })
const channelsOk = () => jsonResponse({ items: [{ id: 'UC123', snippet: { title: 'Mein Kanal' } }] })

function seedConnected(rows: Map<string, ChannelTokenRow>, expiresInMs: number, status = 'connected') {
  rows.set('ch1', {
    id: 'ch1', projectId: P, displayName: 'K', externalId: 'UC123',
    accessTokenEnc: encrypt('ACCESS-OLD-SECRET'), refreshTokenEnc: encrypt('REFRESH-OLD-SECRET'),
    tokenExpiresAt: new Date(Date.now() + expiresInMs), scopes: 'a', status
  })
}

describe('Authorization-URL', () => {
  it('enthaelt PKCE, offline, consent, Scopes, state', async () => {
    const { oauth } = setup()
    const { u, nonce, state } = await authorize(oauth)
    const sp = u.searchParams
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(sp.get('access_type')).toBe('offline')
    expect(sp.get('prompt')).toBe('consent')
    expect(sp.get('response_type')).toBe('code')
    expect(sp.get('code_challenge_method')).toBe('S256')
    expect(sp.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(sp.get('scope')).toContain('youtube.upload')
    expect(sp.get('scope')).toContain('youtube.readonly')
    expect(sp.get('redirect_uri')).toBe('https://panel.example/api/oauth/google/callback')
    expect(state.length).toBeGreaterThan(40)
    expect(nonce.length).toBeGreaterThan(20)
    expect(u.toString()).not.toContain('client-secret-xyz')
  })

  it('lehnt unbekanntes Projekt ab', async () => {
    const { oauth } = setup()
    await expect(oauth.createAuthorization({ projectId: 'x', userId: U })).rejects.toBeInstanceOf(PermanentError)
  })
})

describe('state-Validierung', () => {
  it('fehlend', async () => {
    const { oauth, fetchMock } = setup()
    await expect(oauth.handleCallback({ code: 'c', cookieNonce: 'n', sessionUserId: U })).rejects.toMatchObject({ code: 'missing' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('manipuliert / Muell / fremder Schluessel', async () => {
    const { oauth, fetchMock } = setup()
    const { state, nonce } = await authorize(oauth)
    const tampered = state.slice(0, -4) + (state.endsWith('AAAA') ? 'BBBB' : 'AAAA')
    await expect(oauth.handleCallback({ code: 'c', state: tampered, cookieNonce: nonce, sessionUserId: U })).rejects.toMatchObject({ code: 'invalid' })
    await expect(oauth.handleCallback({ code: 'c', state: 'garbage', cookieNonce: nonce, sessionUserId: U })).rejects.toBeInstanceOf(OAuthStateError)
    const forged = Buffer.from(encrypt(JSON.stringify({ n: nonce, v: 'v', exp: Date.now() + 1e6, projectId: P, userId: U }), randomBytes(32))).toString('base64url')
    await expect(oauth.handleCallback({ code: 'c', state: forged, cookieNonce: nonce, sessionUserId: U })).rejects.toMatchObject({ code: 'invalid' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('abgelaufen (> 10 min)', async () => {
    let t = 1_000_000
    const { oauth, fetchMock } = setup({ now: () => t })
    const { state, nonce } = await authorize(oauth)
    t += 10 * 60 * 1000 + 1
    await expect(oauth.handleCallback({ code: 'c', state, cookieNonce: nonce, sessionUserId: U })).rejects.toMatchObject({ code: 'expired' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Cookie fehlt/falsch und fremde Session werden abgewiesen', async () => {
    const { oauth, fetchMock } = setup()
    const { state, nonce } = await authorize(oauth)
    await expect(oauth.handleCallback({ code: 'c', state, sessionUserId: U })).rejects.toMatchObject({ code: 'mismatch' })
    await expect(oauth.handleCallback({ code: 'c', state, cookieNonce: nonce + 'x', sessionUserId: U })).rejects.toMatchObject({ code: 'mismatch' })
    await expect(oauth.handleCallback({ code: 'c', state, cookieNonce: nonce, sessionUserId: 'other' })).rejects.toMatchObject({ code: 'mismatch' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Code-Exchange und Kanalverbindung', () => {
  it('tauscht Code mit PKCE-Verifier, speichert verschluesselt, liest Kanalinfos', async () => {
    const { oauth, rows, fetchMock } = setup()
    const { state, nonce, u } = await authorize(oauth)
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(channelsOk())
    const r = await oauth.handleCallback({ code: 'CODE', state, cookieNonce: nonce, sessionUserId: U })
    expect(r).toEqual({ channelId: 'c1', projectId: P, displayName: 'Mein Kanal', externalId: 'UC123' })

    const body = (fetchMock.mock.calls[0]![1] as { body: URLSearchParams }).body
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('CODE')
    const verifier = body.get('code_verifier')!
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(u.searchParams.get('code_challenge'))
    expect(u.toString()).not.toContain(verifier)
    expect(String(fetchMock.mock.calls[1]![0])).toContain('channels?part=snippet&mine=true')

    const row = rows.get('c1')!
    expect(row.accessTokenEnc).not.toContain('ACCESS-NEW-SECRET')
    expect(row.refreshTokenEnc).not.toContain('REFRESH-NEW-SECRET')
    expect(decrypt(row.accessTokenEnc!)).toBe('ACCESS-NEW-SECRET')
    expect(decrypt(row.refreshTokenEnc!)).toBe('REFRESH-NEW-SECRET')
    expect(row.status).toBe('connected')
    expect(JSON.stringify(r)).not.toMatch(/SECRET/)
  })

  it('ohne Refresh-Token: Fehler, nichts gespeichert', async () => {
    const { oauth, rows, fetchMock } = setup()
    const { state, nonce } = await authorize(oauth)
    fetchMock.mockResolvedValueOnce(tokenOk({ refresh_token: undefined }))
    await expect(oauth.handleCallback({ code: 'c', state, cookieNonce: nonce, sessionUserId: U })).rejects.toMatchObject({ code: 'no_refresh_token' })
    expect(rows.size).toBe(0)
  })

  it('Reconnect eines anderen Kanals wird abgelehnt', async () => {
    const { oauth, rows, fetchMock } = setup()
    seedConnected(rows, 1000)
    rows.get('ch1')!.externalId = 'UC-OTHER'
    const { state, nonce } = await authorize(oauth, { channelId: 'ch1' })
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(channelsOk())
    await expect(oauth.handleCallback({ code: 'c', state, cookieNonce: nonce, sessionUserId: U })).rejects.toMatchObject({ code: 'channel_mismatch' })
  })

  it('Reconnect setzt expired zurueck auf connected', async () => {
    const { oauth, rows, fetchMock } = setup()
    seedConnected(rows, -1000, 'expired')
    const { state, nonce } = await authorize(oauth, { channelId: 'ch1' })
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(channelsOk())
    await oauth.handleCallback({ code: 'c', state, cookieNonce: nonce, sessionUserId: U })
    expect(rows.get('ch1')!.status).toBe('connected')
  })

  it('Fehlerklassen des Token-Endpunkts', async () => {
    const { oauth, fetchMock } = setup()
    const run = async (res: Response | Error) => {
      const { state, nonce } = await authorize(oauth)
      if (res instanceof Error) fetchMock.mockRejectedValueOnce(res)
      else fetchMock.mockResolvedValueOnce(res)
      return oauth.handleCallback({ code: 'c', state, cookieNonce: nonce, sessionUserId: U })
    }
    await expect(run(jsonResponse({ error: 'invalid_client' }, 401))).rejects.toMatchObject({ kind: 'permanent', code: 'invalid_client' })
    await expect(run(jsonResponse({}, 503))).rejects.toBeInstanceOf(RetryableError)
    await expect(run(brokenJsonResponse(200))).rejects.toBeInstanceOf(RetryableError)
    await expect(run(new Error('boom'))).rejects.toBeInstanceOf(RetryableError)
  })
})

describe('getAccessToken / Refresh', () => {
  it('gueltiges Token ohne Netzwerk', async () => {
    const { oauth, rows, fetchMock } = setup()
    seedConnected(rows, 3_600_000)
    expect(await oauth.getAccessToken('ch1')).toBe('ACCESS-OLD-SECRET')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('abgelaufen: Refresh, verschluesselt gespeichert; Refresh-Token bleibt ohne Rotation', async () => {
    const { oauth, rows, fetchMock } = setup()
    seedConnected(rows, -1000)
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'ACCESS-NEW-SECRET', expires_in: 3600 }))
    expect(await oauth.getAccessToken('ch1')).toBe('ACCESS-NEW-SECRET')
    const body = (fetchMock.mock.calls[0]![1] as { body: URLSearchParams }).body
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('REFRESH-OLD-SECRET')
    const row = rows.get('ch1')!
    expect(decrypt(row.accessTokenEnc!)).toBe('ACCESS-NEW-SECRET')
    expect(decrypt(row.refreshTokenEnc!)).toBe('REFRESH-OLD-SECRET')
    expect(row.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 3_000_000)
  })

  it('Token knapp vor Ablauf (< 60 s) wird refresht', async () => {
    const { oauth, rows, fetchMock } = setup()
    seedConnected(rows, 30_000)
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'ACCESS-NEW-SECRET', expires_in: 3600 }))
    await oauth.getAccessToken('ch1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('Rotation: neues Refresh-Token ersetzt das alte', async () => {
    const { oauth, rows, fetchMock } = setup()
    seedConnected(rows, -1000)
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'ACCESS-NEW-SECRET', refresh_token: 'REFRESH-NEW-SECRET', expires_in: 3600 }))
    await oauth.getAccessToken('ch1')
    expect(decrypt(rows.get('ch1')!.refreshTokenEnc!)).toBe('REFRESH-NEW-SECRET')
  })

  it('parallele Aufrufe loesen genau einen Refresh aus', async () => {
    const { oauth, rows, fetchMock } = setup()
    seedConnected(rows, -1000)
    let release!: () => void
    fetchMock.mockImplementation(() => new Promise<Response>((res) => {
      release = () => res(jsonResponse({ access_token: 'ACCESS-NEW-SECRET', refresh_token: 'REFRESH-NEW-SECRET', expires_in: 3600 }))
    }))
    const all = Promise.all([oauth.getAccessToken('ch1'), oauth.getAccessToken('ch1'), oauth.getAccessToken('ch1')])
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    release()
    expect(await all).toEqual(['ACCESS-NEW-SECRET', 'ACCESS-NEW-SECRET', 'ACCESS-NEW-SECRET'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('invalid_grant: Kanal expired, AuthExpiredError, Folgeaufrufe ohne Netzwerk, Hook gerufen', async () => {
    const onExpired = vi.fn()
    const { oauth, rows, fetchMock } = setup({ onExpired })
    seedConnected(rows, -1000)
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400))
    await expect(oauth.getAccessToken('ch1')).rejects.toBeInstanceOf(AuthExpiredError)
    expect(rows.get('ch1')!.status).toBe('expired')
    expect(onExpired).toHaveBeenCalledWith('ch1', P)
    await expect(oauth.getAccessToken('ch1')).rejects.toBeInstanceOf(AuthExpiredError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('transiente Fehler lassen den Kanal verbunden und geben den Lock frei', async () => {
    const { oauth, rows, fetchMock } = setup()
    seedConnected(rows, -1000)
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500))
    await expect(oauth.getAccessToken('ch1')).rejects.toBeInstanceOf(RetryableError)
    expect(rows.get('ch1')!.status).toBe('connected')
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'ACCESS-NEW-SECRET', expires_in: 3600 }))
    expect(await oauth.getAccessToken('ch1')).toBe('ACCESS-NEW-SECRET')
  })

  it('unbekannter Kanal', async () => {
    const { oauth } = setup()
    await expect(oauth.getAccessToken('nope')).rejects.toBeInstanceOf(PermanentError)
  })
})

describe('keine Token-Leaks', () => {
  it('Fehlermeldungen, Ergebnisse und Logs enthalten keine Secrets', async () => {
    const logs: string[] = []
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m =>
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')) }))
    const { oauth, rows, fetchMock } = setup()
    const messages: string[] = []
    const collect = async (p: Promise<unknown>) => {
      try { messages.push(JSON.stringify(await p)) } catch (e) { messages.push(String((e as Error).message), JSON.stringify(e)) }
    }

    seedConnected(rows, -1000)
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant', error_description: 'REFRESH-OLD-SECRET revoked' }, 400))
    await collect(oauth.getAccessToken('ch1'))

    const b = await authorize(oauth)
    messages.push(b.u.toString())
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_client', error_description: 'client-secret-xyz bad' }, 401))
    await collect(oauth.handleCallback({ code: 'c', state: b.state, cookieNonce: b.nonce, sessionUserId: U }))

    const a = await authorize(oauth)
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(channelsOk())
    await collect(oauth.handleCallback({ code: 'c', state: a.state, cookieNonce: a.nonce, sessionUserId: U }))

    for (const s of spies) s.mockRestore()
    for (const text of [...messages, ...logs]) for (const secret of SECRETS) expect(text).not.toContain(secret)
  })
})
