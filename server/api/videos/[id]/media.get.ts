import { eq } from 'drizzle-orm'
import { createError, defineEventHandler, getQuery, getRequestHeader, getRouterParam, send, setResponseHeaders, setResponseStatus } from 'h3'
import { schema, useDb } from '../../../db'
import { getStorage } from '../../../storage'
import { buildMediaResponse } from '../../../storage/serve'
import { requireUuid } from '../../../utils/validation'

// Geschuetzt durch die deny-by-default-Middleware (nicht in PUBLIC_API_PATTERNS).
export default defineEventHandler(async (event) => {
  const id = requireUuid(getRouterParam(event, 'id'))
  const [video] = await useDb().select({
    backend: schema.video.storageBackend,
    ref: schema.video.storageRef,
    filePath: schema.video.filePath,
    localDeletedAt: schema.video.localDeletedAt
  }).from(schema.video).where(eq(schema.video.id, id))
  if (!video) throw createError({ statusCode: 404, statusMessage: 'Video nicht gefunden' })

  // Lokal solange die Datei existiert, sonst Archiv-Backend.
  const useLocal = !!video.filePath && !video.localDeletedAt
  const backend = useLocal ? 'local' : video.backend
  const key = useLocal ? video.filePath : video.ref
  const storage = getStorage(backend)
  if (!key || !storage) throw createError({ statusCode: 404, statusMessage: 'Keine Mediendatei vorhanden' })

  const res = await buildMediaResponse(storage, key, {
    rangeHeader: getRequestHeader(event, 'range'),
    download: getQuery(event).download === '1',
    filename: `${id}.mp4`
  })
  if (res.status === 404) throw createError({ statusCode: 404, statusMessage: 'Mediendatei nicht gefunden' })
  setResponseStatus(event, res.status)
  setResponseHeaders(event, res.headers)
  return res.body ? send(event, res.body) : null
})
