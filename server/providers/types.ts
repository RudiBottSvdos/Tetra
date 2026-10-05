/** Provider-neutrale Interfaces (WP1.1). Keine Netzwerk-/Framework-Abhängigkeiten. */

export type ProviderKind = 'script' | 'idea' | 'video' | 'publisher' | 'storage'

export interface ConnectionTestResult {
  ok: boolean
  message?: string
  /** Optionale Details (nie Secrets). */
  details?: Record<string, unknown>
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  /** Kosten in USD (obere Preisspanne, für CostGuard). */
  costUsd: number
}

export interface BaseProvider {
  readonly name: string
  testConnection(): Promise<ConnectionTestResult>
}

// ---- Ideen / Skripte (Deepseek-artig) ----

export interface TopicRequest {
  niche: string
  count: number
  language?: string
  /** Bereits vorhandene Themen (Ausschlussliste). */
  exclude?: string[]
}
export interface TopicSuggestion { title: string, angle: string }
export interface TopicResult { topics: TopicSuggestion[], usage: Usage }

export interface IdeaProvider extends BaseProvider {
  generateTopics(req: TopicRequest): Promise<TopicResult>
}

export interface ScriptRequest {
  topic: string
  targetSeconds: number
  language?: string
  tone?: string
}
export interface ScriptResult { script: string, estimatedSeconds: number, usage: Usage }

export type Platform = 'youtube' | 'tiktok'

export interface PlatformMetaRequest { topic: string, script: string, platform: Platform }
export interface PlatformMeta { title: string, description: string, hashtags: string[] }
export interface PlatformMetaResult { meta: PlatformMeta, usage: Usage }

export interface ScriptProvider extends BaseProvider {
  generateScript(req: ScriptRequest): Promise<ScriptResult>
  generatePlatformMeta(req: PlatformMetaRequest): Promise<PlatformMetaResult>
}

// ---- Video (HeyGen-artig) ----

export type VisualMode = 'faceless' | 'avatar'
export type RenderStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface RenderRequest {
  script: string
  visualMode: VisualMode
  /** Nur bei visualMode 'avatar'. */
  avatarId?: string | null
  voiceId?: string
  visualStylePrompt?: string
  targetSeconds: number
  orientation?: 'portrait' | 'landscape'
  /** Idempotenzschlüssel: gleicher Key -> gleiche Session, kein Doppel-Render. */
  idempotencyKey?: string
  callbackUrl?: string
}

export interface RenderHandle { sessionId: string, provider: string }

export interface RenderState {
  sessionId: string
  status: RenderStatus
  /** Temporäre URL, nie speichern, sofort herunterladen. */
  videoUrl?: string
  durationSeconds?: number
  /** Tatsächliche Kosten, sobald bekannt. */
  costUsd?: number
  error?: string
}

export interface CostEstimate { costUsd: number, reserveUsd: number, basis: string }

export interface WebhookInput { rawBody: string, headers: Record<string, string | undefined> }
export interface WebhookEvent { sessionId: string, status: RenderStatus, error?: string }

export interface VideoProvider extends BaseProvider {
  estimateCost(req: Pick<RenderRequest, 'targetSeconds'>): CostEstimate
  startRender(req: RenderRequest): Promise<RenderHandle>
  pollRender(sessionId: string): Promise<RenderState>
  /** Prüft Signatur und liefert Event; wirft PermanentError bei ungültiger Signatur. */
  handleWebhook(input: WebhookInput): WebhookEvent
  /** Lädt das fertige Video (Bytes). Ergebnis geht an den StorageProvider. */
  download(videoUrl: string): Promise<Uint8Array>
}

// ---- Plattform-Publisher (YouTube/TikTok) ----

export type PublishVisibility = 'private' | 'unlisted' | 'public' | 'draft'

export interface UploadRequest {
  video: Uint8Array
  title: string
  description: string
  hashtags: string[]
  visibility: PublishVisibility
  /** KI-Kennzeichnung ist immer an (nicht abschaltbar), daher Literal true. */
  aiGenerated: true
  scheduleAt?: Date
}
export interface UploadHandle { externalId: string, platform: Platform }

export type PublishStatus = 'processing' | 'published' | 'draft' | 'failed'
export interface PublishState { externalId: string, status: PublishStatus, url?: string, error?: string }

export interface PlatformMetrics {
  externalId: string
  views: number
  likes: number
  comments: number
  shares: number
  /** false = Best effort/nicht verfügbar (z. B. TikTok-Inbox, nicht öffentlich). */
  available: boolean
  fetchedAt: Date
}

export interface PlatformPublisher extends BaseProvider {
  readonly platform: Platform
  upload(req: UploadRequest): Promise<UploadHandle>
  getStatus(externalId: string): Promise<PublishState>
  fetchMetrics(externalId: string): Promise<PlatformMetrics>
}

// ---- Storage: nur Verweis, Interface (put/get/stream/delete/move) baut WP1.9 ----
export type StorageProviderRef = { readonly kind: 'storage', readonly name: string }
