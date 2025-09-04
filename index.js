// Diagnostic-friendly bot server
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

// --- health + env checks ---
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/env', (req, res) => {
  res.json({
    has_OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    has_ASSISTANT_ID_CLIENT: !!process.env.ASSISTANT_ID_CLIENT,
    PORT: process.env.PORT || 'not set'
  });
});

// Lazy-create the OpenAI client so the app doesn't crash on boot
let client;
function getClient() {
  if (!client) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('Missing OPENAI_API_KEY');
    client = new OpenAI({ apiKey: key });
  }
  return client;
}

// Simple in-memory session -> thread map
const sessions = new Map();

app.post('/chat', async (req, res) => {
  try {
    console.log('POST /chat body:', req.body);
    const { text, session_id } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text' });

    const client = getClient(); // will throw if key missing

    let threadId = sessions.get(session_id);
    if (!threadId) {
      const t = await client.beta.threads.create();
      threadId = t.id;
      sessions.set(session_id, threadId);
    }

    await client.beta.threads.messages.create(threadId, { role: 'user', content: text });

    const run = await client.beta.threads.runs.create(threadId, {
      assistant_id: process.env.ASSISTANT_ID_CLIENT
    });

    while (true) {
      const r = await client.beta.threads.runs.retrieve(threadId, run.id);
      if (r.status === 'completed') break;
      if (['failed','cancelled','expired'].includes(r.status)) {
        return res.status(500).json({ error: `Run ${r.status}` });
      }
      await new Promise(s => setTimeout(s, 700));
    }

    const msgs = await client.beta.threads.messages.list(threadId, { order: 'desc', limit: 1 });
    const first = msgs.data[0]?.content?.[0];
    const reply = first?.type === 'text' ? first.text.value : 'Done.';
    res.json({ text: reply });
  } catch (err) {
    console.error('ERROR in /chat:', err);
    res.status(500).json({ error: String(err.message || err) });
  }
});
// Root responds 200 OK so Railway's health check passes
app.get('/', (req, res) => res.send('OK'));

// (you already have this one in the diagnostic version, keep it)
app.get('/health', (req, res) => res.json({ ok: true }));
app.listen(process.env.PORT || 3000, () => {
  console.log('Bot server running on port', process.env.PORT || 3000);
});
