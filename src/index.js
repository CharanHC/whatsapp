require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const Message = require('./models/Message');
const { extractMessages, extractStatuses } = require('./utils/processor');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(bodyParser.json({ limit: '10mb' }));

// ✅ MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

/**
 * ============================
 * WEBHOOK ENDPOINT
 * ============================
 */
app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    let inserted = 0, updated = 0;

    // Handle messages
    const messages = extractMessages(payload);
    for (const m of messages) {
      if (!m.id) continue;

      const doc = {
        message_id: m.id,
        meta_msg_id: m.meta_msg_id || null,
        wa_id: m.wa_id,
        from: m.from || (m.wa_id === process.env.WHATSAPP_PHONE_NUMBER ? 'me' : m.from), // Infer 'me' for outgoing messages
        to: m.to || (m.from === process.env.WHATSAPP_PHONE_NUMBER ? m.wa_id : m.to),
        name: m.name,
        number: m.number,
        body: m.body,
        type: m.type,
        timestamp: m.timestamp,
        status: m.status,
        raw: m.raw,
      };

      await Message.findOneAndUpdate({ message_id: m.id }, doc, { upsert: true, new: true });
      inserted++;
    }

    // Handle statuses
    const statuses = extractStatuses(payload);
    for (const s of statuses) {
      if (!s.id) continue;
      const result = await Message.updateOne({ message_id: s.id }, { status: s.status });
      if (result.matchedCount > 0) updated++;
    }

    if (inserted > 0 || updated > 0) {
      console.log(`✅ Webhook processed: ${inserted} messages inserted/updated, ${updated} statuses updated.`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Webhook error:', err);
    res.sendStatus(500);
  }
});

/**
 * ============================
 * API ENDPOINTS
 * ============================
 */
// GET all conversations with the latest message
app.get('/conversations', async (req, res) => {
  try {
    // Find unique conversation IDs (wa_id)
    const uniqueWaIds = await Message.distinct('wa_id');

    // For each unique conversation ID, find the latest message
    const conversations = await Promise.all(
      uniqueWaIds.map(async (waId) => {
        const lastMessage = await Message.findOne({ wa_id: waId })
          .sort({ timestamp: -1 })
          .exec();

        return {
          wa_id: waId,
          lastMessage: lastMessage ? {
            _id: lastMessage._id,
            body: lastMessage.body,
            timestamp: lastMessage.timestamp,
            name: lastMessage.name,
            status: lastMessage.status
          } : null,
        };
      })
    );

    res.json(conversations);
  } catch (err) {
    console.error('❌ Conversations API error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET all messages for a specific conversation
app.get('/conversations/:wa_id/messages', async (req, res) => {
  try {
    const messages = await Message.find({ wa_id: req.params.wa_id }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (err) {
    console.error('❌ Messages API error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST a new message
app.post('/conversations/:wa_id/messages', async (req, res) => {
  try {
    const { body: bodyText, name } = req.body;
    if (!bodyText) {
      return res.status(400).json({ ok: false, error: 'Message body is required.' });
    }

    // Save as sent
    const msg = await Message.create({
      message_id: `out-${uuidv4()}`,
      wa_id: req.params.wa_id,
      from: 'me',
      to: req.params.wa_id,
      body: bodyText,
      type: 'text',
      timestamp: new Date(),
      status: 'sent',
      name: name,
      raw: { source: 'frontend' }
    });

    // Simulate status progression
    setTimeout(async () => {
      await Message.updateOne({ _id: msg._id }, { $set: { status: 'delivered' } });
    }, 2000); // 2s → delivered

    setTimeout(async () => {
      await Message.updateOne({ _id: msg._id }, { $set: { status: 'read' } });
    }, 4000); // 4s → read (blue tick)

    res.json({ ok: true, message: msg });
  } catch (err) {
    console.error("Send Message Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE a message by its _id
app.delete('/messages/:id', async (req, res) => {
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg) {
      return res.status(404).json({ ok: false, error: 'Message not found.' });
    }
    await msg.remove();
    res.json({ ok: true, message: 'Message deleted.' });
  } catch (err) {
    console.error('❌ Delete Message Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

