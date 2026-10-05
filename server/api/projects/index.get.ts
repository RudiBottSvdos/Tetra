import { defineEventHandler } from 'h3'
import { panelService } from '../../utils/panel-service'

// Geschuetzt durch die Deny-by-default-Middleware (nicht in der Allowlist).
export default defineEventHandler(() => panelService().listProjects())
