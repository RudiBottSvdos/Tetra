import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { decrypt, encrypt } from '../utils/crypto'
import { AuthExpiredError, PermanentError, RateLimitError, RetryableError } from '../providers/errors'

// Google-OAuth fuer YouTube-Kanaele (WP3.1). Alle Abhaengigkeiten (DB, Secrets, fetch, Uhr) sind
// injizierbar; ohne echte Credentials vollstaendig mit gemocktem fetch testbar.

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const YOUTUBE_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels'
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly'
] as const
export const GOOGLE_STATE_COOKIE = 'oauth_google_state'
export const STATE_TTL_MS = 10 * 60 * 1000
/** Access-Token gilt als abgelaufen, sobald weniger als diese Zeit verbleibt. */
export const REFRESH_SKEW_MS = 60 * 1000
const PROVIDER = 'youtube'
const HTTP_TIMEOUT_MS = 15000

export interface ChannelTokenRow {
  id: string
  projectId: string
  displayName: string
  externalId: string | null
  accessTokenEnc: string | null
  refreshTokenEnc: string | null
  tokenExpiresAt: Date | null
  scopes: string | null
  status: string
}

export interface ChannelTokenPatch {
  displayName?: string
  externalId?: string
  accessTokenEnc?: string | null
  refreshTokenEnc?: string | null
  tokenExpiresAt?: Date | null
  scopes?: string | null
  status?: 'connected' | 'expired'
}

/** Persistenz fuer YouTube-Kanaele (in Tests durch In-Memory ersetzbar). Tokens sind hier immer bereits verschluesselt. */
export interface ChannelTokenRepo {
  get(channelId: string): Promise<ChannelTokenRow | undefined>
  /** Bestehenden Kanal (project+youtube+externalId) finden, sonst anlegen. Liefert die Kanal-ID. */
  upsertConnected(input: { projectId: string, channelId?: string, externalId: string, displayName: string, patch: ChannelTokenPatch }): Promise<string>
  update(channelId: string, patch: ChannelTokenPatch): Promise<void>
  projectExists(projectId: string): Promise<boolean>
}

export const drizzleChannelRepo: ChannelTokenRepo = {
  async get(channelId) {
    const { useDb, schema } = await import('../db')
    const [r] = await useDb().select().from(schema.channel).where(eq(schema.channel.id, channelId))
    return r
  },
  async projectExists(projectId) {
    const { useDb, schema } = await import('../db')
    const [r] = await useDb().select({ id: schema.project.id }).from(schema.project).where(eq(schema.project.id, projectId))
    return !!r
  },
  async update(channelId, patch) {
    const { useDb, schema } = await import('../db')
    await useDb().update(schema.channel).set({ ...patch, updatedAt: new Date() }).where(eq(schema.channel.id, channelId))
  },
  async upsertConnected({ projectId, channelId, externalId, displayName, patch }) {
    const { useDb, schema } = await import('../db')
    const t = schema.channel
    const db = useDb()
    return db.transaction(async (tx) => {
      let existing: { id: string } | undefined
      if (channelId) {
        [existing] = await tx.select({ id: t.id }).from(t).where(and(eq(t.id, channelId), eq(t.projectId, projectId), eq(t.platform, 'youtube')))
      }
      if (!existing) {
        [existing] = await tx.select({ id: t.id }).from(t).where(and(eq(t.projectId, projectId), eq(t.platform, 'youtube'), eq(t.externalId, externalId)))
      }
      if (existing) {
        await tx.update(t).set({ ...patch, displayName, externalId, updatedAt: new Date() }).where(eq(t.id, existing.id))
        return existing.id
      }
      const [row] = await tx.insert(t).values({ ...patch, projectId, platform: 'youtube', displayName, externalId }).returning({ id: t.id })
      return row!.id
    })
  }
}

export interface GoogleCredentials { clientId: string, clientSecret: string }

