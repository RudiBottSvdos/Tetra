/** Verbinden-Knopf (YouTube): volle Navigation, da der Server auf Google umleitet. Noch keine Seite eingebunden. */
export function useGoogleConnect() {
  function connectUrl(projectId: string, channelId?: string): string {
    const p = new URLSearchParams({ projectId })
    if (channelId) p.set('channelId', channelId)
    return `/api/oauth/google/start?${p.toString()}`
  }
  function connect(projectId: string, channelId?: string) {
    window.location.assign(connectUrl(projectId, channelId))
  }
  return { connectUrl, connect }
}
