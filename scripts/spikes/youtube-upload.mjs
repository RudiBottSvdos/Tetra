// WP0.1 Spike: YouTube videos.insert (resumable), containsSyntheticMedia, Privatzwang.
// Vorbereitung: Google-Cloud-Projekt, OAuth-Client (Web), Refresh-Token mit Scope youtube.upload (z. B. via OAuth Playground).
// Aufruf: GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... YT_REFRESH_TOKEN=... node scripts/spikes/youtube-upload.mjs <datei.mp4>
// Erwartung: Video wird privat angelegt; Ausgabe zeigt status.containsSyntheticMedia und privacyStatus.
// (videos.list zur Pruefung braucht Scope youtube.readonly; sonst im YouTube Studio nachsehen.)
import { readFile } from 'node:fs/promises'

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !YT_REFRESH_TOKEN) throw new Error('GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, YT_REFRESH_TOKEN setzen')
const file = process.argv[2]
if (!file) throw new Error('Dateipfad angeben')

const tok = await (await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: YT_REFRESH_TOKEN, grant_type: 'refresh_token' }),
})).json()
if (!tok.access_token) throw new Error('Token-Fehler (invalid_grant = Consent Screen Testing?): ' + JSON.stringify(tok))

const data = await readFile(file)
const meta = {
  snippet: { title: 'Tetra Spike #Shorts', description: 'API-Test #Shorts', categoryId: '22' },
  status: { privacyStatus: 'private', selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
}
const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${tok.access_token}`,
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Length': String(data.length),
    'X-Upload-Content-Type': 'video/mp4',
  },
  body: JSON.stringify(meta),
})
console.log('init', init.status)
const loc = init.headers.get('location')
if (!loc) throw new Error('Kein Upload-Location: ' + (await init.text()))

const up = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(data.length) }, body: data })
console.log('upload', up.status)
const video = await up.json()
console.log({ id: video.id, privacy: video.status?.privacyStatus, synthetic: video.status?.containsSyntheticMedia, uploadStatus: video.status?.uploadStatus })
