import { asc, desc, eq } from 'drizzle-orm'
import { createError } from 'h3'
import { useDb, schema } from '../db'
import { createSecretStore, drizzleRepo, type MaskedSecret } from './secrets'
import {
  DEFAULT_GLOBAL_MONTHLY_BUDGET_CENTS, GLOBAL_MONTHLY_BUDGET_KEY, SECRET_KEYS
} from '../../shared/panel-constants'
import type { ProjectInput, ScheduleRuleInput } from './validation'

export type ProjectRow = typeof schema.project.$inferSelect
export interface ScheduleRuleRow { id: string, weekday: number, timeLocal: string, timezone: string, videosPerDay: number, enabled: boolean }

/** Persistenz-Schnittstelle fuer Projekte/Einstellungen (in Tests durch In-Memory ersetzbar). */
export interface PanelRepo {
  listProjects(): Promise<ProjectRow[]>
  getProject(id: string): Promise<ProjectRow | undefined>
  insertProject(data: ProjectInput): Promise<ProjectRow>
  updateProject(id: string, data: ProjectInput): Promise<ProjectRow | undefined>
  deleteProject(id: string): Promise<boolean>
  listSchedule(projectId: string): Promise<ScheduleRuleRow[]>
  replaceSchedule(projectId: string, timezone: string, rules: ScheduleRuleInput[]): Promise<void>
  getSetting(key: string): Promise<unknown>
  setSetting(key: string, value: unknown): Promise<void>
}

export const drizzlePanelRepo: PanelRepo = {
  async listProjects() {
    return useDb().select().from(schema.project).orderBy(desc(schema.project.createdAt))
  },
  async getProject(id) {
    const [r] = await useDb().select().from(schema.project).where(eq(schema.project.id, id))
    return r
  },
  async insertProject(data) {
    const [r] = await useDb().insert(schema.project).values(data as typeof schema.project.$inferInsert).returning()
    return r!
  },
  async updateProject(id, data) {
    const [r] = await useDb().update(schema.project).set(data).where(eq(schema.project.id, id)).returning()
    return r
  },
  async deleteProject(id) {
    const r = await useDb().delete(schema.project).where(eq(schema.project.id, id)).returning({ id: schema.project.id })
    return r.length > 0
  },
  async listSchedule(projectId) {
    const t = schema.scheduleRule
    return useDb().select({
      id: t.id, weekday: t.weekday, timeLocal: t.timeLocal, timezone: t.timezone, videosPerDay: t.videosPerDay, enabled: t.enabled
    }).from(t).where(eq(t.projectId, projectId)).orderBy(asc(t.weekday), asc(t.timeLocal))
  },
  async replaceSchedule(projectId, timezone, rules) {
    const t = schema.scheduleRule
    await useDb().transaction(async (tx) => {
      await tx.delete(t).where(eq(t.projectId, projectId))
      if (rules.length) await tx.insert(t).values(rules.map(r => ({ ...r, projectId, timezone })))
    })
  },
  async getSetting(key) {
    const [r] = await useDb().select().from(schema.appSetting).where(eq(schema.appSetting.key, key))
    return r?.value
  },
  async setSetting(key, value) {
    await useDb().insert(schema.appSetting).values({ key, value })
      .onConflictDoUpdate({ target: schema.appSetting.key, set: { value, updatedAt: new Date() } })
  }
}

export interface SecretStatus {
  key: string
  label: string
  description: string
  projectOverride: boolean
  configured: boolean
  masked: string
  source: MaskedSecret['source'] | null
}

function toStatus(def: typeof SECRET_KEYS[number], m: MaskedSecret | undefined): SecretStatus {
  return { ...def, configured: !!m, masked: m?.masked ?? '', source: m?.source ?? null }
}

const notFound = () => createError({ statusCode: 404, statusMessage: 'Projekt nicht gefunden' })

type SecretStoreLike = ReturnType<typeof createSecretStore>

export function createPanelService(repo: PanelRepo = drizzlePanelRepo, secrets: SecretStoreLike = createSecretStore(drizzleRepo)) {
  async function requireProject(id: string) {
    const p = await repo.getProject(id)
    if (!p) throw notFound()
    return p
  }
  /** Tag <= Monat gilt auch bei Teil-Updates gegen den gespeicherten Wert. */
  function assertBudgets(daily: number, monthly: number) {
    if (daily > monthly) {
      throw createError({ statusCode: 400, statusMessage: 'Ungültige Eingabe', data: { errors: { dailyBudgetCents: 'Das Tagesbudget darf das Monatsbudget nicht übersteigen.' } } })
    }
  }
  return {
    listProjects: () => repo.listProjects(),
    getProject: requireProject,
    createProject(data: ProjectInput) {
      assertBudgets(data.dailyBudgetCents ?? 300, data.monthlyBudgetCents ?? 6000)
      return repo.insertProject(data)
    },
    async updateProject(id: string, data: ProjectInput) {
      const cur = await requireProject(id)
      assertBudgets(data.dailyBudgetCents ?? cur.dailyBudgetCents, data.monthlyBudgetCents ?? cur.monthlyBudgetCents)
      const r = await repo.updateProject(id, data)
      if (!r) throw notFound()
      return r
    },
    async deleteProject(id: string) {
      if (!(await repo.deleteProject(id))) throw notFound()
    },
    async getSchedule(projectId: string) {
      await requireProject(projectId)
      return repo.listSchedule(projectId)
    },
    async setSchedule(projectId: string, rules: ScheduleRuleInput[]) {
      const p = await requireProject(projectId)
      await repo.replaceSchedule(projectId, p.timezone, rules)
      return repo.listSchedule(projectId)
    },
    /** Nur maskierte Werte (letzte 4 Zeichen), nie Klartext. Ein Eintrag je bekanntem Key. */
    async globalSecrets(): Promise<SecretStatus[]> {
      const masked = await secrets.listMasked()
      return SECRET_KEYS.map(def => toStatus(def, masked.find(m => m.key === def.key)))
    },
    /** Projektansicht: source 'project' = Override, 'global' = Standard wird geerbt, null = nicht gesetzt. */
    async projectSecrets(projectId: string): Promise<SecretStatus[]> {
      await requireProject(projectId)
      const masked = await secrets.listMasked({ projectId })
      return SECRET_KEYS.filter(d => d.projectOverride).map(def => toStatus(def, masked.find(m => m.key === def.key)))
    },
    async setSecret(key: string, value: string, projectId?: string) {
      if (projectId) await requireProject(projectId)
      await secrets.set(key, value, projectId ? { projectId } : {})
    },
    async deleteSecret(key: string, projectId?: string) {
      if (projectId) await requireProject(projectId)
      await secrets.delete(key, projectId ? { projectId } : {})
    },
    async getGlobalBudget(): Promise<number> {
      const v = await repo.getSetting(GLOBAL_MONTHLY_BUDGET_KEY)
      return typeof v === 'number' ? v : DEFAULT_GLOBAL_MONTHLY_BUDGET_CENTS
    },
    async setGlobalBudget(cents: number) {
      await repo.setSetting(GLOBAL_MONTHLY_BUDGET_KEY, cents)
    }
  }
}

let _svc: ReturnType<typeof createPanelService> | undefined
export const panelService = () => (_svc ??= createPanelService())
