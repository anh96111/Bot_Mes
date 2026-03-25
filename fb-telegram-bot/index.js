require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');
const cors = require('cors');
const googleTranslate = require('google-translate-api-x');
const webpush = require('web-push');

// ============= VAPID SETUP =============
webpush.setVapidDetails(
  'mailto:admin@abcfb.site',
  'BJXRHKuNJzXmuJ_xNZ8D4qpSeODh2ul5nd4j3ZEAhvr2vymr242BkITsR_ZaWj9HUJLG6aaSpHTN9DGh8Ex49C0',
  'X8HUchRMQf-saTFUW96RoJXW6qf1c-YkoI6Z4P9jxjY'
);

// ============= PUSH SUBSCRIPTIONS =============
// Lưu trong memory (đơn giản, không cần DB)
const pushSubscriptions = new Map();

async function sendPushToAll(payload) {
  if (pushSubscriptions.size === 0) return;
  const payloadStr = JSON.stringify(payload);
  const promises = [];
  for (const [key, subscription] of pushSubscriptions) {
    promises.push(
      webpush.sendNotification(subscription, payloadStr)
        .catch(err => {
          // Xóa subscription lỗi (expired/invalid)
          if (err.statusCode === 410 || err.statusCode === 404) {
            pushSubscriptions.delete(key);
            console.log('🗑️ Removed expired subscription:', key);
          } else {
            console.error('Push error:', err.message);
          }
        })
    );
  }
  await Promise.allSettled(promises);
}

// ============= KHỞI TẠO =============
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL ? [process.env.FRONTEND_URL, 'http://localhost:3001'] : '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false
});

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 25 * 1024 * 1024 }
});

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// ============= PAGES CONFIG =============
const pages = [];
for (let i = 1; i <= 10; i++) {
  const pageId = process.env[`PAGE_${i}_ID`];
  const pageName = process.env[`PAGE_${i}_NAME`];
  const pageToken = process.env[`PAGE_${i}_TOKEN`];
  if (pageId && pageToken) pages.push({ id: pageId, name: pageName, token: pageToken });
}
console.log(`✓ Đã cấu hình ${pages.length} fanpage`);

// ============= CONNECTED CLIENTS =============
const connectedClients = new Set();
io.on('connection', (socket) => {
  connectedClients.add(socket.id);
  socket.on('ping', () => socket.emit('pong'));
  socket.on('disconnect', () => connectedClients.delete(socket.id));
  socket.emit('connected', { message: 'Connected', timestamp: new Date().toISOString() });
});

function broadcastToWeb(event, data) {
  io.emit(event, data);
}

// ============= DUPLICATE GUARD =============
const processedMessages = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of processedMessages) {
    if (now - ts > 60000) processedMessages.delete(key);
  }
}, 30000);

// ============= TRANSLATION =============
const translationCache = new Map();

async function dich(text, targetLang) {
  if (!text || text.trim() === '') return text;
  const cacheKey = `${text.trim()}_${targetLang}`;
  if (translationCache.has(cacheKey)) return translationCache.get(cacheKey);
  try {
    const result = await googleTranslate(text, { to: targetLang });
    const translated = result.text;
    if (translationCache.size > 1000) translationCache.delete(translationCache.keys().next().value);
    translationCache.set(cacheKey, translated);
    return translated;
  } catch (error) {
    console.error('Lỗi dịch:', error.message);
    return text;
  }
}

async function dichSangViet(text) {
  if (!text || text.trim() === '') return { banDich: text, daDich: false };
  if (/[ăâđêôơưĂÂĐÊÔƠƯ]/.test(text)) return { banDich: text, daDich: false };
  const banDich = await dich(text, 'vi');
  const daDich = banDich !== text;
  return { banDich, daDich };
}

async function dichSangAnh(text) {
  if (!text || text.trim() === '') return text;
  return await dich(text, 'en');
}

