/** CredentialResolver (WP1.5): Secrets aus dem verschlüsselten Store, Projekt-Override vor global. */
import { createSecretStore, drizzleRepo } from '../utils/secrets'
import { createDeepseekProvider, DEFAULT_DEEPSEEK_BASE_URL, DEFAULT_DEEPSEEK_MODEL } from './deepseek'
import { CREDENTIAL_KEYS, createProviderRegistry, type CredentialResolver, type ProviderRegistry } from './index'

export { CREDENTIAL_KEYS }

type SecretGetter = Pick<ReturnType<typeof createSecretStore>, 'get'>

/** Löst Registry-Credentials über den Secret-Store (Projekt-Override -> global). Fehlend -> null. */
export function createCredentialResolver(store: SecretGetter): CredentialResolver {
  return async (key, scope) => (await store.get(key, scope.projectId ? { projectId: scope.projectId } : {})) ?? null
}

export function createRuntimeRegistry(
  resolve: CredentialResolver,
  env: Record<string, string | undefined> = process.env
): ProviderRegistry {
  const deepseek = (apiKey: string) => createDeepseekProvider({
    apiKey,
    baseUrl: env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL,
    model: env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL
  })
  return createProviderRegistry(resolve, { idea: deepseek, script: deepseek })
}

let _registry: ProviderRegistry | undefined
export function useProviderRegistry(): ProviderRegistry {
  return (_registry ??= createRuntimeRegistry(createCredentialResolver(createSecretStore(drizzleRepo))))
}
