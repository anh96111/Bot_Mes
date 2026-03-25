// Dashboard.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from '../components/Sidebar';
import ChatWindow from '../components/ChatWindow';
import QuickReplyManager from '../components/QuickReplyManager';
import { conversationsAPI, labelsAPI, quickRepliesAPI } from '../services/api';
import socketService from '../services/socket';
import notificationService from '../utils/notification';
import pushManager from '../utils/pushNotifications';

const Dashboard = () => {
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [labels, setLabels] = useState([]);
  const [quickReplies, setQuickReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showQRManager, setShowQRManager] = useState(false);
  const [unreadConversations, setUnreadConversations] = useState(new Set());
  const [messageReloadTriggers, setMessageReloadTriggers] = useState({});

  // Refs — dùng ref để tránh stale closure trong socket handler
  const alarmIntervalRef = useRef(null);
  const alarmTimeoutRef = useRef(null);
  const audioRef = useRef(null);
  const unreadRef = useRef(new Set());
  const selectedConversationRef = useRef(null);
  const conversationsRef = useRef([]);
  const touchStartXRef = useRef(null);
  const touchStartYRef = useRef(null);
  const minSwipeDistance = 60;

  // Sync tất cả refs
  useEffect(() => { unreadRef.current = unreadConversations; }, [unreadConversations]);
  useEffect(() => { selectedConversationRef.current = selectedConversation; }, [selectedConversation]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  // ── Audio ────────────────────────────────────────────────────────────────
  useEffect(() => {
    audioRef.current = new Audio('/sounds/notification.wav');
    audioRef.current.volume = 1.0;
  }, []);

  const playSound = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
  }, []);

  const stopAlarm = useCallback(() => {
    if (alarmIntervalRef.current) { clearInterval(alarmIntervalRef.current); alarmIntervalRef.current = null; }
    if (alarmTimeoutRef.current) { clearTimeout(alarmTimeoutRef.current); alarmTimeoutRef.current = null; }
  }, []);

  const startAlarm = useCallback(() => {
    stopAlarm();
    alarmTimeoutRef.current = setTimeout(() => {
      if (unreadRef.current.size > 0) {
        playSound();
        alarmIntervalRef.current = setInterval(() => {
          if (unreadRef.current.size === 0) stopAlarm();
          else playSound();
        }, 5000);
      }
    }, 5000);
  }, [playSound, stopAlarm]);

  useEffect(() => {
    if (unreadConversations.size > 0) {
      if (!alarmIntervalRef.current && !alarmTimeoutRef.current) startAlarm();
    } else {
      stopAlarm();
    }
  }, [unreadConversations, startAlarm, stopAlarm]);

  // ── Sort ─────────────────────────────────────────────────────────────────
  const sortConvs = (list, unreadSet) => {
    return [...list].sort((a, b) => {
      const aU = unreadSet.has(String(a.id));
      const bU = unreadSet.has(String(b.id));
      if (aU && !bU) return -1;
      if (!aU && bU) return 1;
      return new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0);
    });
  };

  // ── Load data ─────────────────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    try {
      const res = await conversationsAPI.getAll();
      const convs = res.data.data || [];
      setConversations(sortConvs(convs, unreadRef.current));
    } catch (e) {
      console.error('loadConversations error:', e);
    }
  }, []);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const [convRes, labelsRes, qrRes] = await Promise.all([
        conversationsAPI.getAll(),
        labelsAPI.getAll(),
        quickRepliesAPI.getAll()
      ]);
      setConversations(convRes.data.data || []);
      setLabels(labelsRes.data.data || []);
      setQuickReplies(qrRes.data.data || []);
    } catch (e) {
      console.error('loadInitialData error:', e);
      alert('Lỗi kết nối server.');
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Socket — chỉ đăng ký 1 lần duy nhất khi mount ────────────────────────
  useEffect(() => {
    socketService.connect();

    const handleNewMessage = (data) => {
      console.log('🔥 new_message:', data.customerName, data.message);

      const isViewing = selectedConversationRef.current &&
        String(selectedConversationRef.current.id) === String(data.customerId);

      // Cập nhật unread
      if (!isViewing) {
        setUnreadConversations(prev => {
          const next = new Set(prev);
          next.add(String(data.customerId));
          return next;
        });
      }

      // Cập nhật conversations trực tiếp từ ref — không bị stale closure
      const current = conversationsRef.current;
      const exists = current.find(c => String(c.id) === String(data.customerId));
      let updated;

      if (exists) {
        updated = current.map(c => {
          if (String(c.id) !== String(data.customerId)) return c;
          return {
            ...c,
            last_message: data.message || c.last_message,
            last_message_at: data.timestamp || new Date().toISOString(),
            last_sender: data.senderType || 'customer',
            last_message_type: data.messageType || 'message',
          };
        });
      } else {
        // Khách mới
        updated = [{
          id: data.customerId,
          name: data.customerName || 'Khách hàng',
          avatar: data.customerAvatar || null,
          last_message: data.message || '',
          last_message_at: data.timestamp || new Date().toISOString(),
          last_sender: 'customer',
          last_message_type: 'message',
          labels: data.labels || [],
        }, ...current];
      }

      // Sort và cập nhật state
      const newUnread = new Set(unreadRef.current);
      if (!isViewing) newUnread.add(String(data.customerId));
      setConversations(sortConvs(updated, newUnread));

      // Thông báo
      if (!isViewing || document.hidden) {
        notificationService.notify(
          data.customerName || 'Khách hàng',
          data.message || 'Gửi media'
        );
      }

      window.dispatchEvent(new CustomEvent('newMessageReceived', { detail: data }));
    };

    const handleMessageSent = (data) => {
      const current = conversationsRef.current;
      const exists = current.find(c => String(c.id) === String(data.customerId));
      if (!exists) return;

      const updated = current.map(c => {
        if (String(c.id) !== String(data.customerId)) return c;
        return {
          ...c,
          last_message: data.message || c.last_message,
          last_message_at: data.timestamp || new Date().toISOString(),
          last_sender: 'admin',
          last_message_type: data.messageType || 'message',
        };
      });
      setConversations(sortConvs(updated, unreadRef.current));
      window.dispatchEvent(new CustomEvent('newMessageReceived', { detail: data }));
    };

    socketService.on('new_message', handleNewMessage);
    socketService.on('message_sent', handleMessageSent);

    return () => {
      socketService.off('new_message');
      socketService.off('message_sent');
    };
  }, []); // ← [] quan trọng: chỉ đăng ký 1 lần

  // ── Main useEffect ────────────────────────────────────────────────────────
  useEffect(() => {
    loadInitialData();

    const handleLabelsUpdate = () => loadConversations();
    window.addEventListener('labelsUpdated', handleLabelsUpdate);

    const handleSocketReconnect = () => loadConversations();
    window.addEventListener('socketReconnected', handleSocketReconnect);

    pushManager.init().catch(e => console.error('Push init error:', e));

    const swMessageHandler = (event) => {
      const data = event.data || {};
      if (data.type === 'PLAY_SOUND') playSound();
      if (data.type === 'sync-complete') loadConversations();
    };
    navigator.serviceWorker?.addEventListener('message', swMessageHandler);

    return () => {
      stopAlarm();
      window.removeEventListener('labelsUpdated', handleLabelsUpdate);
      window.removeEventListener('socketReconnected', handleSocketReconnect);
      navigator.serviceWorker?.removeEventListener('message', swMessageHandler);
    };
  }, [loadInitialData, loadConversations, playSound, stopAlarm]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSelectConversation = useCallback((conv) => {
    setSelectedConversation(conv);
    setUnreadConversations(prev => {
      const next = new Set(prev);
      next.delete(String(conv.id));
      return next;
    });
    setConversations(prev =>
      sortConvs(prev, (() => {
        const s = new Set(unreadRef.current);
        s.delete(String(conv.id));
        return s;
      })())
    );
    if (window.innerWidth < 768) setSidebarOpen(false);
  }, []);

  const handleSendMessage = async (customerId, message, translate) => {
    try {
      await conversationsAPI.sendMessage(customerId, { message, translate });
      loadConversations();
    } catch (e) {
      console.error('Send error:', e);
      throw e;
    }
  };

  // ── Swipe ─────────────────────────────────────────────────────────────────
  const onChatTouchStart = (e) => {
    touchStartXRef.current = e.targetTouches[0].clientX;
    touchStartYRef.current = e.targetTouches[0].clientY;
  };

  const onChatTouchEnd = (e) => {
    if (touchStartXRef.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartXRef.current;
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartYRef.current);
    if (dx > minSwipeDistance && dy < 80 && !sidebarOpen) setSidebarOpen(true);
    if (dx < -minSwipeDistance && dy < 80 && sidebarOpen) setSidebarOpen(false);
    touchStartXRef.current = null;
    touchStartYRef.current = null;
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="text-6xl mb-4">⏳</div>
          <p className="text-lg text-gray-600">Đang tải dữ liệu...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      <div className="bg-primary text-white p-4 flex items-center justify-between shadow-md z-10">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">💬 Dashboard</h1>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="md:hidden text-white text-2xl">
            {sidebarOpen ? '✕' : '☰'}
          </button>
          {unreadConversations.size > 0 && (
            <span className="md:hidden bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full animate-pulse">
              {unreadConversations.size} chưa đọc
            </span>
          )}
        </div>
        <button onClick={() => setShowQRManager(true)} className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded transition">
          ⚡ Quản lý Trả lời nhanh
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-10 md:hidden" onClick={() => setSidebarOpen(false)} />
        )}
        <div className={`fixed md:relative top-0 left-0 w-4/5 md:w-80 h-full bg-white z-20 transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
          <Sidebar
            conversations={conversations}
            selectedId={selectedConversation?.id}
            onSelect={handleSelectConversation}
            labels={labels}
            unreadConversations={unreadConversations}
          />
        </div>

        <div className="flex-1 h-full relative flex flex-col" onTouchStart={onChatTouchStart} onTouchEnd={onChatTouchEnd}>
          <ChatWindow
            key={`${selectedConversation?.id}_${messageReloadTriggers[selectedConversation?.id]}`}
            conversation={selectedConversation}
            onSendMessage={handleSendMessage}
            quickReplies={quickReplies}
          />
        </div>
      </div>

      {showQRManager && (
        <QuickReplyManager onClose={() => setShowQRManager(false)} onUpdate={() => loadInitialData()} />
      )}
    </div>
  );
};

export default Dashboard;
