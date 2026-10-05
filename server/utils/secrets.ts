import { and, eq } from 'drizzle-orm'
import { useDb, schema } from '../db'
import { decrypt, encrypt, maskSecret } from './crypto'

export type SecretScope = { projectId?: string }

/** Persistenz-Schnittstelle (austauschbar fuer Tests, haelt Verschluesselung getrennt von der DB). */
export interface SecretRepo {
  getGlobal(key: string): Promise<string | undefined>
  setGlobal(key: string, valueEnc: string): Promise<void>
  deleteGlobal(key: string): Promise<void>
  listGlobal(): Promise<{ key: string, valueEnc: string }[]>
  getProject(projectId: string, key: string): Promise<string | undefined>
  setProject(projectId: string, key: string, valueEnc: string): Promise<void>
  deleteProject(projectId: string, key: string): Promise<void>
  listProject(projectId: string): Promise<{ key: string, valueEnc: string }[]>
}

export const drizzleRepo: SecretRepo = {
  async getGlobal(key) {
    const [r] = await useDb().select().from(schema.settingsSecret).where(eq(schema.settingsSecret.key, key))
    return r?.valueEnc
  },
  async setGlobal(key, valueEnc) {
    await useDb().insert(schema.settingsSecret).values({ key, valueEnc })
      .onConflictDoUpdate({ target: schema.settingsSecret.key, set: { valueEnc, updatedAt: new Date() } })
  },
  async deleteGlobal(key) {
    await useDb().delete(schema.settingsSecret).where(eq(schema.settingsSecret.key, key))
  },
  async listGlobal() {
    return useDb().select({ key: schema.settingsSecret.key, valueEnc: schema.settingsSecret.valueEnc }).from(schema.settingsSecret)
  },
  async getProject(projectId, key) {
    const t = schema.projectSecret
    const [r] = await useDb().select().from(t).where(and(eq(t.projectId, projectId), eq(t.key, key)))
    return r?.valueEnc
  },
  async setProject(projectId, key, valueEnc) {
    const t = schema.projectSecret
    await useDb().insert(t).values({ projectId, key, valueEnc })
      .onConflictDoUpdate({ target: [t.projectId, t.key], set: { valueEnc, updatedAt: new Date() } })
  },
  async deleteProject(projectId, key) {
    const t = schema.projectSecret
    await useDb().delete(t).where(and(eq(t.projectId, projectId), eq(t.key, key)))
  },
  async listProject(projectId) {
    const t = schema.projectSecret
    return useDb().select({ key: t.key, valueEnc: t.valueEnc }).from(t).where(eq(t.projectId, projectId))
  }
}

export interface MaskedSecret { key: string, masked: string, source: 'project' | 'global' }

export function createSecretStore(repo: SecretRepo) {
  return {
    /** Klartext nur fuer interne Provider-Aufrufe. Projekt-Override vor globalem Standard. */
    async get(key: string, scope: SecretScope = {}): Promise<string | undefined> {
      if (scope.projectId) {
        const p = await repo.getProject(scope.projectId, key)
        if (p !== undefined) return decrypt(p)
      }
      const g = await repo.getGlobal(key)
      return g === undefined ? undefined : decrypt(g)
    },
    async set(key: string, value: string, scope: SecretScope = {}): Promise<void> {
      if (!value) throw new Error('Secret value must not be empty')
      const enc = encrypt(value)
      if (scope.projectId) await repo.setProject(scope.projectId, key, enc)
      else await repo.setGlobal(key, enc)
    },
    async delete(key: string, scope: SecretScope = {}): Promise<void> {
      if (scope.projectId) await repo.deleteProject(scope.projectId, key)
      else await repo.deleteGlobal(key)
    },
    /** Fuer API-Antworten: nie Klartext, nur maskiert (letzte 4 Zeichen) inkl. Quelle. */
    async getMasked(key: string, scope: SecretScope = {}): Promise<MaskedSecret | undefined> {
      if (scope.projectId) {
        const p = await repo.getProject(scope.projectId, key)
        if (p !== undefined) return { key, masked: maskSecret(decrypt(p)), source: 'project' }
      }
      const g = await repo.getGlobal(key)
      return g === undefined ? undefined : { key, masked: maskSecret(decrypt(g)), source: 'global' }
    },
    async listMasked(scope: SecretScope = {}): Promise<MaskedSecret[]> {
      const out = new Map<string, MaskedSecret>()
      for (const r of await repo.listGlobal()) out.set(r.key, { key: r.key, masked: maskSecret(decrypt(r.valueEnc)), source: 'global' })
      if (scope.projectId) {
        for (const r of await repo.listProject(scope.projectId)) out.set(r.key, { key: r.key, masked: maskSecret(decrypt(r.valueEnc)), source: 'project' })
      }
      return [...out.values()].sort((a, b) => a.key.localeCompare(b.key))
    },
    /** Key-Rotation: mit neuem ENCRYPTION_KEY (alter in ENCRYPTION_KEY_PREVIOUS) alle globalen Secrets neu verschluesseln. */
    async rotateGlobal(): Promise<number> {
      const rows = await repo.listGlobal()
      for (const r of rows) await repo.setGlobal(r.key, encrypt(decrypt(r.valueEnc)))
      return rows.length
    },
    async rotateProject(projectId: string): Promise<number> {
      const rows = await repo.listProject(projectId)
      for (const r of rows) await repo.setProject(projectId, r.key, encrypt(decrypt(r.valueEnc)))
      return rows.length
    }
  }
}

const store = createSecretStore(drizzleRepo)
export const getSecret = store.get
export const setSecret = store.set
export const deleteSecret = store.delete
export const getMaskedSecret = store.getMasked
export const listMaskedSecrets = store.listMasked
export const rotateGlobalSecrets = store.rotateGlobal
export const rotateProjectSecrets = store.rotateProject
