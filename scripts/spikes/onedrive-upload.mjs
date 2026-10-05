// WP0.1 Spike: Microsoft Graph Upload-Session (persoenliches Konto) + Refresh-Token-Rotation.
// Vorbereitung: Azure-App (Personal accounts), Redirect-URI http://localhost:53682/cb, Scopes Files.ReadWrite offline_access.
// Schritt 1 (einmalig, Code holen): im Browser oeffnen
//   https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?client_id=<ID>&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A53682%2Fcb&scope=Files.ReadWrite%20offline_access
//   und den ?code=... aus der Redirect-URL kopieren.
// Schritt 2: MS_CLIENT_ID=... MS_CLIENT_SECRET=... MS_CODE=... node scripts/spikes/onedrive-upload.mjs <datei.mp4>
//   (spaeter statt MS_CODE: MS_REFRESH_TOKEN=...; das neue Refresh-Token wird ausgegeben -> Rotation pruefen)
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

const { MS_CLIENT_ID, MS_CLIENT_SECRET, MS_CODE, MS_REFRESH_TOKEN } = process.env
if (!MS_CLIENT_ID || !MS_CLIENT_SECRET || !(MS_CODE || MS_REFRESH_TOKEN)) throw new Error('MS_CLIENT_ID, MS_CLIENT_SECRET und MS_CODE oder MS_REFRESH_TOKEN setzen')
const file = process.argv[2]
if (!file) throw new Error('Dateipfad angeben')
const redirect = 'http://localhost:53682/cb'

const form = new URLSearchParams({ client_id: MS_CLIENT_ID, client_secret: MS_CLIENT_SECRET, scope: 'Files.ReadWrite offline_access' })
if (MS_CODE) { form.set('grant_type', 'authorization_code'); form.set('code', MS_CODE); form.set('redirect_uri', redirect) }
else { form.set('grant_type', 'refresh_token'); form.set('refresh_token', MS_REFRESH_TOKEN) }
const tok = await (await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', { method: 'POST', body: form })).json()
if (!tok.access_token) throw new Error('Token-Fehler: ' + JSON.stringify(tok))
console.log('expires_in', tok.expires_in, '| NEUES refresh_token (altes ersetzen!):', tok.refresh_token ? 'ja' : 'nein')
if (tok.refresh_token) console.log('REFRESH_TOKEN=' + tok.refresh_token)

const data = await readFile(file)
const name = basename(file)
const sessRes = await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/TetraSpike/${encodeURIComponent(name)}:/createUploadSession`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' }, fileSize: data.length }),
})
const sess = await sessRes.json()
if (!sess.uploadUrl) throw new Error('Session-Fehler: ' + JSON.stringify(sess))

const chunk = 320 * 1024 * 16 // 5 MiB, Vielfaches von 320 KiB
let last
for (let start = 0; start < data.length; start += chunk) {
  const end = Math.min(start + chunk, data.length) - 1
  const r = await fetch(sess.uploadUrl, { // KEIN Authorization-Header am uploadUrl
    method: 'PUT',
    headers: { 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${data.length}` },
    body: data.subarray(start, end + 1),
  })
  console.log('chunk', start, end, r.status, r.headers.get('retry-after') ?? '')
  last = await r.json().catch(() => ({}))
}
console.log('fertig:', { id: last?.id, size: last?.size, hashes: last?.file?.hashes, lokalSize: data.length })
