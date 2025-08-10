require("dotenv").config();

const fs = require("fs/promises");
const path = require("path");
const mongoose = require("mongoose");
const Message = require("../src/models/Message");

const dir = process.argv[2] || "./sample_payloads";

if (!process.env.MONGODB_URI) {
  console.error("❌ MONGODB_URI is not set in .env file");
  process.exit(1);
}

mongoose
  .connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

async function processFile(filePath) {
  try {
    const rawData = await fs.readFile(filePath, "utf8");
    const payload = JSON.parse(rawData);

    if (payload.payload_type !== "whatsapp_webhook") return;

    const entry = payload.metaData?.entry?.[0];
    if (!entry) return;

    for (const change of entry.changes || []) {
      const value = change.value;

      // Handle incoming messages
      if (value.messages && Array.isArray(value.messages)) {
        const contact = value.contacts?.[0] || {};
        const wa_id = contact.wa_id || value.messages[0]?.from;
        const name = contact.profile?.name || "";

        for (const msgData of value.messages) {
          const exists = await Message.findOne({ message_id: msgData.id });
          if (exists) continue;

          const msg = new Message({
            message_id: msgData.id,
            meta_msg_id: null,
            wa_id,
            from: msgData.from,
            to: value.metadata?.display_phone_number || "unknown",
            name,
            number: wa_id,
            body: msgData.text?.body || "",
            type: msgData.type || "text",
            timestamp: new Date(Number(msgData.timestamp) * 1000),
            status: "sent",
            raw: msgData,
          });

          try {
            await msg.save();
            console.log(`✅ Inserted message: ${msgData.id}`);
          } catch (err) {
            console.error("❌ Error saving message:", err);
          }
        }
      }

      // Handle message status updates
      if (value.statuses && Array.isArray(value.statuses)) {
        for (const status of value.statuses) {
          const updated = await Message.findOneAndUpdate(
            { message_id: status.id },
            { status: status.status },
            { new: true }
          );
          if (updated) {
            console.log(`🔄 Updated status for: ${status.id} -> ${status.status}`);
          }
        }
      }
    }
  } catch (err) {
    console.error(`❌ Error processing file ${filePath}:`, err);
  }
}

(async () => {
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      await processFile(path.join(dir, file));
    }
  } catch (err) {
    console.error("❌ Error reading directory:", err);
  } finally {
    mongoose.connection.close();
  }
})();