// ============= DATABASE HELPERS =============
async function layThongTinKhach(pageId, senderId, pageToken) {
  try {
    const r = await axios.get(`https://graph.facebook.com/v23.0/${pageId}/conversations`, {
      params: { fields: 'participants', user_id: senderId, access_token: pageToken }
    });
    if (r.data?.data?.length > 0) {
      const p = r.data.data[0].participants.data.find(x => x.id === senderId);
      if (p?.name) return { name: p.name, avatar: null };
    }
  } catch (e) {}
  try {
    const r = await axios.get(`https://graph.facebook.com/v23.0/${senderId}`, {
      params: { fields: 'name,profile_pic', access_token: pageToken }
    });
    if (r.data) return { name: r.data.name || `Khách #${senderId.slice(-6)}`, avatar: r.data.profile_pic || null };
  } catch (e) {}
  return { name: `Khách #${senderId.slice(-6)}`, avatar: null };
}

async function layHoacTaoKhach(pageId, senderId, pageToken, extraData = {}) {
  try {
    const result = await pool.query('SELECT * FROM customers WHERE fb_id = $1 AND page_id = $2', [senderId, pageId]);
    if (result.rows.length > 0) {
      const existing = result.rows[0];
      if (!existing.avatar) {
        const info = await layThongTinKhach(pageId, senderId, pageToken);
        if (info.avatar) {
          await pool.query('UPDATE customers SET avatar = $1 WHERE id = $2', [info.avatar, existing.id]);
          existing.avatar = info.avatar;
        }
      }
      return existing;
    }
    const info = await layThongTinKhach(pageId, senderId, pageToken);
    const name = extraData.name || info.name;
    const avatar = extraData.avatar || info.avatar;
    const newC = await pool.query(
      'INSERT INTO customers (fb_id, page_id, name, avatar, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
      [senderId, pageId, name, avatar]
    );
    return newC.rows[0];
  } catch (e) {
    console.error('Lỗi khách:', e.message);
    return { id: null, fb_id: senderId, name: 'Unknown', avatar: null };
  }
}

async function layNhan(customerId) {
  try {
    const r = await pool.query(`
      SELECT l.name, l.emoji, l.color FROM labels l
      JOIN customer_labels cl ON l.id = cl.label_id WHERE cl.customer_id = $1
    `, [customerId]);
    return r.rows;
  } catch (e) { return []; }
}

async function luuTinNhan(customerId, pageId, senderType, content, mediaType = null, mediaUrl = null, translatedText = null, messageType = 'message') {
  try {
    await pool.query(`
      INSERT INTO messages (customer_id, page_id, sender_type, content, media_type, media_url, translated_text, message_type, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    `, [customerId, pageId, senderType, content, mediaType, mediaUrl, translatedText, messageType]);
  } catch (e) {
    try {
      await pool.query(`
        INSERT INTO messages (customer_id, page_id, sender_type, content, media_type, media_url, translated_text, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `, [customerId, pageId, senderType, content, mediaType, mediaUrl, translatedText]);
    } catch (e2) {
      console.error('Lỗi lưu tin:', e2.message);
    }
  }
}

// ============= FACEBOOK HANDLERS =============
async function xuLyTinNhan(page, senderId, text) {
  try {
    const khach = await layHoacTaoKhach(page.id, senderId, page.token);
    const cacNhan = await layNhan(khach.id);
    const { banDich, daDich } = await dichSangViet(text);

    await luuTinNhan(khach.id, page.id, 'customer', text, null, null, daDich ? banDich : null, 'message');

    const messageData = {
      customerId: khach.id,
      customerName: khach.name,
      customerAvatar: khach.avatar,
      pageId: page.id,
      pageName: page.name,
      message: text,
      translatedText: daDich ? banDich : null,
      senderType: 'customer',
      messageType: 'message',
      language: daDich ? 'en' : 'vi',
      labels: cacNhan,
      timestamp: new Date().toISOString()
    };

    broadcastToWeb('new_message', messageData);

    // Gửi Push Notification
    await sendPushToAll({
      title: `💬 ${khach.name} (${page.name})`,
      body: daDich ? banDich : text,
      icon: khach.avatar || '/logo192.png',
      badge: '/logo192.png',
      tag: `conv-${khach.id}`,
      customerId: khach.id,
      url: '/',
      timestamp: Date.now()
    });

  } catch (e) { console.error('Lỗi xử lý tin:', e); }
}

