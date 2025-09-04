// Minimal website-facing bot server
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

// 🔎 NEW: quick health check so GET /health returns OK
app.get('/health', (req, res) => res.json({ ok: true }));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const sessions = new Map();

app.post('/chat', async (req, res) => {
  try {
    // 🔎 NEW: log the incoming body so we can see it in Railway logs
    console.log('POST /chat body:', req.body);

    const { text, session_id } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text' });

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

    // simple polling
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
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Bot server running on port', process.env.PORT || 3000);
});
