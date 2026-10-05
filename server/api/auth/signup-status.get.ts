import { isSignupOpen } from '../../utils/signup-guard'

// Oeffentlich (unter /api/auth/**): sagt nur, ob die Registrierung offen ist.
export default defineEventHandler(async () => {
  return { open: await isSignupOpen() }
})
