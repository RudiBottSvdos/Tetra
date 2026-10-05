import { createAuthClient } from 'better-auth/vue'

export const authClient = createAuthClient()

export function useAuthClient() {
  return authClient
}
