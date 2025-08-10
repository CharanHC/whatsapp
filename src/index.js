// index.js
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

// ✅ Fixed CORS policy to allow all origins
app.use(cors({ origin: '*' }));
app.use(bodyParser.json({ limit: '10mb' }));

// ✅ MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

/**
 * =============================
 * WEBHOOK ENDPOINT
 * =============================
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
        from: m.from,
        to: m.to,
        name: m.name,
        number: m.number,
        body: m.body,
        type: m.type,
        timestamp: m.timestamp,
        status: 'sent',
        raw: m.raw,
      };

      const existingMsg = await Message.findOne({ message_id: m.id });
      if (!existingMsg) {
        await Message.create(doc);
        inserted++;
      }
    }

    // Handle message status updates
    const statuses = extractStatuses(payload);
    for (const s of statuses) {
      if (!s.id) continue;
      const updatedMsg = await Message.findOneAndUpdate({ message_id: s.id }, { status: s.status });
      if (updatedMsg) updated++;
    }

    res.json({ ok: true, inserted, updated });
  } catch (err) {
    console.error("Webhook Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * =============================
 * API ENDPOINTS
 * =============================
 */

// ✅ GET all conversations with the last message
app.get('/conversations', async (req, res) => {
  try {
    const conversations = await Message.aggregate([
      // Group by 'wa_id' to get the last message for each conversation
      {
        $group: {
          _id: "$wa_id",
          lastMessage: { $last: "$$ROOT" },
          name: { $last: "$name" },
        }
      },
      // Sort conversations by the last message timestamp in descending order
      {
        $sort: { "lastMessage.timestamp": -1 }
      },
      // Project the desired output format
      {
        $project: {
          _id: 0,
          wa_id: "$_id",
          name: "$name",
          lastMessage: {
            _id: "$lastMessage._id",
            body: "$lastMessage.body",
            timestamp: "$lastMessage.timestamp",
            status: "$lastMessage.status",
            name: "$lastMessage.name",
            from: "$lastMessage.from",
          }
        }
      }
    ]);

    res.json(conversations);
  } catch (err) {
    console.error("Get Conversations Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ✅ GET all messages for a specific conversation
app.get('/conversations/:wa_id/messages', async (req, res) => {
  try {
    const messages = await Message.find({ wa_id: req.params.wa_id }).sort('timestamp');
    res.json(messages);
  } catch (err) {
    console.error("Get Messages Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ✅ POST a new message
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
      name,
      timestamp: new Date(),
      status: 'sent',
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

// ✅ DELETE a message by its _id
app.delete('/messages/:id', async (req, res) => {
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg) {
      return res.status(404).json({ ok: false, error: 'Message not found.' });
    }

    if (msg.from !== 'me') {
      return res.status(403).json({ ok: false, error: 'Cannot delete messages from other users.' });
    }

    await Message.deleteOne({ _id: req.params.id });
    res.json({ ok: true, message: 'Message deleted.' });
  } catch (err) {
    console.error("Delete Message Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
