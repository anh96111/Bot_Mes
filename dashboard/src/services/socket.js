import io from 'socket.io-client';

class SocketService {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.messageQueue = [];
    this.handlers = {};
    this.pendingHandlers = {}; // handlers đăng ký trước khi socket tồn tại
  }

  connect() {
    if (this.socket && this.connected) {
      console.log('🔌 Socket already connected');
      return;
    }

    if (this.socket && !this.connected) {
      this.socket.connect();
      return;
    }

    const API_URL = process.env.REACT_APP_API_URL || 'https://abcfb.site';
    console.log('🔌 Connecting to Socket.io:', API_URL);

    this.socket = io(API_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      forceNew: false,
      pingTimeout: 60000,
      pingInterval: 25000,
      autoConnect: true,
      query: {
        device: /iPhone|iPad|Android/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
      }
    });

    // Đăng ký lại tất cả pending handlers
    Object.entries(this.pendingHandlers).forEach(([event, cb]) => {
      this.handlers[event] = cb;
      this.socket.on(event, cb);
    });
    this.pendingHandlers = {};

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.socket.on('connect', () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      console.log('✅ Socket connected!', this.socket.id);
      this.flushMessageQueue();
      window.dispatchEvent(new CustomEvent('socketReconnected'));
    });

    this.socket.on('connect_error', (error) => {
      console.error('❌ Socket connection error:', error.message);
      this.connected = false;
      this.reconnectAttempts++;
      if (this.reconnectAttempts > 3) {
        this.socket.io.opts.transports = ['polling'];
      }
    });

    this.socket.on('disconnect', (reason) => {
      console.log('🔌 Socket disconnected:', reason);
      this.connected = false;
      if (reason === 'io server disconnect') {
        setTimeout(() => this.socket.connect(), 1000);
      }
    });

    this.socket.on('pong', () => {
      console.log('🏓 Pong received');
    });

    // Keep-alive ping mỗi 25s
    setInterval(() => {
      if (!document.hidden && this.connected && this.socket) {
        this.socket.emit('ping');
      }
    }, 25000);

    // Reconnect khi online
    window.addEventListener('online', () => {
      console.log('📶 Network online');
      if (!this.connected && this.socket) this.socket.connect();
    });

    // Tab visible → check kết nối
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        console.log('👁️ Tab visible again');
        if (this.socket && !this.socket.connected) {
          console.log('🔄 Reconnecting...');
          this.socket.connect();
        }
      } else {
        console.log('👁️ Tab hidden');
      }
    });
  }

  flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const { event, data } = this.messageQueue.shift();
      this.emit(event, data);
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
      this.handlers = {};
    }
  }

  on(event, callback) {
    if (!this.socket) {
      // Socket chưa tồn tại → lưu vào pending, sẽ đăng ký khi connect()
      console.log('⏳ Queuing handler for:', event);
      this.pendingHandlers[event] = callback;
      return;
    }
    // Xóa handler cũ nếu có
    if (this.handlers[event]) {
      this.socket.off(event, this.handlers[event]);
    }
    this.handlers[event] = callback;
    this.socket.on(event, callback);
  }

  off(event) {
    if (this.socket && this.handlers[event]) {
      this.socket.off(event, this.handlers[event]);
      delete this.handlers[event];
    }
    // Xóa cả pending handler nếu có
    if (this.pendingHandlers[event]) {
      delete this.pendingHandlers[event];
    }
  }

  emit(event, data) {
    if (this.socket && this.connected) {
      this.socket.emit(event, data);
    } else {
      console.warn('⚠️ Socket not connected, queuing:', event);
      this.messageQueue.push({ event, data });
    }
  }

  forceReconnect() {
    if (this.socket) {
      this.socket.disconnect();
      setTimeout(() => this.connect(), 100);
    }
  }
}

export default new SocketService();
