// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  VIDEO_STATUSES, TRANSITIONS, InvalidTransitionError, allowedTransitions, canTransition,
  isTerminal, transition, type TransitionContext, type VideoStatus
} from '../server/domain/video-state'

const ctx = (status: VideoStatus, over: Partial<TransitionContext> = {}): TransitionContext =>
  ({ status, resumeStatus: null, scriptApprovalRequired: true, ...over })

// Erwartete Matrix laut Plan Abschnitt 3 (statische Tabelle).
const EXPECTED: Record<VideoStatus, VideoStatus[]> = {
  idea: ['scripting', 'paused_budget'],
  scripting: ['script_ready', 'failed', 'paused_budget'],
  script_ready: ['awaiting_script_approval', 'rendering'],
  awaiting_script_approval: ['rendering', 'scripting', 'rejected'],
  rendering: ['awaiting_review', 'failed', 'paused_budget'],
  awaiting_review: ['scheduled', 'rejected'],
  rejected: ['scripting', 'rendering'],
  scheduled: ['uploading', 'awaiting_review'],
  uploading: ['uploaded', 'partially_uploaded', 'failed'],
  partially_uploaded: ['uploading', 'uploaded'],
  uploaded: [],
  failed: ['idea', 'scripting', 'rendering', 'uploading'],
  paused_budget: ['idea', 'scripting', 'rendering']
}

describe('video state machine: Uebergangsmatrix', () => {
  it('deckt jeden Status ab', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...VIDEO_STATUSES].sort())
  })

  it('statische Tabelle entspricht dem Plan', () => {
    for (const s of VIDEO_STATUSES) expect([...TRANSITIONS[s]].sort(), s).toEqual([...EXPECTED[s]].sort())
  })

  // Volle 13x13-Matrix mit voll konfiguriertem Kontext (Gate passend, resume gesetzt, Kosten bestaetigt).
  describe.each(VIDEO_STATUSES)('von %s', (from) => {
    it.each(VIDEO_STATUSES)('nach %s', (to) => {
      const tableAllowed = EXPECTED[from].includes(to)
      const c = ctx(from, {
        resumeStatus: from === 'failed' || from === 'paused_budget' ? to : null,
        scriptApprovalRequired: to === 'awaiting_script_approval' ? true : to !== 'rendering'
      })
      if (tableAllowed) {
        const r = transition(c, to, { confirmedCost: true })
        expect(r.from).toBe(from)
        expect(r.to).toBe(to)
      } else {
        expect(() => transition(c, to, { confirmedCost: true })).toThrow(InvalidTransitionError)
        expect(canTransition(c, to, { confirmedCost: true })).toBe(false)
      }
    })
  })

  it('Standard-Pipeline mit Gate durchlaufbar', () => {
    const path: VideoStatus[] = ['idea', 'scripting', 'script_ready', 'awaiting_script_approval', 'rendering',
      'awaiting_review', 'scheduled', 'uploading', 'uploaded']
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(ctx(path[i]!), path[i + 1]!), `${path[i]} -> ${path[i + 1]}`).toBe(true)
    }
  })

  it('uploaded ist Endzustand', () => {
    expect(isTerminal('uploaded')).toBe(true)
    expect(isTerminal('rejected')).toBe(false)
    expect(allowedTransitions(ctx('uploaded'))).toEqual([])
  })
})

describe('Skript-Gate', () => {
  it('Gate an: script_ready -> awaiting_script_approval ja, -> rendering nein', () => {
    const c = ctx('script_ready', { scriptApprovalRequired: true })
    expect(canTransition(c, 'awaiting_script_approval')).toBe(true)
    expect(() => transition(c, 'rendering')).toThrow(/Gate/)
    expect(allowedTransitions(c)).toEqual(['awaiting_script_approval'])
  })

  it('Gate aus: script_ready -> rendering ja, -> awaiting_script_approval nein', () => {
    const c = ctx('script_ready', { scriptApprovalRequired: false })
    expect(canTransition(c, 'rendering')).toBe(true)
    expect(() => transition(c, 'awaiting_script_approval')).toThrow(InvalidTransitionError)
    expect(allowedTransitions(c)).toEqual(['rendering'])
  })

  it('Freigabe markiert scriptApproved, Ablehnung geht nach scripting oder rejected', () => {
    const c = ctx('awaiting_script_approval')
    expect(transition(c, 'rendering').scriptApproved).toBe(true)
    expect(transition(c, 'scripting').scriptApproved).toBe(false)
    expect(transition(c, 'rejected').to).toBe('rejected')
  })
})

