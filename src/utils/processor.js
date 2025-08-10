function extractMessages(payload) {
  const messages = [];

  // --- Standard WhatsApp API payload ---
  if (Array.isArray(payload.entry)) {
    payload.entry.forEach(entry => {
      entry.changes?.forEach(change => {
        const value = change.value || {};
        value.messages?.forEach(m => {
          messages.push(mapMessage(m, value));
        });
      });
    });
  }

  // --- Your custom format: metaData.entry ---
  if (payload.metaData && Array.isArray(payload.metaData.entry)) {
    payload.metaData.entry.forEach(entry => {
      entry.changes?.forEach(change => {
        const value = change.value || {};
        value.messages?.forEach(m => {
          messages.push(mapMessage(m, value));
        });
      });
    });
  }

  // Direct messages array
  if (Array.isArray(payload.messages)) {
    payload.messages.forEach(m => messages.push(mapMessage(m, payload)));
  }

  return messages;
}

function extractStatuses(payload) {
  const statuses = [];

  // Standard
  if (Array.isArray(payload.entry)) {
    payload.entry.forEach(entry => {
      entry.changes?.forEach(change => {
        const value = change.value || {};
        value.statuses?.forEach(s => {
          statuses.push(mapStatus(s));
        });
      });
    });
  }

  // Custom format
  if (payload.metaData && Array.isArray(payload.metaData.entry)) {
    payload.metaData.entry.forEach(entry => {
      entry.changes?.forEach(change => {
        const value = change.value || {};
        value.statuses?.forEach(s => {
          statuses.push(mapStatus(s));
        });
      });
    });
  }

  if (Array.isArray(payload.statuses)) {
    payload.statuses.forEach(s => statuses.push(mapStatus(s)));
  }

  return statuses;
}

function mapMessage(m, ctx = {}) {
  const text = m.text?.body || m.body || '';
  const ts = m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date();

  return {
    id: m.id || m.message_id || null,
    meta_msg_id: m.context?.id || null,
    wa_id: m.from || m.to || '',
    from: m.from || '',
    to: m.to || '',
    name: ctx.contacts?.[0]?.profile?.name || '',
    number: ctx.contacts?.[0]?.wa_id || '',
    body: text,
    type: m.type || 'text',
    timestamp: ts,
    raw: m
  };
}

function mapStatus(s) {
  return {
    id: s.id || s.message_id || null,
    meta_msg_id: s.meta_msg_id || null,
    wa_id: s.recipient_id || '',
    status: s.status || 'unknown',
    raw: s
  };
}

module.exports = { extractMessages, extractStatuses };
