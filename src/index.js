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

// Set the CORS origin to allow your frontend URL.
// The `|| '*`' is a fallback for development.
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
        ...m,
      };

      await Message.updateOne(
        { message_id: m.id },
        { $set: doc },
        { upsert: true }
      );
      inserted++;
    }

    // Handle message status updates
    const statuses = extractStatuses(payload);
    for (const s of statuses) {
      if (!s.id) continue;

      await Message.updateOne(
        { message_id: s.id },
        { $set: { status: s.status } }
      );
      updated++;
    }

    console.log(`✅ Webhook processed: ${inserted} messages, ${updated} statuses`);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("❌ Webhook Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * ============================
 * NEW API ENDPOINTS
 * ============================
 */

// ✅ GET all conversations (grouped by wa_id)
app.get('/conversations', async (req, res) => {
  try {
    // Aggregation to find the last message for each unique wa_id
    const conversations = await Message.aggregate([
      { $sort: { timestamp: -1 } }, // Sort by timestamp descending to get the most recent message first
      {
        $group: {
          _id: "$wa_id", // Group by the WhatsApp ID
          lastMessage: { $first: "$$ROOT" }, // Get the entire document of the most recent message in the group
        },
      },
      {
        $project: {
          _id: 0, // Exclude the default _id field
          wa_id: "$_id", // Rename the grouped ID to wa_id
          lastMessage: "$lastMessage", // Include the last message document
        },
      },
      {
        $sort: { "lastMessage.timestamp": -1 } // Sort the final conversations by the last message's timestamp
      }
    ]);
    res.json(conversations);
  } catch (err) {
    console.error("❌ Load conversations error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ✅ GET all messages for a specific conversation
app.get('/conversations/:wa_id/messages', async (req, res) => {
  try {
    const messages = await Message.find({ wa_id: req.params.wa_id }).sort({
      timestamp: 1, // Sort messages in chronological order
    });
    res.json(messages);
  } catch (err) {
    console.error("❌ Load messages error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ✅ POST to send a message
app.post('/send/:wa_id', async (req, res) => {
  try {
    const { body } = req.body;
    if (!body) {
      return res.status(400).json({ ok: false, error: "Message body is required." });
    }

    // Save the outgoing message with a unique ID
    const msg = await Message.create({
      message_id: `out-${uuidv4()}`,
      wa_id: req.params.wa_id,
      from: 'me',
      to: req.params.wa_id,
      body: body,
      type: 'text',
      timestamp: new Date(),
      status: 'sent',
      raw: { source: 'frontend' }
    });

    // Simulate status progression (for demo purposes)
    setTimeout(async () => {
      await Message.updateOne({ _id: msg._id }, { $set: { status: 'delivered' } });
    }, 2000); // 2s -> delivered

    setTimeout(async () => {
      await Message.updateOne({ _id: msg._id }, { $set: { status: 'read' } });
    }, 4000); // 4s -> read (blue tick)

    res.json({ ok: true, message: msg });
  } catch (err) {
    console.error("❌ Send Message Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ✅ DELETE a message by its _id
app.delete('/messages/:id', async (req, res) => {
  try {
    const msg = await Message.findByIdAndDelete(req.params.id);
    if (!msg) {
      return res.status(404).json({ ok: false, error: "Message not found." });
    }
    res.json({ ok: true, message: "Message deleted" });
  } catch (err) {
    console.error("❌ Delete Message Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));

module.exports = app;
