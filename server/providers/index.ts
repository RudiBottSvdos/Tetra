/** Registry/Factory: löst Provider anhand von Credentials (Projekt -> global) auf. */
import { PermanentError } from './errors'
import { FakeIdeaProvider, FakePlatformPublisher, FakeScriptProvider, FakeVideoProvider } from './fakes'
import type { IdeaProvider, Platform, PlatformPublisher, ScriptProvider, VideoProvider } from './types'

export * from './types'
export * from './errors'
export * from './fakes'
export * as validation from './validation'

export type ProviderKey = 'idea' | 'script' | 'video' | `publisher:${Platform}`

export interface ProviderScope { projectId?: string }

/**
 * Liefert Secret oder null. Reale Implementierung: getSecret aus server/utils/secrets
 * mit Fallback Projekt -> global (der Resolver kapselt den Fallback).
 */
export type CredentialResolver = (key: string, scope: ProviderScope) => Promise<string | null>

export interface ProviderBuilders {
  idea?: (cred: string, scope: ProviderScope) => IdeaProvider
  script?: (cred: string, scope: ProviderScope) => ScriptProvider
  video?: (cred: string, scope: ProviderScope) => VideoProvider
  publisher?: Partial<Record<Platform, (cred: string, scope: ProviderScope) => PlatformPublisher>>
}

/** Secret-Schlüssel je Provider. */
export const CREDENTIAL_KEYS = {
  'idea': 'deepseek_api_key',
  'script': 'deepseek_api_key',
  'video': 'heygen_api_key',
  'publisher:youtube': 'youtube_token',
  'publisher:tiktok': 'tiktok_token'
} as const satisfies Record<ProviderKey, string>

export interface ProviderRegistry {
  idea(scope?: ProviderScope): Promise<IdeaProvider>
  script(scope?: ProviderScope): Promise<ScriptProvider>
  video(scope?: ProviderScope): Promise<VideoProvider>
  publisher(platform: Platform, scope?: ProviderScope): Promise<PlatformPublisher>
}

export function createProviderRegistry(resolve: CredentialResolver, builders: ProviderBuilders): ProviderRegistry {
  async function cred(key: ProviderKey, scope: ProviderScope): Promise<string> {
    const secretKey = CREDENTIAL_KEYS[key]
    const v = await resolve(secretKey, scope)
    if (!v) throw new PermanentError(`Kein Zugang hinterlegt: ${secretKey}`, key, 'missing_credential')
    return v
  }
  function need<T>(b: T | undefined, key: ProviderKey): T {
    if (!b) throw new PermanentError(`Kein Provider registriert: ${key}`, key, 'not_registered')
    return b
  }
  return {
    async idea(scope = {}) {
      const b = need(builders.idea, 'idea')
      return b(await cred('idea', scope), scope)
    },
    async script(scope = {}) {
      const b = need(builders.script, 'script')
      return b(await cred('script', scope), scope)
    },
    async video(scope = {}) {
      const b = need(builders.video, 'video')
      return b(await cred('video', scope), scope)
    },
    async publisher(platform, scope = {}) {
      const key = `publisher:${platform}` as const
      const b = need(builders.publisher?.[platform], key)
      return b(await cred(key, scope), scope)
    }
  }
}

/** Registry mit Fakes für Tests/Entwicklung (Credentials werden nicht geprüft). */
export function createFakeRegistry(opts: {
  idea?: FakeIdeaProvider
  script?: FakeScriptProvider
  video?: FakeVideoProvider
  youtube?: FakePlatformPublisher
  tiktok?: FakePlatformPublisher
} = {}): ProviderRegistry {
  const idea = opts.idea ?? new FakeIdeaProvider()
  const script = opts.script ?? new FakeScriptProvider()
  const video = opts.video ?? new FakeVideoProvider()
  const youtube = opts.youtube ?? new FakePlatformPublisher('youtube')
  const tiktok = opts.tiktok ?? new FakePlatformPublisher('tiktok')
  return {
    idea: async () => idea,
    script: async () => script,
    video: async () => video,
    publisher: async p => (p === 'youtube' ? youtube : tiktok)
  }
}
