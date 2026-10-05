// WP0.1 Spike: Deepseek JSON-Output, usage-Felder, Modellname.
// Aufruf: DEEPSEEK_API_KEY=... [DEEPSEEK_MODEL=deepseek-flash] node scripts/spikes/deepseek-json.mjs
const key = process.env.DEEPSEEK_API_KEY
if (!key) throw new Error('DEEPSEEK_API_KEY fehlt')
const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-flash'
const res = await fetch('https://api.deepseek.com/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    max_tokens: 1000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Antworte nur als json: {"topics":[{"title":"...","angle":"..."}]}' },
      { role: 'user', content: 'Gib 3 Themenideen fuer Kurzvideos ueber Haushaltstipps.' },
    ],
  }),
})
console.log('status', res.status)
const body = await res.json()
console.log('content:', body.choices?.[0]?.message?.content || '(LEER - Retry-Fall)')
console.log('usage:', body.usage)
