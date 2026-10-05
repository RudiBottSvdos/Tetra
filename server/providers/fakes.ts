/** Deterministische, konfigurierbare Fakes. Kein Netzwerk. */
import { AuthExpiredError, PermanentError, RateLimitError, RetryableError } from './errors'
import type {
  ConnectionTestResult, CostEstimate, IdeaProvider, Platform, PlatformMeta, PlatformMetaRequest,
  PlatformMetaResult, PlatformMetrics, PlatformPublisher, PublishState, RenderHandle, RenderRequest,
  RenderState, ScriptProvider, ScriptRequest, ScriptResult, TopicRequest, TopicResult, UploadHandle,
  UploadRequest, Usage, VideoProvider, WebhookEvent, WebhookInput
} from './types'

export type FakeFailure = 'retryable' | 'permanent' | 'rate_limit' | 'auth_expired'

export interface FakeOptions {
  /** Künstliche Verzögerung pro Aufruf (ms). */
  delayMs?: number
  /** Die nächsten Aufrufe schlagen der Reihe nach fehl (je Eintrag ein Aufruf, null = Erfolg). */
  failures?: (FakeFailure | null)[]
  retryAfter?: number
  /** testConnection-Ergebnis. */
  connection?: ConnectionTestResult
}

class FakeBase {
  readonly calls: { method: string, args: unknown }[] = []
  protected failures: (FakeFailure | null)[]
  constructor(readonly name: string, protected opts: FakeOptions = {}) {
    this.failures = [...(opts.failures ?? [])]
  }

  /** Fehler für die nächsten Aufrufe einplanen. */
  failNext(...f: (FakeFailure | null)[]) {
    this.failures.push(...f)
  }

  protected async enter(method: string, args?: unknown) {
    this.calls.push({ method, args })
    if (this.opts.delayMs) await new Promise(r => setTimeout(r, this.opts.delayMs))
    const f = this.failures.shift()
    if (f === 'retryable') throw new RetryableError('Fake: temporärer Fehler', this.name)
    if (f === 'permanent') throw new PermanentError('Fake: dauerhafter Fehler', this.name)
    if (f === 'rate_limit') throw new RateLimitError(this.name, this.opts.retryAfter ?? 30)
    if (f === 'auth_expired') throw new AuthExpiredError(this.name)
  }

  async testConnection(): Promise<ConnectionTestResult> {
    await this.enter('testConnection')
    return this.opts.connection ?? { ok: true, message: 'fake ok' }
  }
}

const usage = (inp: number, out: number): Usage => ({ inputTokens: inp, outputTokens: out, costUsd: (inp * 0.3 + out * 1.2) / 1e6 })

export function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export class FakeIdeaProvider extends FakeBase implements IdeaProvider {
  constructor(opts?: FakeOptions) {
    super('fake-idea', opts)
  }

  async generateTopics(req: TopicRequest): Promise<TopicResult> {
    await this.enter('generateTopics', req)
    const excluded = new Set(req.exclude ?? [])
    const topics = []
    for (let i = 1; topics.length < req.count; i++) {
      const title = `${req.niche} Thema ${i}`
      if (!excluded.has(title)) topics.push({ title, angle: `Blickwinkel ${i}` })
    }
    return { topics, usage: usage(100, 50 * req.count) }
  }
}

export class FakeScriptProvider extends FakeBase implements ScriptProvider {
  constructor(opts?: FakeOptions) {
    super('fake-script', opts)
  }

  async generateScript(req: ScriptRequest): Promise<ScriptResult> {
    await this.enter('generateScript', req)
    const words = Math.round(req.targetSeconds * 2.5)
    const script = Array.from({ length: words }, (_, i) => i === 0 ? req.topic : `wort${i}`).join(' ')
    return { script, estimatedSeconds: req.targetSeconds, usage: usage(200, words * 2) }
  }

  async generatePlatformMeta(req: PlatformMetaRequest): Promise<PlatformMetaResult> {
    await this.enter('generatePlatformMeta', req)
    const meta: PlatformMeta = {
      title: `${req.topic} (${req.platform})`.slice(0, 100),
      description: req.script.slice(0, 120),
      hashtags: ['ki', req.platform]
    }
    return { meta, usage: usage(150, 80) }
  }
}

export interface FakeVideoOptions extends FakeOptions {
  /** Anzahl pollRender-Aufrufe in 'processing', bevor completed. */
  pollsUntilDone?: number
  /** Render endet nach den Polls mit 'failed'. */
  renderFails?: boolean
  usdPerSecond?: number
  webhookSecret?: string
}

