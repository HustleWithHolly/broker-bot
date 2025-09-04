// Minimal website-facing bot server
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');

const app = express();
app.use(express.json());

// Allow your website to call this server
app.use(cors({ origin: '*' }));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Track sessions for conversation memory
const sessions = new Map();

app.post('/chat', async (req, res) => {
  try {
    const { text, session_id } = req.body;
    if (!text) return res.status(400).json({ error: 'Missing text' });

    // One thread per website session
    let threadId = sessions.get(session_id);
    if (!threadId) {
      const t = await client.beta.threads.create();
      threadId = t.id;
      sessions.set(session_id, threadId);
    }

    // Add user message
    await client.beta.threads.messages.create(threadId, {
      role: 'user',
      content: text
    });

    // Run the Assistant
    const run = await client.beta.threads.runs.create(threadId, {
      assistant_id: process.env.ASSISTANT_ID_CLIENT
    });

    // Wait for completion (simple polling)
    while (true) {
      const r = await client.beta.threads.runs.retrieve(threadId, run.id);
      if (r.status === 'completed') break;
      if (['failed', 'cancelled', 'expired'].includes(r.status)) {
        return res.status(500).json({ error: `Run ${r.status}` });
      }
      await new Promise((s) => setTimeout(s, 700));
    }

    // Get last Assistant message
    const msgs = await client.beta.threads.messages.list(threadId, { order: 'desc', limit: 1 });
    const first = msgs.data[0]?.content?.[0];
    const reply = first?.type === 'text' ? first.text.value : 'Done.';

    res.json({ text: reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Bot server running');
});
