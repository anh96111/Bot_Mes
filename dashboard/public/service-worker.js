const CACHE_NAME = 'fb-dashboard-v4'; // tăng version để force update
const API_URL = 'https://abcfb.site';

const urlsToCache = [
  '/',
  '/logo192.png'
  // KHÔNG cache notification.wav ở đây — tránh lỗi 206
];

// Install
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(urlsToCache).catch(err => {
        console.log('Cache error (non-fatal):', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch — bỏ qua file audio để tránh lỗi partial response 206
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return;
  if (event.request.url.includes('/socket.io/')) return;
  if (event.request.url.includes('/facebook/')) return;
  if (event.request.url.includes('.wav')) return; // ← FIX lỗi 206
  if (event.request.url.includes('.mp3')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Chỉ cache response hoàn chỉnh (status 200)
        if (response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then(response => {
          return response || caches.match('/');
        });
      })
  );
});

// ============= PUSH NOTIFICATIONS =============
self.addEventListener('push', event => {
  console.log('📨 Push received');

  let data = {
    title: '💬 FB Dashboard',
    body: 'Tin nhắn mới',
    icon: '/logo192.png',
    badge: '/logo192.png',
    customerId: null,
    tag: 'message'
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    } catch (e) {
      data.body = event.data.text() || 'Tin nhắn mới';
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/logo192.png',
    badge: '/logo192.png',
    tag: data.tag || 'message',
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200],
    // KHÔNG dùng sound property — không được hỗ trợ
    data: {
      customerId: data.customerId,
      url: data.url || '/',
      timestamp: data.timestamp || Date.now()
    },
    actions: [
      { action: 'view', title: '👁️ Xem ngay' },
      { action: 'close', title: '✕ Đóng' }
    ]
  };

  event.waitUntil(
    // Hiển thị notification
    self.registration.showNotification(data.title, options)
      .then(() => {
        // Gửi postMessage tới tab đang mở để phát chuông
        return self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      })
      .then(clientList => {
        clientList.forEach(client => {
          client.postMessage({
            type: 'PLAY_SOUND',
            customerId: data.customerId,
            senderName: data.title,
            body: data.body
          });
        });
      })
  );
});

// Notification click
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'close') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        for (let client of clientList) {
          if (client.url.includes('abcfb.site') && 'focus' in client) {
            client.focus();
            client.postMessage({
              type: 'notification-click',
              customerId: event.notification.data?.customerId
            });
            return;
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
  );
});

// Background Sync
self.addEventListener('sync', event => {
  if (event.tag === 'send-messages') {
    event.waitUntil(syncMessages());
  } else if (event.tag === 'sync-data') {
    event.waitUntil(syncAllData());
  }
});

async function syncMessages() {
  try {
    const db = await openDB();
    const tx = db.transaction('pendingMessages', 'readonly');
    const messages = await getAllFromStore(tx.objectStore('pendingMessages'));

    for (const msg of messages) {
      try {
        const response = await fetch(`${API_URL}/api/conversations/${msg.customerId}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg.message, translate: msg.translate })
        });
        if (response.ok) {
          const deleteTx = db.transaction('pendingMessages', 'readwrite');
          deleteTx.objectStore('pendingMessages').delete(msg.id);
          console.log('✅ Synced message:', msg.id);
        }
      } catch (e) {
        console.error('Sync message error:', e);
      }
    }
  } catch (e) {
    console.error('Sync error:', e);
  }
}

async function syncAllData() {
  const allClients = await self.clients.matchAll();
  allClients.forEach(client => {
    client.postMessage({ type: 'sync-complete', timestamp: Date.now() });
  });
}

// IndexedDB helpers
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('FBDashboard', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pendingMessages')) {
        db.createObjectStore('pendingMessages', { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

function getAllFromStore(store) {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// SW Messages
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'SAVE_PENDING_MESSAGE') savePendingMessage(event.data.message);
});

async function savePendingMessage(message) {
  try {
    const db = await openDB();
    const tx = db.transaction('pendingMessages', 'readwrite');
    tx.objectStore('pendingMessages').add(message);
    console.log('✅ Pending message saved');
  } catch (e) {
    console.error('Save pending error:', e);
  }
}