export class FakeVideoProvider extends FakeBase implements VideoProvider {
  private sessions = new Map<string, { req: RenderRequest, polls: number }>()
  private byKey = new Map<string, string>()
  private counter = 0
  private vo: FakeVideoOptions
  constructor(opts: FakeVideoOptions = {}) {
    super('fake-video', opts)
    this.vo = opts
  }

  estimateCost(req: Pick<RenderRequest, 'targetSeconds'>): CostEstimate {
    const costUsd = req.targetSeconds * (this.vo.usdPerSecond ?? 0.0333)
    return { costUsd, reserveUsd: costUsd * 1.25, basis: 'Dauer x Tarif + 25% Puffer' }
  }

  async startRender(req: RenderRequest): Promise<RenderHandle> {
    await this.enter('startRender', req)
    if (req.idempotencyKey && this.byKey.has(req.idempotencyKey)) {
      return { sessionId: this.byKey.get(req.idempotencyKey)!, provider: this.name }
    }
    const sessionId = `fake-session-${++this.counter}`
    this.sessions.set(sessionId, { req, polls: 0 })
    if (req.idempotencyKey) this.byKey.set(req.idempotencyKey, sessionId)
    return { sessionId, provider: this.name }
  }

  async pollRender(sessionId: string): Promise<RenderState> {
    await this.enter('pollRender', sessionId)
    const s = this.sessions.get(sessionId)
    if (!s) throw new PermanentError('Unbekannte Session', this.name, 'not_found')
    s.polls++
    if (s.polls <= (this.vo.pollsUntilDone ?? 1)) return { sessionId, status: 'processing' }
    if (this.vo.renderFails) return { sessionId, status: 'failed', error: 'Fake: Render fehlgeschlagen' }
    const durationSeconds = s.req.targetSeconds
    return {
      sessionId,
      status: 'completed',
      videoUrl: `https://fake.invalid/${sessionId}.mp4`,
      durationSeconds,
      costUsd: durationSeconds * (this.vo.usdPerSecond ?? 0.0333)
    }
  }

  /** Fake-Signatur: Header x-signature muss dem Secret entsprechen. Body: {event, session_id, error?}. */
  handleWebhook(input: WebhookInput): WebhookEvent {
    this.calls.push({ method: 'handleWebhook', args: input })
    if (input.headers['x-signature'] !== (this.vo.webhookSecret ?? 'fake-secret')) {
      throw new PermanentError('Ungültige Webhook-Signatur', this.name, 'bad_signature')
    }
    let body: { event?: string, session_id?: string, error?: string }
    try {
      body = JSON.parse(input.rawBody)
    } catch (e) {
      throw new PermanentError('Ungültiger Webhook-Body', this.name, 'bad_body', e)
    }
    if (!body.session_id) throw new PermanentError('session_id fehlt', this.name, 'bad_body')
    const ok = body.event === 'video_agent.success'
    return { sessionId: body.session_id, status: ok ? 'completed' : 'failed', error: ok ? undefined : body.error }
  }

  async download(videoUrl: string): Promise<Uint8Array> {
    await this.enter('download', videoUrl)
    return new TextEncoder().encode(`FAKEVIDEO:${videoUrl}`)
  }
}

export class FakePlatformPublisher extends FakeBase implements PlatformPublisher {
  private uploads = new Map<string, { req: UploadRequest, checks: number }>()
  private counter = 0
  private checksUntil: number
  constructor(readonly platform: Platform, opts?: FakeOptions & { checksUntilPublished?: number }) {
    super(`fake-${platform}`, opts)
    this.checksUntil = opts?.checksUntilPublished ?? 1
  }

  async upload(req: UploadRequest): Promise<UploadHandle> {
    await this.enter('upload', { ...req, video: req.video.byteLength })
    const externalId = `${this.platform}-${++this.counter}-${hash(req.title).toString(16)}`
    this.uploads.set(externalId, { req, checks: 0 })
    return { externalId, platform: this.platform }
  }

  async getStatus(externalId: string): Promise<PublishState> {
    await this.enter('getStatus', externalId)
    const u = this.uploads.get(externalId)
    if (!u) throw new PermanentError('Unbekannte ID', this.name, 'not_found')
    if (++u.checks <= this.checksUntil) return { externalId, status: 'processing' }
    if (this.platform === 'tiktok' && u.req.visibility === 'draft') return { externalId, status: 'draft' }
    return { externalId, status: 'published', url: `https://fake.invalid/${this.platform}/${externalId}` }
  }

  async fetchMetrics(externalId: string): Promise<PlatformMetrics> {
    await this.enter('fetchMetrics', externalId)
    const h = hash(externalId)
    return {
      externalId,
      views: h % 10000,
      likes: h % 500,
      comments: h % 50,
      shares: h % 20,
      available: true,
      fetchedAt: new Date(0)
    }
  }
}