export interface GoogleOAuthDeps {
  repo: ChannelTokenRepo
  getCredentials: () => Promise<GoogleCredentials>
  /** Absolute Redirect-URI (aus Konfiguration, nie aus Request-Headern). */
  redirectUri: () => string
  now?: () => number
  fetch?: typeof fetch
  /** Hook fuer Notifications (WP5.x): wird bei invalid_grant nach dem Markieren aufgerufen. */
  onExpired?: (channelId: string, projectId: string) => Promise<void> | void
}

export interface StateContext {
  projectId: string
  userId: string
  /** Gesetzt beim erneuten Verbinden eines bestehenden Kanals. */
  channelId?: string
}

interface StatePayload extends StateContext {
  /** Nonce, zusaetzlich im httpOnly-Cookie (Bindung an den Browser). */
  n: string
  /** PKCE code_verifier (nur verschluesselt im state, nie im Klartext in der URL). */
  v: string
  exp: number
}

export type StateErrorCode = 'missing' | 'invalid' | 'expired' | 'mismatch'
export class OAuthStateError extends Error {
  readonly code: StateErrorCode
  constructor(code: StateErrorCode) {
    super(`OAuth state ${code}`)
    this.name = 'OAuthStateError'
    this.code = code
  }
}

const b64url = (b: Buffer) => b.toString('base64url')

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
}

