const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  message_id: { type: String, index: true },  // WhatsApp message ID
  meta_msg_id: { type: String, index: true }, // For replies/threads if any
  wa_id: { type: String, index: true },       // WhatsApp number (contact ID)

  from: { type: String, default: 'me' },      // Sender number (default 'me' for outgoing)
  to: { type: String },                       // Receiver number (can be null for incoming messages)

  name: String,                               // Display name of contact
  number: String,                             // Number in readable format
  body: { type: String, required: true },     // Message text
  type: { type: String, default: 'text' },    // text, image, etc.

  timestamp: { type: Date, default: Date.now }, // Auto-set for outgoing messages
  status: { 
    type: String, 
    enum: ['sent', 'delivered', 'read', 'unknown'], 
    default: 'sent' 
  },

  raw: mongoose.Schema.Types.Mixed            // Full raw payload for reference
}, { timestamps: true });

// Automatically set 'to' for outgoing messages
messageSchema.pre('save', function (next) {
  if (this.isNew && this.from === 'me' && !this.to && this.wa_id) {
    this.to = this.wa_id;
  }
  next();
});

module.exports = mongoose.model('Message', messageSchema, 'processed_messages');
