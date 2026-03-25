// src/utils/notification.js

class NotificationService {
  constructor() {
    this.audioContext = null;
    this.audioBuffer = null;
    this.enabled = true;
    this.userInteracted = false;
    this.repeatInterval = null;

    // Lắng nghe gesture để unlock AudioContext
    const unlock = () => {
      this.userInteracted = true;
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }
    };
    ['click', 'touchstart', 'keydown', 'pointerdown'].forEach(evt => {
      document.addEventListener(evt, unlock, { passive: true });
    });

    // Lắng nghe postMessage từ Service Worker
    navigator.serviceWorker && navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'PLAY_SOUND') {
        this.userInteracted = true; // SW gửi = đang có tab focus
        this.playSound();
      }
    });

    this.init();
  }

  async init() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContext();
      console.log('✓ Sound ready');
      await this.loadAudioFile();
    } catch (error) {
      console.warn('Sound not available');
    }

    if (this.hasNotificationAPI() && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }

  async loadAudioFile() {
    try {
      // Fetch không dùng Range header để tránh lỗi 206
      const response = await fetch('/sounds/notification.wav', {
        headers: { 'Range': '' },
        cache: 'force-cache'
      });
      const arrayBuffer = await response.arrayBuffer();
      this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      console.log('✓ Notification sound loaded');
    } catch (error) {
      console.warn('Could not load notification.wav, sẽ dùng beep');
      this.audioBuffer = null;
    }
  }

  hasNotificationAPI() {
    return typeof Notification !== 'undefined';
  }

  async playSound() {
    if (!this.enabled || !this.audioContext) return;
    if (!this.userInteracted) {
      console.warn('⚠ Chưa có user gesture, không phát được chuông');
      return;
    }

    try {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      if (this.audioBuffer) {
        const source = this.audioContext.createBufferSource();
        source.buffer = this.audioBuffer;
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = 0.8;
        source.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        source.start(0);
        console.log('✓ WAV sound played');
      } else {
        // Beep fallback
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);
        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + 0.3);
        console.log('✓ Beep sound played');
      }
    } catch (error) {
      console.warn('Sound play error:', error.message);
    }
  }

  showNotification(title, body) {
    if (!this.hasNotificationAPI() || Notification.permission !== 'granted') return;
    try {
      const notification = new Notification(title, {
        body,
        icon: '/logo192.png',
        badge: '/logo192.png',
        tag: 'msg',
        renotify: true,
        requireInteraction: false,
        silent: false // để hệ thống phát âm thanh mặc định của OS
      });
      notification.onclick = () => {
        window.focus();
        this.userInteracted = true;
        this.playSound();
        notification.close();
      };
      setTimeout(() => notification.close(), 8000);
    } catch (error) {
      // Silently fail
    }
  }

  // Phát chuông + hiện notification ngay lập tức
  notify(customerName, message) {
    console.log('🔔 Notification:', customerName);
    // Phát chuông nếu tab đang focus
    if (!document.hidden) {
      this.playSound();
    }
    // Hiển thị desktop notification (hoạt động kể cả khi tab ẩn)
    this.showNotification(
      `💬 ${customerName}`,
      message ? message.substring(0, 100) : 'Tin nhắn mới'
    );
  }

  // Chuông lặp mỗi 5s cho đến khi gọi stopRepeating()
  startRepeating(customerName, message) {
    this.stopRepeating();
    this.notify(customerName, message);
    this.repeatInterval = setInterval(() => {
      this.notify(customerName, message);
    }, 5000);
  }

  stopRepeating() {
    if (this.repeatInterval) {
      clearInterval(this.repeatInterval);
      this.repeatInterval = null;
    }
  }

  // Tương thích ngược với code cũ
  setEnabled(enabled) { this.enabled = enabled; }
  enable() { this.enabled = true; }
  disable() { this.enabled = false; }
  async enableAudio() { return true; }
  async requestPermission() {
    if (this.hasNotificationAPI()) {
      return await Notification.requestPermission().catch(() => 'denied');
    }
    return 'unsupported';
  }
  checkPermission() {
    return this.hasNotificationAPI() ? Notification.permission : 'unsupported';
  }
}

const notificationService = new NotificationService();
export default notificationService;
