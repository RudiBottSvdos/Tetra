/** Deepseek (OpenAI-kompatible Chat-API): IdeaProvider + ScriptProvider (WP1.5). fetch-basiert, ohne Netzwerk testbar. */
import { AuthExpiredError, PermanentError, RateLimitError, RetryableError } from './errors'
import type {
  ConnectionTestResult, IdeaProvider, PlatformMeta, PlatformMetaRequest, PlatformMetaResult, ScriptProvider,
  ScriptRequest, ScriptResult, TopicRequest, TopicResult, TopicSuggestion, Usage
} from './types'
import * as v from './validation'

export const DEEPSEEK_PROVIDER = 'deepseek'
export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash'
/** Obere Preisspanne (Peak) in USD je 1M Tokens, deepseek-flash. */
export const DEFAULT_DEEPSEEK_PRICING = { inputPerMTok: 0.3, outputPerMTok: 1.2 }
/** Sprechtempo für die Längenschätzung (Wörter je Sekunde). */
export const WORDS_PER_SECOND = 2.5

export type FetchLike = (url: string, init: { method: string, headers: Record<string, string>, body: string, signal?: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}>

export interface DeepseekOptions {
  apiKey: string
  baseUrl?: string
  model?: string
  fetch?: FetchLike
  pricing?: { inputPerMTok: number, outputPerMTok: number }
  timeoutMs?: number
  maxTokens?: number
}

const LANGUAGE_NAMES: Record<string, string> = {
  de: 'Deutsch', en: 'Englisch', es: 'Spanisch', fr: 'Französisch', it: 'Italienisch',
  pt: 'Portugiesisch', nl: 'Niederländisch', pl: 'Polnisch', tr: 'Türkisch'
}
const langName = (l?: string) => (l && LANGUAGE_NAMES[l]) || l || 'Deutsch'

const PLATFORM_RULES = {
  youtube: { titleMax: 100, descMax: 1000, hashtags: 'Genau 3 bis 5 Hashtags, "Shorts" muss enthalten sein.' },
  tiktok: { titleMax: 90, descMax: 300, hashtags: '3 bis 5 kurze, trendnahe Hashtags.' }
} as const

export function normalizeHashtags(tags: string[], platform: 'youtube' | 'tiktok'): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (t: string) => {
    const clean = t.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')
    if (clean && !seen.has(clean.toLowerCase())) {
      seen.add(clean.toLowerCase())
      out.push(clean)
    }
  }
  for (const t of tags) add(t)
  if (platform === 'youtube') add('Shorts')
  return out.slice(0, 8)
}

const clip = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…')
const NL = String.fromCharCode(10)
const lines = (...l: string[]) => l.filter(Boolean).join(NL)

export class DeepseekProvider implements IdeaProvider, ScriptProvider {
  readonly name = DEEPSEEK_PROVIDER
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly model: string
  private readonly fetchFn: FetchLike
  private readonly pricing: { inputPerMTok: number, outputPerMTok: number }
  private readonly timeoutMs: number
  private readonly maxTokens: number

  constructor(opts: DeepseekOptions) {
    this.apiKey = opts.apiKey
    this.baseUrl = (opts.baseUrl ?? DEFAULT_DEEPSEEK_BASE_URL).replace(/\/+$/, '')
    this.model = opts.model ?? DEFAULT_DEEPSEEK_MODEL
    this.fetchFn = opts.fetch ?? (((url, init) => fetch(url, init)) as FetchLike)
    this.pricing = opts.pricing ?? DEFAULT_DEEPSEEK_PRICING
    this.timeoutMs = opts.timeoutMs ?? 60_000
    this.maxTokens = opts.maxTokens ?? 8000
  }

  private cost(inputTokens: number, outputTokens: number): Usage {
    const costUsd = (inputTokens * this.pricing.inputPerMTok + outputTokens * this.pricing.outputPerMTok) / 1e6
    return { inputTokens, outputTokens, costUsd }
  }

