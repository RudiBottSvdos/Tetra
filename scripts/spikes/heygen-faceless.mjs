// WP0.1 Spike: Prueft, ob HeyGen Video Agent avatarlos (Voiceover + B-Roll + Untertitel) liefert.
// Aufruf: HEYGEN_API_KEY=... node scripts/spikes/heygen-faceless.mjs "Dein Skript ..." [Sekunden]
// Kosten: ca. 0,0333 USD/s (je Lauf ca. 1-1,5 USD). Keine Keys im Code.
//
// Checkliste nach dem Lauf (Video manuell ansehen):
//  [ ] Kein Sprecher/Avatar sichtbar?   [ ] Skript woertlich gesprochen?
//  [ ] Untertitel eingebrannt (video_url) oder nur captioned_video_url?
//  [ ] 9:16?  [ ] Dauer innerhalb +-25 % des Ziels?  [ ] Reaktionszeit (siehe Ausgabe)
import { writeFile } from 'node:fs/promises'

const key = process.env.HEYGEN_API_KEY
if (!key) throw new Error('HEYGEN_API_KEY fehlt')
const script = process.argv[2] ?? 'Hello. This is a short test of a faceless video generated from a script.'
const seconds = Number(process.argv[3] ?? 40)
const base = 'https://api.heygen.com'
const headers = { 'X-Api-Key': key, 'Content-Type': 'application/json' }

const prompt = [
  `Read the following script word for word. Do not add, remove or rephrase anything.`,
  `No on-screen presenter or avatar. Voiceover only, with relevant B-roll footage and burned-in captions.`,
  `Vertical 9:16. Target duration: ${seconds} seconds.`,
  `SCRIPT: "${script}"`,
].join('\n')

const t0 = Date.now()
const res = await fetch(`${base}/v3/video-agents`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ prompt, orientation: 'portrait', mode: 'generate', incognito_mode: true }),
})
console.log('create', res.status, res.headers.get('retry-after') ?? '')
const created = await res.json()
console.log(created)
if (!res.ok) process.exit(1)

let videoId = created.video_id ?? created.data?.video_id
const sessionId = created.session_id ?? created.data?.session_id
while (!videoId) {
  await new Promise((r) => setTimeout(r, 15000))
  const s = await (await fetch(`${base}/v3/video-agents/${sessionId}`, { headers })).json()
  console.log('session', s.status ?? s.data?.status)
  videoId = s.video_id ?? s.data?.video_id
  if ((s.status ?? s.data?.status) === 'failed') throw new Error('Session failed: ' + JSON.stringify(s))
}

for (;;) {
  const v = await (await fetch(`${base}/v3/videos/${videoId}`, { headers })).json()
  const d = v.data ?? v
  console.log('video', d.status)
  if (d.status === 'completed') {
    console.log({ duration: d.duration, keys: Object.keys(d), seconds: Math.round((Date.now() - t0) / 1000) })
    const url = d.video_url
    const out = `heygen-${videoId}.mp4`
    await writeFile(out, Buffer.from(await (await fetch(url)).arrayBuffer()))
    console.log('gespeichert:', out, '| captioned_video_url:', d.captioned_video_url ?? '-', '| subtitle_url:', d.subtitle_url ?? '-')
    break
  }
  if (d.status === 'failed') throw new Error('Video failed: ' + JSON.stringify(d))
  await new Promise((r) => setTimeout(r, 15000))
}