export function createGoogleOAuth(deps: GoogleOAuthDeps) {
  const now = deps.now ?? (() => Date.now())
  const doFetch: typeof fetch = (...a) => (deps.fetch ?? globalThis.fetch)(...a)
  const inflight = new Map<string, Promise<string>>()

  /** Authentifizierter, integritaetsgeschuetzter state (AES-GCM: Manipulation => Entschluesselung scheitert). */
  function buildState(ctx: StateContext): { state: string, nonce: string, codeChallenge: string } {
    const verifier = b64url(randomBytes(48))
    const nonce = b64url(randomBytes(24))
    const payload: StatePayload = { ...ctx, n: nonce, v: verifier, exp: now() + STATE_TTL_MS }
    return {
      state: Buffer.from(encrypt(JSON.stringify(payload))).toString('base64url'),
      nonce,
      codeChallenge: b64url(createHash('sha256').update(verifier).digest())
    }
  }

  function openState(state: string | undefined, cookieNonce: string | undefined, sessionUserId?: string): StatePayload {
    if (!state) throw new OAuthStateError('missing')
    let p: StatePayload
    try {
      p = JSON.parse(decrypt(Buffer.from(state, 'base64url').toString('utf8'))) as StatePayload
    } catch {
      throw new OAuthStateError('invalid')
    }
    if (typeof p?.n !== 'string' || typeof p.v !== 'string' || typeof p.exp !== 'number' || typeof p.projectId !== 'string') {
      throw new OAuthStateError('invalid')
    }
    if (p.exp < now()) throw new OAuthStateError('expired')
    if (!cookieNonce || !safeEqual(cookieNonce, p.n)) throw new OAuthStateError('mismatch')
    if (sessionUserId !== undefined && sessionUserId !== p.userId) throw new OAuthStateError('mismatch')
    return p
  }

  async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
    const { clientId, clientSecret } = await deps.getCredentials()
    let res: Response
    try {
      res = await doFetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
      })
    } catch (err) {
      throw new RetryableError('Google-Token-Endpunkt nicht erreichbar', PROVIDER, 'network', err)
    }
    let body: TokenResponse = {}
    try {
      body = (await res.json()) as TokenResponse
    } catch {
      if (res.ok) throw new RetryableError('Ungueltige Antwort des Google-Token-Endpunkts', PROVIDER, 'bad_json')
    }
    if (res.ok) {
      if (!body.access_token || typeof body.expires_in !== 'number') {
        throw new PermanentError('Unvollstaendige Token-Antwort von Google', PROVIDER, 'bad_response')
      }
      return body
    }
    // Nur den Fehlercode weitergeben, nie den Body.
    const code = typeof body.error === 'string' ? body.error.slice(0, 64) : `http_${res.status}`
    if (code === 'invalid_grant') throw new AuthExpiredError(PROVIDER)
    if (res.status === 429) throw new RateLimitError(PROVIDER, Number(res.headers.get('retry-after')) || 60)
    if (res.status >= 500) throw new RetryableError(`Google-Token-Endpunkt Fehler (${res.status})`, PROVIDER, code)
    throw new PermanentError(`Google-Token-Anfrage abgelehnt (${code})`, PROVIDER, code)
  }

  async function fetchChannelInfo(accessToken: string): Promise<{ id: string, title: string }> {
    let res: Response
    try {
      res = await doFetch(`${YOUTUBE_CHANNELS_URL}?part=snippet&mine=true`, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
      })
    } catch (err) {
      throw new RetryableError('YouTube channels.list nicht erreichbar', PROVIDER, 'network', err)
    }
    if (res.status === 401) throw new AuthExpiredError(PROVIDER)
    if (res.status === 429) throw new RateLimitError(PROVIDER, Number(res.headers.get('retry-after')) || 60)
    if (res.status >= 500) throw new RetryableError(`YouTube channels.list Fehler (${res.status})`, PROVIDER)
    if (!res.ok) throw new PermanentError(`YouTube channels.list abgelehnt (${res.status})`, PROVIDER, `http_${res.status}`)
    const body = await res.json().catch(() => ({})) as { items?: Array<{ id?: string, snippet?: { title?: string } }> }
    const item = body.items?.[0]
    if (!item?.id) throw new PermanentError('Zum Google-Konto gehoert kein YouTube-Kanal', PROVIDER, 'no_channel')
    return { id: item.id, title: item.snippet?.title?.trim() || item.id }
  }

  return {
    /** Erzeugt Authorization-URL + Cookie-Nonce. Der Aufrufer setzt das Cookie (httpOnly, 10 min) und leitet um. */
    async createAuthorization(ctx: StateContext): Promise<{ url: string, nonce: string }> {
      if (!(await deps.repo.projectExists(ctx.projectId))) throw new PermanentError('Projekt nicht gefunden', PROVIDER, 'project_not_found')
      const { clientId } = await deps.getCredentials()
      const { state, nonce, codeChallenge } = buildState(ctx)
      const u = new URL(GOOGLE_AUTH_URL)
      u.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: deps.redirectUri(),
        response_type: 'code',
        scope: GOOGLE_SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      }).toString()
      return { url: u.toString(), nonce }
    },

    /** Validiert state (Signatur/Ablauf/Cookie/Session), tauscht Code, speichert Kanal. Liefert nur unkritische Felder. */
    async handleCallback(input: { code?: string, state?: string, cookieNonce?: string, sessionUserId?: string }): Promise<{ channelId: string, projectId: string, displayName: string, externalId: string }> {
      const p = openState(input.state, input.cookieNonce, input.sessionUserId)
      if (!input.code) throw new OAuthStateError('missing')
      const tok = await tokenRequest({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: deps.redirectUri(),
        code_verifier: p.v
      })
      if (!tok.refresh_token) {
        throw new PermanentError('Google lieferte kein Refresh-Token (Zugriff in den Google-Kontoeinstellungen entfernen und erneut verbinden)', PROVIDER, 'no_refresh_token')
      }
      const info = await fetchChannelInfo(tok.access_token!)
      if (p.channelId) {
        const existing = await deps.repo.get(p.channelId)
        if (existing && existing.projectId === p.projectId && existing.externalId && existing.externalId !== info.id) {
          throw new PermanentError('Das Google-Konto gehoert zu einem anderen YouTube-Kanal als der zu verbindende', PROVIDER, 'channel_mismatch')
        }
      }
      const channelId = await deps.repo.upsertConnected({
        projectId: p.projectId,
        channelId: p.channelId,
        externalId: info.id,
        displayName: info.title,
        patch: {
          accessTokenEnc: encrypt(tok.access_token!),
          refreshTokenEnc: encrypt(tok.refresh_token),
          tokenExpiresAt: new Date(now() + tok.expires_in! * 1000),
          scopes: tok.scope ?? GOOGLE_SCOPES.join(' '),
          status: 'connected'
        }
      })
      return { channelId, projectId: p.projectId, displayName: info.title, externalId: info.id }
    },

    /** Gueltiges Access-Token; refresht automatisch (Single-Flight je Kanal gegen parallele Refreshs). */
    async getAccessToken(channelId: string): Promise<string> {
      const row = await deps.repo.get(channelId)
      if (!row) throw new PermanentError('Kanal nicht gefunden', PROVIDER, 'channel_not_found')
      if (row.status === 'expired') throw new AuthExpiredError(PROVIDER)
      if (row.accessTokenEnc && row.tokenExpiresAt && row.tokenExpiresAt.getTime() - now() > REFRESH_SKEW_MS) {
        return decrypt(row.accessTokenEnc)
      }
      const running = inflight.get(channelId)
      if (running) return running
      const p = refresh(channelId).finally(() => inflight.delete(channelId))
      inflight.set(channelId, p)
      return p
    }
  }

  async function refresh(channelId: string): Promise<string> {
    // Frisch lesen: ein anderer Prozess/Aufruf kann bereits refresht haben.
    const row = await deps.repo.get(channelId)
    if (!row) throw new PermanentError('Kanal nicht gefunden', PROVIDER, 'channel_not_found')
    if (row.status === 'expired' || !row.refreshTokenEnc) {
      throw new AuthExpiredError(PROVIDER)
    }
    if (row.accessTokenEnc && row.tokenExpiresAt && row.tokenExpiresAt.getTime() - now() > REFRESH_SKEW_MS) {
      return decrypt(row.accessTokenEnc)
    }
    let tok: TokenResponse
    try {
      tok = await tokenRequest({ grant_type: 'refresh_token', refresh_token: decrypt(row.refreshTokenEnc) })
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        await deps.repo.update(channelId, { status: 'expired' })
        await deps.onExpired?.(channelId, row.projectId)
      }
      throw err
    }
    // Rotation: liefert Google ein neues Refresh-Token, ersetzt es das alte atomar im selben Update.
    await deps.repo.update(channelId, {
      accessTokenEnc: encrypt(tok.access_token!),
      ...(tok.refresh_token ? { refreshTokenEnc: encrypt(tok.refresh_token) } : {}),
      tokenExpiresAt: new Date(now() + tok.expires_in! * 1000),
      ...(tok.scope ? { scopes: tok.scope } : {}),
      status: 'connected'
    })
    return tok.access_token!
  }
}

export type GoogleOAuth = ReturnType<typeof createGoogleOAuth>

let _google: GoogleOAuth | undefined
/** Produktiv-Instanz: Credentials aus Secrets (google.clientId/-Secret), Redirect aus BETTER_AUTH_URL. */
export function useGoogleOAuth(): GoogleOAuth {
  return (_google ??= createGoogleOAuth({
    repo: drizzleChannelRepo,
    async getCredentials() {
      const { getSecret } = await import('../utils/secrets')
      const [clientId, clientSecret] = await Promise.all([getSecret('google.clientId'), getSecret('google.clientSecret')])
      if (!clientId || !clientSecret) throw new PermanentError('Google OAuth ist nicht konfiguriert (Einstellungen: google.clientId/-Secret)', PROVIDER, 'not_configured')
      return { clientId, clientSecret }
    },
    redirectUri() {
      const base = process.env.BETTER_AUTH_URL
      if (!base) throw new PermanentError('BETTER_AUTH_URL ist nicht gesetzt', PROVIDER, 'not_configured')
      return `${base.replace(/\/+$/, '')}/api/oauth/google/callback`
    }
  }))
}

export const getAccessToken = (channelId: string) => useGoogleOAuth().getAccessToken(channelId)