describe('rejected', () => {
  it('-> scripting frei, -> rendering nur mit Kostenbestaetigung', () => {
    const c = ctx('rejected')
    expect(transition(c, 'scripting').to).toBe('scripting')
    expect(() => transition(c, 'rendering')).toThrow(/Bestaetigung/)
    expect(transition(c, 'rendering', { confirmedCost: true }).to).toBe('rendering')
    expect(() => transition(c, 'uploaded')).toThrow(InvalidTransitionError)
  })
})

describe('resume-Logik', () => {
  it.each(['scripting', 'rendering', 'uploading'] as const)('failed aus %s merkt resume_status und resetet beim Retry', (from) => {
    const failed = transition(ctx(from), 'failed')
    expect(failed.resumeStatus).toBe(from)
    const back = transition(ctx('failed', { resumeStatus: failed.resumeStatus }), from, { confirmedCost: true })
    expect(back.to).toBe(from)
    expect(back.resumeStatus).toBeNull()
    expect(back.resetAttempts).toBe(true)
  })

  it.each(['idea', 'scripting', 'rendering'] as const)('paused_budget aus %s merkt und leert resume_status', (from) => {
    const paused = transition(ctx(from), 'paused_budget')
    expect(paused.resumeStatus).toBe(from)
    expect(paused.resetAttempts).toBe(false)
    const back = transition(ctx('paused_budget', { resumeStatus: from }), from)
    expect(back.resumeStatus).toBeNull()
  })

  it('Wiederaufnahme nur in den gemerkten Status', () => {
    expect(() => transition(ctx('paused_budget', { resumeStatus: 'rendering' }), 'scripting')).toThrow(/Wiederaufnahme/)
    expect(() => transition(ctx('failed', { resumeStatus: 'uploading' }), 'scripting')).toThrow(InvalidTransitionError)
    expect(allowedTransitions(ctx('paused_budget', { resumeStatus: 'idea' }))).toEqual(['idea'])
  })

  it('Wiederaufnahme ohne resume_status wird abgelehnt', () => {
    expect(() => transition(ctx('failed'), 'scripting')).toThrow(/resume_status fehlt/)
    expect(allowedTransitions(ctx('paused_budget'))).toEqual([])
  })

  it('failed -> rendering braucht Kostenbestaetigung', () => {
    const c = ctx('failed', { resumeStatus: 'rendering' })
    expect(() => transition(c, 'rendering')).toThrow(/Bestaetigung/)
    expect(transition(c, 'rendering', { confirmedCost: true }).to).toBe('rendering')
  })

  it('nicht fortsetzbare Zustaende koennen nicht pausieren/fehlschlagen', () => {
    expect(() => transition(ctx('awaiting_review'), 'failed')).toThrow(InvalidTransitionError)
    expect(() => transition(ctx('script_ready'), 'paused_budget')).toThrow(InvalidTransitionError)
  })
})

describe('partially_uploaded', () => {
  it('Wiederholung (uploading) oder Abschluss (uploaded)', () => {
    expect(transition(ctx('uploading'), 'partially_uploaded').to).toBe('partially_uploaded')
    expect(allowedTransitions(ctx('partially_uploaded'))).toEqual(['uploading', 'uploaded'])
    expect(() => transition(ctx('partially_uploaded'), 'failed')).toThrow(InvalidTransitionError)
  })
})
