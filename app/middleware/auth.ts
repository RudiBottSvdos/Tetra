export default defineNuxtRouteMiddleware(async () => {
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : undefined
  const { data: session } = await authClient.getSession({ fetchOptions: { headers } })
  if (!session) return navigateTo('/login')
})