async function xuLyMedia(page, senderId, attachments, caption = '') {
  try {
    const khach = await layHoacTaoKhach(page.id, senderId, page.token);
    for (const att of attachments) {
      await luuTinNhan(khach.id, page.id, 'customer', caption || '', att.type, att.payload?.url, null, 'message');
      broadcastToWeb('new_message', {
        customerId: khach.id,
        customerName: khach.name,
        customerAvatar: khach.avatar,
        pageId: page.id,
        pageName: page.name,
        message: caption || 'Gửi media',
        mediaType: att.type,
        mediaUrl: att.payload?.url,
        senderType: 'customer',
        messageType: 'message',
        timestamp: new Date().toISOString()
      });

      await sendPushToAll({
        title: `📎 ${khach.name} (${page.name})`,
        body: caption || `Gửi ${att.type}`,
        icon: khach.avatar || '/logo192.png',
        badge: '/logo192.png',
        tag: `conv-${khach.id}`,
        customerId: khach.id,
        url: '/',
        timestamp: Date.now()
      });
    }
  } catch (e) { console.error('Lỗi xử lý media:', e); }
}

async function xuLyBinhLuan(page, comment) {
  try {
    const senderId = comment.from?.id;
    const senderName = comment.from?.name;
    const commentText = comment.message || '';
    const commentId = comment.id;
    const postId = comment.post_id || '';

    if (!senderId || !commentText) return;

    const messageKey = `comment_${commentId}`;
    if (processedMessages.has(messageKey)) return;
    processedMessages.set(messageKey, Date.now());

    const khach = await layHoacTaoKhach(page.id, senderId, page.token, { name: senderName });
    const cacNhan = await layNhan(khach.id);
    const { banDich, daDich } = await dichSangViet(commentText);

    await luuTinNhan(khach.id, page.id, 'customer', commentText, null, commentId, daDich ? banDich : null, 'comment');

    broadcastToWeb('new_message', {
      customerId: khach.id,
      customerName: khach.name,
      customerAvatar: khach.avatar,
      pageId: page.id,
      pageName: page.name,
      message: commentText,
      translatedText: daDich ? banDich : null,
      senderType: 'customer',
      messageType: 'comment',
      commentId: commentId,
      postId: postId,
      labels: cacNhan,
      timestamp: new Date().toISOString()
    });

    await sendPushToAll({
      title: `💬 Bình luận - ${khach.name}`,
      body: daDich ? banDich : commentText,
      icon: khach.avatar || '/logo192.png',
      badge: '/logo192.png',
      tag: `conv-${khach.id}`,
      customerId: khach.id,
      url: '/',
      timestamp: Date.now()
    });

    console.log(`✓ Bình luận từ ${senderName}: ${commentText}`);
  } catch (e) { console.error('Lỗi xử lý bình luận:', e); }
}

