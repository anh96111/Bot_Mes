import React, { useState, useEffect } from 'react';
import notificationService from '../utils/notification';

const NotificationSettings = ({ onClose }) => {
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [notifPermission, setNotifPermission] = useState('default');

  useEffect(() => {
    if ('Notification' in window) {
      setNotifPermission(Notification.permission);
    }
  }, []);

  const handleEnableAudio = async () => {
    try {
      await notificationService.enableAudio();
      setAudioEnabled(true);
      
      // Test sound
      notificationService.playSound();
    } catch (error) {
      console.error('Error enabling audio:', error);
      alert('Không thể bật âm thanh');
    }
  };

  const handleRequestNotification = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      setNotifPermission(permission);
      
      if (permission === 'granted') {
        notificationService.showNotification('Thành công!', 'Bạn sẽ nhận thông báo khi có tin mới');
      }
    }
  };

  return (
    <div className="fixed bottom-4 right-4 bg-white rounded-lg shadow-lg p-4 border border-gray-200 max-w-sm z-50">
      <h3 className="font-semibold text-gray-800 mb-3">🔔 Cài đặt thông báo</h3>
      
      {/* Audio */}
      <div className="mb-3">
        {!audioEnabled ? (
          <button
            onClick={handleEnableAudio}
            className="w-full px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded transition"
          >
            🔊 Bật âm thanh thông báo
          </button>
        ) : (
          <div className="flex items-center gap-2 text-green-600">
            <span>✅</span>
            <span className="text-sm">Âm thanh đã bật</span>
          </div>
        )}
      </div>

      {/* Browser Notification */}
      <div>
        {notifPermission === 'default' && (
          <button
            onClick={handleRequestNotification}
            className="w-full px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded transition"
          >
            🔔 Cho phép thông báo trình duyệt
          </button>
        )}
        {notifPermission === 'granted' && (
          <div className="flex items-center gap-2 text-blue-600">
            <span>✅</span>
            <span className="text-sm">Thông báo đã bật</span>
          </div>
        )}
        {notifPermission === 'denied' && (
          <div className="text-xs text-red-600">
            ⚠️ Thông báo bị chặn. Vào Settings trình duyệt để bật lại.
          </div>
        )}
      </div>

      {(audioEnabled && notifPermission === 'granted') && (
        <button
          onClick={onClose}
          className="w-full mt-3 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded transition text-sm"
        >
          Đóng
        </button>
      )}
    </div>
  );
};

export default NotificationSettings;