  /** Ein Chat-Call im JSON-Modus; liefert den rohen Content-String und die Nutzung. */
  private async chat(system: string, user: string, maxTokens = this.maxTokens): Promise<{ content: string, usage: Usage }> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    let res: Awaited<ReturnType<FetchLike>>
    let text: string
    try {
      res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          response_format: { type: 'json_object' },
          max_tokens: maxTokens,
          stream: false
        }),
        signal: ctrl.signal
      })
      text = await res.text()
    } catch (e) {
      throw new RetryableError('Deepseek nicht erreichbar', DEEPSEEK_PROVIDER, 'network', e)
    } finally {
      clearTimeout(timer)
    }
    if (res.status === 401) throw new AuthExpiredError(DEEPSEEK_PROVIDER, 'Deepseek-API-Key ungültig oder widerrufen')
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'))
      throw new RateLimitError(DEEPSEEK_PROVIDER, Number.isFinite(ra) && ra > 0 ? ra : 60)
    }
    if (res.status === 402) throw new PermanentError('Deepseek-Guthaben erschöpft', DEEPSEEK_PROVIDER, 'insufficient_balance')
    if (res.status >= 500) throw new RetryableError(`Deepseek-Serverfehler (${res.status})`, DEEPSEEK_PROVIDER, 'server_error')
    if (!res.ok) throw new PermanentError(`Deepseek-Fehler (${res.status})`, DEEPSEEK_PROVIDER, 'http_error')

    let body: { choices?: { message?: { content?: unknown } }[], usage?: { prompt_tokens?: unknown, completion_tokens?: unknown } }
    try {
      body = JSON.parse(text)
    } catch (e) {
      throw new RetryableError('Ungültige Antwort von Deepseek', DEEPSEEK_PROVIDER, 'invalid_json', e)
    }
    const content = body.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      throw new RetryableError('Leere Antwort von Deepseek', DEEPSEEK_PROVIDER, 'empty_response')
    }
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0)
    return { content, usage: this.cost(num(body.usage?.prompt_tokens), num(body.usage?.completion_tokens)) }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      await this.chat('Antworte ausschließlich mit JSON.', 'Gib {"ok": true} als json zurück.', 20)
      return { ok: true, message: 'Verbindung zu Deepseek erfolgreich', details: { model: this.model } }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Verbindung fehlgeschlagen' }
    }
  }

  async generateTopics(req: TopicRequest): Promise<TopicResult> {
    const lang = langName(req.language)
    const exclude = (req.exclude ?? []).slice(-300)
    const system = lines(
      'Du bist Themenplaner für Kurzvideos (YouTube Shorts / TikTok, 30-45 Sekunden).',
      `Antworte ausschließlich mit gültigem JSON in der Sprache ${lang}.`,
      'Schema (json): {"topics":[{"title":"kurzer, konkreter Titel","angle":"Blickwinkel in einem Satz"}]}'
    )
    const user = lines(
      `Nische: ${req.niche}`,
      req.style ? `Stil/Tonalität: ${req.style}` : '',
      `Erzeuge genau ${req.count} verschiedene Themenvorschläge als json.`,
      'Jedes Thema muss sich in 30-45 Sekunden erzählen lassen und sich klar von den anderen unterscheiden.',
      exclude.length ? `Bereits verwendete Themen, NICHT wiederholen oder umformulieren:${NL}${exclude.map(t => `- ${t}`).join(NL)}` : ''
    )
    const { content, usage } = await this.chat(system, user)
    const P = DEEPSEEK_PROVIDER
    const parsed = v.parseJson(P, content, v.obj<{ topics: TopicSuggestion[] }>(P, {
      topics: v.arrayOf(P, v.obj<TopicSuggestion>(P, {
        title: v.str(P),
        angle: (x, p) => (x === undefined || x === null ? '' : typeof x === 'string' ? x : v.str(P)(x, p))
      }))
    }))
    if (parsed.topics.length === 0) throw new RetryableError('Keine Themen geliefert', P, 'empty_topics')
    return { topics: parsed.topics.map(t => ({ title: t.title.trim(), angle: t.angle.trim() })), usage }
  }

  async generateScript(req: ScriptRequest): Promise<ScriptResult> {
    const lang = langName(req.language)
    const words = Math.round(req.targetSeconds * WORDS_PER_SECOND)
    const system = lines(
      'Du schreibst Sprechertexte für vertikale Kurzvideos ohne Gesicht (Voiceover).',
      `Sprache: ${lang}. Antworte ausschließlich mit gültigem JSON.`,
      'Schema (json): {"script":"nur der gesprochene Text, ohne Regieanweisungen, Emojis oder Hashtags"}'
    )
    const user = lines(
      `Thema: ${req.topic}`,
      req.tone ? `Stil/Tonalität: ${req.tone}` : '',
      `Ziellänge: ${req.targetSeconds} Sekunden, also ca. ${words} Wörter (Sprechtempo ${WORDS_PER_SECOND} Wörter pro Sekunde).`,
      'Starte mit einem Hook im ersten Satz und ende mit einem kurzen Abschluss. Gib das Ergebnis als json zurück.'
    )
    const { content, usage } = await this.chat(system, user)
    const P = DEEPSEEK_PROVIDER
    const { script } = v.parseJson(P, content, v.obj<{ script: string }>(P, { script: v.str(P) }))
    const text = script.trim()
    const count = text.split(/\s+/).filter(Boolean).length
    return { script: text, estimatedSeconds: Math.round(count / WORDS_PER_SECOND), usage }
  }

  async generatePlatformMeta(req: PlatformMetaRequest): Promise<PlatformMetaResult> {
    const rules = PLATFORM_RULES[req.platform]
    const plat = req.platform === 'youtube' ? 'YouTube Shorts' : 'TikTok'
    const system = lines(
      `Du erstellst Veröffentlichungs-Metadaten für ${plat}.`,
      'Antworte ausschließlich mit gültigem JSON in der Sprache des Skripts.',
      'Schema (json): {"title":"...","description":"...","hashtags":["ohne #-Zeichen"]}'
    )
    const user = lines(
      `Thema: ${req.topic}`,
      `Skript:${NL}${req.script}`,
      `Regeln: Titel maximal ${rules.titleMax} Zeichen, Beschreibung maximal ${rules.descMax} Zeichen. ${rules.hashtags}`,
      'Gib das Ergebnis als json zurück.'
    )
    const { content, usage } = await this.chat(system, user, 2000)
    const P = DEEPSEEK_PROVIDER
    const raw = v.parseJson(P, content, v.obj<{ title: string, description: string, hashtags: string[] }>(P, {
      title: v.str(P),
      description: (x, p) => (typeof x === 'string' ? x : v.str(P)(x, p)),
      hashtags: v.arrayOf(P, v.str(P))
    }))
    const meta: PlatformMeta = {
      title: clip(raw.title.trim(), rules.titleMax),
      description: clip(raw.description.trim(), rules.descMax),
      hashtags: normalizeHashtags(raw.hashtags, req.platform)
    }
    return { meta, usage }
  }
}

export function createDeepseekProvider(opts: DeepseekOptions): DeepseekProvider {
  return new DeepseekProvider(opts)
}