// ============= MIDDLEWARE =============
app.use(cors({
  origin: process.env.FRONTEND_URL ? [process.env.FRONTEND_URL, 'http://localhost:3001'] : '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use((req, res, next) => { console.log(`📥 ${req.method} ${req.path}`); next(); });
app.use(express.json());

// ============= HEALTH =============
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/', (req, res) => res.json({ message: 'FB Bot API', status: 'running' }));

// ============= FACEBOOK WEBHOOK =============
app.get('/facebook/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.FB_VERIFY_TOKEN) {
    console.log('✓ Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/facebook/webhook', async (req, res) => {
  const body = req.body;
  res.status(200).send('OK');

  setImmediate(async () => {
    try {
      if (body.object === 'page') {
        for (const entry of body.entry) {
          const pageId = entry.id;
          const page = pages.find(p => p.id === pageId);
          if (!page) continue;

          if (entry.messaging) {
            for (const event of entry.messaging) {
              if (event.message) {
                const key = `${event.sender.id}_${event.message.mid || event.timestamp}`;
                if (processedMessages.has(key)) continue;
                processedMessages.set(key, Date.now());
                if (event.message.text && !event.message.attachments) {
                  await xuLyTinNhan(page, event.sender.id, event.message.text);
                }
                if (event.message.attachments?.length > 0) {
                  await xuLyMedia(page, event.sender.id, event.message.attachments, event.message.text);
                }
              }
            }
          }

          if (entry.changes) {
            for (const change of entry.changes) {
              if (change.field === 'feed' && change.value?.item === 'comment') {
                const value = change.value;
                if (value.verb === 'add' && !value.parent_id) {
                  await xuLyBinhLuan(page, {
                    id: value.comment_id,
                    from: { id: value.from?.id, name: value.from?.name },
                    message: value.message,
                    post_id: value.post_id
                  });
                }
              }
            }
          }
        }
      }
    } catch (e) { console.error('Webhook error:', e); }
  });
});

// ============= API: PUSH SUBSCRIBE =============
app.post('/api/push/subscribe', (req, res) => {
  try {
    const { subscription, device } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ success: false, error: 'Invalid subscription' });
    }
    // Dùng endpoint làm key
    const key = subscription.endpoint;
    pushSubscriptions.set(key, subscription);
    console.log(`✅ Push subscription saved (${pushSubscriptions.size} total) - ${device?.substring(0, 50)}`);
    res.json({ success: true, message: 'Subscribed successfully' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.delete('/api/push/unsubscribe', (req, res) => {
  try {
    const { endpoint } = req.body;
    if (endpoint) {
      pushSubscriptions.delete(endpoint);
      console.log(`✅ Push subscription removed`);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({
    success: true,
    publicKey: 'BJXRHKuNJzXmuJ_xNZ8D4qpSeODh2ul5nd4j3ZEAhvr2vymr242BkITsR_ZaWj9HUJLG6aaSpHTN9DGh8Ex49C0'
  });
});

// ============= API: CONVERSATIONS =============
app.get('/api/conversations', async (req, res) => {
  try {
    const { page_id, limit = 50 } = req.query;
    let query = `
      SELECT c.id, c.fb_id, c.name, c.avatar, c.page_id, c.created_at,
        (SELECT json_agg(json_build_object('name', l.name, 'emoji', l.emoji, 'color', l.color))
         FROM labels l JOIN customer_labels cl ON l.id = cl.label_id WHERE cl.customer_id = c.id) as labels,
        (SELECT content FROM messages m WHERE m.customer_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages m WHERE m.customer_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_at,
        (SELECT sender_type FROM messages m WHERE m.customer_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_sender,
        (SELECT message_type FROM messages m WHERE m.customer_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_type
      FROM customers c
      WHERE EXISTS (SELECT 1 FROM messages WHERE customer_id = c.id)
    `;
    const params = [];
    if (page_id) { params.push(page_id); query += ` AND c.page_id = $${params.length}`; }
    query += ` ORDER BY (SELECT created_at FROM messages m WHERE m.customer_id = c.id ORDER BY m.created_at DESC LIMIT 1) DESC NULLS LAST LIMIT $${params.length + 1}`;
    params.push(limit);
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/conversations/:customerId/messages', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { limit = 50 } = req.query;
    let result;
    try {
      result = await pool.query(`
        SELECT id, sender_type, content, media_type, media_url, translated_text, message_type, created_at
        FROM messages WHERE customer_id = $1 ORDER BY created_at DESC LIMIT $2
      `, [customerId, limit]);
    } catch (e) {
      result = await pool.query(`
        SELECT id, sender_type, content, media_type, media_url, translated_text, created_at
        FROM messages WHERE customer_id = $1 ORDER BY created_at DESC LIMIT $2
      `, [customerId, limit]);
    }
    res.json({ success: true, data: result.rows.reverse() });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/conversations/:customerId/send', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { message, translate: shouldTranslate } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'Message required' });

    const cResult = await pool.query('SELECT fb_id, page_id FROM customers WHERE id = $1', [customerId]);
    if (!cResult.rows.length) return res.status(404).json({ success: false, error: 'Customer not found' });

    const customer = cResult.rows[0];
    const page = pages.find(p => p.id === customer.page_id);
    if (!page) return res.status(404).json({ success: false, error: 'Page not found' });

    let finalMessage = message;
    if (shouldTranslate) finalMessage = await dichSangAnh(message);

    const response = await axios.post(`https://graph.facebook.com/v23.0/me/messages`,
      { recipient: { id: customer.fb_id }, message: { text: finalMessage }, messaging_type: 'RESPONSE' },
      { params: { access_token: page.token } }
    );

    if (response.data.message_id) {
      await luuTinNhan(customerId, customer.page_id, 'admin', finalMessage, null, null, null, 'message');
      broadcastToWeb('message_sent', { customerId, message: finalMessage, timestamp: new Date().toISOString() });
      res.json({ success: true, data: { messageId: response.data.message_id, message: finalMessage } });
    }
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/conversations/:customerId/reply-comment', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { commentId, message, translate: shouldTranslate } = req.body;
    if (!commentId || !message) return res.status(400).json({ success: false, error: 'commentId and message required' });

    const cResult = await pool.query('SELECT fb_id, page_id FROM customers WHERE id = $1', [customerId]);
    if (!cResult.rows.length) return res.status(404).json({ success: false, error: 'Customer not found' });

    const customer = cResult.rows[0];
    const page = pages.find(p => p.id === customer.page_id);
    if (!page) return res.status(404).json({ success: false, error: 'Page not found' });

    let finalMessage = message;
    if (shouldTranslate) finalMessage = await dichSangAnh(message);

    const response = await axios.post(
      `https://graph.facebook.com/v23.0/${commentId}/comments`,
      { message: finalMessage },
      { params: { access_token: page.token } }
    );

    if (response.data.id) {
      await luuTinNhan(customerId, customer.page_id, 'admin', finalMessage, null, null, null, 'comment');
      broadcastToWeb('message_sent', { customerId, message: finalMessage, messageType: 'comment', timestamp: new Date().toISOString() });
      res.json({ success: true, data: { commentId: response.data.id, message: finalMessage } });
    }
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/conversations/:customerId/send-from-comment', async (req, res) => {
  try {
    const { customerId } = req.params;
    const { message, translate: shouldTranslate } = req.body;
    if (!message) return res.status(400).json({ success: false, error: 'Message required' });

    const cResult = await pool.query('SELECT fb_id, page_id FROM customers WHERE id = $1', [customerId]);
    if (!cResult.rows.length) return res.status(404).json({ success: false, error: 'Customer not found' });

    const customer = cResult.rows[0];
    const page = pages.find(p => p.id === customer.page_id);
    if (!page) return res.status(404).json({ success: false, error: 'Page not found' });

    let finalMessage = message;
    if (shouldTranslate) finalMessage = await dichSangAnh(message);

    const response = await axios.post(`https://graph.facebook.com/v23.0/me/messages`,
      { recipient: { id: customer.fb_id }, message: { text: finalMessage }, messaging_type: 'MESSAGE_TAG', tag: 'CONFIRMED_EVENT_UPDATE' },
      { params: { access_token: page.token } }
    );

    if (response.data.message_id) {
      await luuTinNhan(customerId, customer.page_id, 'admin', finalMessage, null, null, null, 'message');
      broadcastToWeb('message_sent', { customerId, message: finalMessage, timestamp: new Date().toISOString() });
      res.json({ success: true, data: { messageId: response.data.message_id, message: finalMessage } });
    }
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/conversations/:customerId/send-media', upload.single('file'), async (req, res) => {
  try {
    const { customerId } = req.params;
    const { message } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, error: 'No file' });

    const cResult = await pool.query('SELECT fb_id, page_id FROM customers WHERE id = $1', [customerId]);
    if (!cResult.rows.length) { fs.unlinkSync(file.path); return res.status(404).json({ success: false, error: 'Not found' }); }

    const customer = cResult.rows[0];
    const page = pages.find(p => p.id === customer.page_id);
    if (!page) { fs.unlinkSync(file.path); return res.status(404).json({ success: false, error: 'Page not found' }); }

    let attachmentType = 'file';
    if (file.mimetype.startsWith('image/')) attachmentType = 'image';
    else if (file.mimetype.startsWith('video/')) attachmentType = 'video';
    else if (file.mimetype.startsWith('audio/')) attachmentType = 'audio';

    const formData = new FormData();
    formData.append('recipient', JSON.stringify({ id: customer.fb_id }));
    formData.append('message', JSON.stringify({ attachment: { type: attachmentType, payload: { is_reusable: true } } }));
    formData.append('filedata', fs.createReadStream(file.path), { filename: file.originalname, contentType: file.mimetype });

    const response = await axios.post('https://graph.facebook.com/v23.0/me/messages', formData, {
      params: { access_token: page.token }, headers: formData.getHeaders()
    });

    fs.unlinkSync(file.path);
    if (response.data.message_id) {
      await luuTinNhan(customerId, customer.page_id, 'admin', message || '', attachmentType, file.originalname, null, 'message');
      res.json({ success: true, data: { messageId: response.data.message_id } });
    }
  } catch (e) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============= API: LABELS =============
app.get('/api/labels', async (req, res) => {
  try {
    const r = await pool.query('SELECT id, name, emoji, color FROM labels ORDER BY name');
    res.json({ success: true, data: r.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/labels', async (req, res) => {
  try {
    const { name, emoji, color } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Name required' });
    const r = await pool.query(
      'INSERT INTO labels (name, emoji, color, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *',
      [name.toLowerCase(), emoji || '🏷️', color || '#999999']
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ success: false, error: 'Label exists' });
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/labels/:id', async (req, res) => {
  try {
    const { name, emoji, color } = req.body;
    const r = await pool.query(
      'UPDATE labels SET name = $1, emoji = $2, color = $3 WHERE id = $4 RETURNING *',
      [name.toLowerCase(), emoji || '🏷️', color || '#999999', req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/labels/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM customer_labels WHERE label_id = $1', [req.params.id]);
    const r = await pool.query('DELETE FROM labels WHERE id = $1 RETURNING *', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/customers/:customerId/labels', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT l.id, l.name, l.emoji, l.color FROM labels l
      JOIN customer_labels cl ON l.id = cl.label_id WHERE cl.customer_id = $1 ORDER BY l.name
    `, [req.params.customerId]);
    res.json({ success: true, data: r.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/customers/:customerId/labels', async (req, res) => {
  try {
    await pool.query(
      'INSERT INTO customer_labels (customer_id, label_id, added_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING',
      [req.params.customerId, req.body.labelId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/customers/:customerId/labels/:labelId', async (req, res) => {
  try {
    await pool.query('DELETE FROM customer_labels WHERE customer_id = $1 AND label_id = $2', [req.params.customerId, req.params.labelId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ============= API: QUICK REPLIES =============
app.get('/api/quickreplies', async (req, res) => {
  try {
    const r = await pool.query('SELECT id, key, emoji, text_vi, text_en FROM quick_replies ORDER BY key');
    res.json({ success: true, data: r.rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/quickreplies', async (req, res) => {
  try {
    const { key, emoji, text_vi, text_en } = req.body;
    if (!key || !text_vi || !text_en) return res.status(400).json({ success: false, error: 'Missing fields' });
    const r = await pool.query(
      'INSERT INTO quick_replies (key, emoji, text_vi, text_en, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
      [key, emoji || '💬', text_vi, text_en]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ success: false, error: 'Key exists' });
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/quickreplies/:id', async (req, res) => {
  try {
    const { key, emoji, text_vi, text_en } = req.body;
    const r = await pool.query(
      'UPDATE quick_replies SET key = $1, emoji = $2, text_vi = $3, text_en = $4 WHERE id = $5 RETURNING *',
      [key, emoji || '💬', text_vi, text_en, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/quickreplies/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM quick_replies WHERE id = $1 RETURNING *', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ============= API: TRANSLATE =============
app.post('/api/translate', async (req, res) => {
  try {
    const { text, to = 'en' } = req.body;
    if (!text) return res.status(400).json({ success: false, error: 'Text required' });
    let translated;
    if (to === 'en') translated = await dichSangAnh(text);
    else if (to === 'vi') { const r = await dichSangViet(text); translated = r.banDich; }
    else return res.status(400).json({ success: false, error: 'Unsupported language' });
    res.json({ success: true, data: { original: text, translated, language: to } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ============= API: HEALTH =============
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
    connectedClients: connectedClients.size,
    pushSubscriptions: pushSubscriptions.size
  });
});

// ============= START =============
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📄 Pages: ${pages.length}`);
  console.log(`${'='.repeat(50)}\n`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
