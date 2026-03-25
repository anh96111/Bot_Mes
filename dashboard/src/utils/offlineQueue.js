class OfflineQueueManager {
  constructor() {
    this.dbName = 'FBDashboard';
    this.dbVersion = 1;
    this.db = null;
    this.init();
  }

  async init() {
    try {
      this.db = await this.openDB();
      console.log('✅ IndexedDB ready');
      
      // Register background sync when online
      window.addEventListener('online', () => {
        this.requestBackgroundSync();
      });
    } catch (error) {
      console.error('IndexedDB init error:', error);
    }
  }

  openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        if (!db.objectStoreNames.contains('pendingMessages')) {
          const store = db.createObjectStore('pendingMessages', { 
            keyPath: 'id', 
            autoIncrement: true 
          });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
        
        if (!db.objectStoreNames.contains('conversations')) {
          db.createObjectStore('conversations', { keyPath: 'id' });
        }
      };
    });
  }

  async savePendingMessage(customerId, message, translate = false) {
    if (!this.db) return;
    
    const messageData = {
      customerId,
      message,
      translate,
      timestamp: Date.now(),
      status: 'pending'
    };
    
    try {
      const tx = this.db.transaction('pendingMessages', 'readwrite');
      await tx.objectStore('pendingMessages').add(messageData);
      
      console.log('✅ Message queued for sync');
      
      // Notify service worker
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'SAVE_PENDING_MESSAGE',
          message: messageData
        });
      }
      
      // Request sync
      this.requestBackgroundSync();
      
      return true;
    } catch (error) {
      console.error('Failed to save pending message:', error);
      return false;
    }
  }

  async requestBackgroundSync() {
    if ('serviceWorker' in navigator && 'sync' in ServiceWorkerRegistration.prototype) {
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.sync.register('send-messages');
        console.log('✅ Background sync registered');
      } catch (error) {
        console.error('Background sync registration failed:', error);
      }
    }
  }

  async getPendingMessages() {
    if (!this.db) return [];
    
    try {
      const tx = this.db.transaction('pendingMessages', 'readonly');
      const messages = await tx.objectStore('pendingMessages').getAll();
      return messages;
    } catch (error) {
      console.error('Failed to get pending messages:', error);
      return [];
    }
  }

  async clearPendingMessages() {
    if (!this.db) return;
    
    try {
      const tx = this.db.transaction('pendingMessages', 'readwrite');
      await tx.objectStore('pendingMessages').clear();
      console.log('✅ Pending messages cleared');
    } catch (error) {
      console.error('Failed to clear pending messages:', error);
    }
  }

  async saveConversation(conversation) {
    if (!this.db) return;
    
    try {
      const tx = this.db.transaction('conversations', 'readwrite');
      await tx.objectStore('conversations').put(conversation);
      console.log('✅ Conversation cached');
    } catch (error) {
      console.error('Failed to cache conversation:', error);
    }
  }

  async getConversations() {
    if (!this.db) return [];
    
    try {
      const tx = this.db.transaction('conversations', 'readonly');
      const conversations = await tx.objectStore('conversations').getAll();
      return conversations;
    } catch (error) {
      console.error('Failed to get cached conversations:', error);
      return [];
    }
  }
}

export default new OfflineQueueManager();
