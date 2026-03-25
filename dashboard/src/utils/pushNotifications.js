const VAPID_PUBLIC_KEY = 'BJXRHKuNJzXmuJ_xNZ8D4qpSeODh2ul5nd4j3ZEAhvr2vymr242BkITsR_ZaWj9HUJLG6aaSpHTN9DGh8Ex49C0';
const API_URL = process.env.REACT_APP_API_URL || 'https://abcfb.site';

class PushNotificationManager {
  constructor() {
    this.swRegistration = null;
    this.isSupported = 'PushManager' in window && 'serviceWorker' in navigator;
    this.subscription = null;
  }

  async init() {
    if (!this.isSupported) {
      console.log('❌ Push not supported');
      return false;
    }

    try {
      this.swRegistration = await navigator.serviceWorker.ready;
      console.log('✅ SW ready');

      const permission = await this.requestPermission();
      if (permission !== 'granted') {
        console.log('❌ Push permission denied');
        return false;
      }

      await this.subscribeUser();
      return true;
    } catch (error) {
      console.error('Push init error:', error);
      return false;
    }
  }

  async requestPermission() {
    if (Notification.permission === 'granted') return 'granted';
    const permission = await Notification.requestPermission();
    console.log('📨 Push permission:', permission);
    return permission;
  }

  async subscribeUser() {
    try {
      // Lấy subscription hiện có
      let subscription = await this.swRegistration.pushManager.getSubscription();

      if (!subscription) {
        const convertedKey = this.urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
        subscription = await this.swRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedKey
        });
        console.log('✅ Push subscription created');
      }

      this.subscription = subscription;
      await this.sendSubscriptionToBackend(subscription);
      return subscription;
    } catch (error) {
      console.error('Subscribe error:', error);
      return null;
    }
  }

  async sendSubscriptionToBackend(subscription) {
    try {
      const response = await fetch(`${API_URL}/api/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: subscription,
          device: navigator.userAgent
        })
      });

      if (response.ok) {
        console.log('✅ Subscription sent to backend');
      } else {
        console.error('Failed to send subscription:', response.status);
      }
    } catch (error) {
      console.error('Failed to send subscription:', error);
    }
  }

  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async unsubscribe() {
    try {
      const subscription = await this.swRegistration?.pushManager.getSubscription();
      if (subscription) {
        await fetch(`${API_URL}/api/push/unsubscribe`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint })
        });
        await subscription.unsubscribe();
        console.log('✅ Push unsubscribed');
      }
    } catch (error) {
      console.error('Unsubscribe error:', error);
    }
  }
}

export default new PushNotificationManager();
