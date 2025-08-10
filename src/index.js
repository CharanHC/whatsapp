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
 *  WEBHOOK ENDPOINT
 * ============================
 */
app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    let inserted = 0, updated = 0;

    // Handle messages
    const messages = extractMessages(payload);
    // Directly extract the name from the raw payload as a fallback
    const rawContactName = payload.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name;

    for (const m of messages) {
      if (!m.id) continue;

      const doc = {
        message_id: m.id,
        meta_msg_id: m.meta_msg_id || null,
        wa_id: m.wa_id,
        from: m.from || m.wa_id, // fallback for inbound messages
        to: m.to || 'me',        // fallback for inbound messages
        name: m.name || rawContactName, // Use the name from the processor or fallback to the raw payload
        number: m.number,
        body: m.body,
        type: m.type,
        timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
        raw: m.raw,
        status: 'sent'
      };

      const existing = await Message.findOne({ message_id: m.id });
      if (existing) {
        await Message.updateOne({ _id: existing._id }, { $set: doc });
        updated++;
      } else {
        await Message.create(doc);
        inserted++;
      }
    }

    // Handle statuses
    const statuses = extractStatuses(payload);
    for (const s of statuses) {
      const msg = await Message.findOne({ message_id: s.id });
      if (msg) {
        msg.status = s.status;
        await msg.save();
        updated++;
      }
    }

    res.json({ ok: true, inserted, updated });
  } catch (error) {
    console.error('Webhook Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * ============================
 *  GET CONVERSATIONS
 * ============================
 */
app.get('/conversations', async (req, res) => {
  try {
    const convs = await Message.aggregate([
      { $sort: { timestamp: -1 } },
      { $group: { _id: "$wa_id", lastMessage: { $first: "$$ROOT" } } },
      { 
        $project: {
          wa_id: "$_id",
          lastMessage: 1
        }
      }
    ]);
    res.json(convs);
  } catch (err) {
    console.error("Get Conversations Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * ============================
 *  GET MESSAGES FOR A CONVERSATION
 * ============================
 */
app.get('/conversations/:wa_id/messages', async (req, res) => {
  try {
    const msgs = await Message.find({ wa_id: req.params.wa_id }).sort({ timestamp: 1 });
    res.json(msgs);
  } catch (err) {
    console.error("Get Messages Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * ============================
 *  SEND MESSAGE
 * ============================
 * This will create an outgoing message in the DB
 * Later, you can connect it to WhatsApp Cloud API to actually send
 */
// index.js or routes/messages.js — your send message route
app.post('/conversations/:wa_id/messages', async (req, res) => {
  try {
    const bodyText = req.body.body?.trim();
    if (!bodyText) {
      return res.status(400).json({ ok: false, error: "Message body is required" });
    }
    
    // Get the name of the recipient to include in the message
    const recipient = await Message.findOne({ wa_id: req.params.wa_id, name: { $exists: true, $ne: null } }).sort({ timestamp: -1 });
    const name = recipient?.name || 'Me'; // Default to 'Me' if no name is found
    
    // Save as sent
    const msg = await Message.create({
      message_id: `out-${uuidv4()}`,
      wa_id: req.params.wa_id,
      from: 'me',
      to: req.params.wa_id,
      name: name, // ⭐ Add the recipient's name here
      body: bodyText,
      type: 'text',
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
// DELETE a message by its _id
app.delete('/messages/:id', async (req, res) => {
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg) {
      return res.status(404).json({ ok: false, error: "Message not found" });
    }

    await Message.deleteOne({ _id: msg._id });
    res.json({ ok: true, message: "Deleted successfully" });
  } catch (err) {
    console.error("Delete Message Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});


    // Send back message so UI updates instantly
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
