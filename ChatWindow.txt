import React, { useEffect, useRef, useState, useCallback } from 'react';
import { conversationsAPI } from '../services/api';
import LabelManager from './LabelManager';
import offlineQueue from '../utils/offlineQueue';
import socketService from '../services/socket';

// ============= HELPER: Detect tiếng Việt =============
const isVietnamese = (text) => {
  return /[ăâđêôơưĂÂĐÊÔƠƯáàảãạéèẻẽẹíìỉĩịóòỏõọúùủũụýỳỷỹỵ]/.test(text);
};

// ============= COMPONENT: Auto dịch sang VI =============
const AutoTranslateVI = ({ content, senderType }) => {
  const [translated, setTranslated] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!content || done) return;
    // Bỏ qua nếu đã là tiếng Việt
    if (isVietnamese(content)) { setDone(true); return; }

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${process.env.REACT_APP_API_URL}/api/translate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: content, to: 'vi' })
        });
        const data = await response.json();
        if (data.success && data.data.translated !== content) {
          setTranslated(data.data.translated);
        }
      } catch (e) {}
      finally { setDone(true); }
    }, 300);

    return () => clearTimeout(timer);
  }, [content, done]);

  if (!translated) return null;

  return (
    <p className={`text-xs mt-1 opacity-75 pt-1 ${
      senderType === 'admin'
        ? 'border-t border-blue-300'
        : 'border-t border-gray-200'
    }`}>
      🇻🇳 {translated}
    </p>
  );
};

// ============= COMPONENT: Confirm gửi tiếng Việt =============
const VietnameseConfirmModal = ({ text, onSendOriginal, onTranslateFirst, onCancel }) => (
  <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
    <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5">
      <div className="text-center mb-4">
        <div className="text-3xl mb-2">⚠️</div>
        <h3 className="font-semibold text-gray-800 text-lg">Tin nhắn tiếng Việt</h3>
        <p className="text-sm text-gray-500 mt-1">Khách có thể không hiểu tiếng Việt</p>
      </div>
      <div className="bg-gray-50 rounded-lg p-3 mb-4">
        <p className="text-sm text-gray-700 break-words">{text}</p>
      </div>
      <div className="flex flex-col gap-2">
        <button
          onClick={onTranslateFirst}
          className="w-full py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition"
        >
          🌐 Dịch sang EN rồi gửi
        </button>
        <button
          onClick={onSendOriginal}
          className="w-full py-2 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300 transition"
        >
          📤 Gửi tiếng Việt luôn
        </button>
        <button
          onClick={onCancel}
          className="w-full py-2 text-gray-400 text-sm hover:text-gray-600 transition"
        >
          ✕ Hủy
        </button>
      </div>
    </div>
  </div>
);

// ============= MAIN COMPONENT =============
const ChatWindow = ({ conversation, onSendMessage, quickReplies }) => {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [translatedPreview, setTranslatedPreview] = useState('');
  const [translating, setTranslating] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePreview, setFilePreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [showLabelManager, setShowLabelManager] = useState(false);
  const [showTranslatePreview, setShowTranslatePreview] = useState(false);
  const [viewingImage, setViewingImage] = useState(null);
  const [showViConfirm, setShowViConfirm] = useState(false);
  const [pendingText, setPendingText] = useState('');

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const loadingRef = useRef(false);
  const isFirstLoad = useRef(true);
  const conversationIdRef = useRef(null);

  // ============= SCROLL =============
  const scrollToBottom = useCallback((behavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  // ============= LOAD MESSAGES =============
  const loadMessages = useCallback(async (scrollInstant = false) => {
    if (!conversation?.id || loadingRef.current) return;

    loadingRef.current = true;
    setLoading(true);
    try {
      const response = await conversationsAPI.getMessages(conversation.id);
      const newMessages = response.data.data || [];
      setMessages(newMessages);

      // Scroll xuống cuối ngay sau khi load — không animation
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: scrollInstant ? 'auto' : 'smooth' });
      }, 50);
    } catch (error) {
      console.error('Error loading messages:', error);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [conversation?.id]);

  // ============= APPEND TIN MỚI (không reload) =============
  const appendNewMessage = useCallback((newMessage) => {
    setMessages(prev => {
      // Tránh duplicate — chỉ so sánh id thật (không phải temp)
      const isDuplicate = prev.some(m =>
        m.id && newMessage.id &&
        !String(newMessage.id).startsWith('temp-') &&
        !String(newMessage.id).startsWith('offline-') &&
        String(m.id) === String(newMessage.id)
      );
      if (isDuplicate) return prev;
      return [...prev, newMessage];
    });

    // Scroll mượt đến tin mới — không reset position
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
  }, []);

  // ============= LOAD KHI ĐỔI CONVERSATION =============
  useEffect(() => {
    if (!conversation?.id) return;

    // Reset khi đổi conversation
    if (conversationIdRef.current !== conversation.id) {
      conversationIdRef.current = conversation.id;
      setMessages([]);
      isFirstLoad.current = true;
    }

    loadMessages(true); // scroll instant lần đầu
  }, [conversation?.id, loadMessages]);

  // ============= SOCKET LISTENER =============
  useEffect(() => {
    if (!conversation?.id) return;

    const handleNewMessage = (data) => {
      if (!data) return;

      // Fix: so sánh string vs number
      if (String(data.customerId) !== String(conversation.id)) return;

      if (data.message || data.content) {
        appendNewMessage({
          id: data.messageId || `socket-${Date.now()}`,
          content: data.message || data.content,
          sender_type: data.senderType || 'customer',
          created_at: data.timestamp || new Date().toISOString(),
          translated_text: data.translatedText || null,
          media_type: data.mediaType || null,
          media_url: data.mediaUrl || null,
          message_type: data.messageType || 'message'
        });
      } else {
        loadMessages();
      }
    };

    // Fix: truyền handler vào off() — tránh xóa listener của component khác
    socketService.on('new_message', handleNewMessage);

    // message_sent chỉ dùng để reload conversation list, không append tin
    socketService.on('message_sent', (data) => {
      // Bỏ qua nếu là tin admin tự gửi (đã append thủ công rồi)
      if (data && String(data.customerId) === String(conversation?.id)) {
        return;
      }
    });


    return () => {
      socketService.off('new_message', handleNewMessage);
      socketService.off('message_sent', handleNewMessage);
    };
  }, [conversation?.id, appendNewMessage, loadMessages]);

  // ============= VISIBILITY CHANGE =============
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && conversation?.id) {
        if (!socketService.connected) socketService.forceReconnect();
        setTimeout(() => loadMessages(), 500);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [conversation?.id, loadMessages]);

  // ============= SEND MESSAGE =============
  const doSend = async (text) => {
    const thoiGianGui = new Date().toISOString();
    setSending(true);
    try {
      if (!navigator.onLine) {
        await offlineQueue.savePendingMessage(conversation.id, text, false);
        appendNewMessage({
          id: `offline-${Date.now()}`,
          content: text,
          sender_type: 'admin',
          created_at: thoiGianGui,
          offline: true
        });
        alert('📴 Offline - Tin nhắn sẽ được gửi khi có mạng');
        setInputText('');
        return;
      }

      await onSendMessage(conversation.id, text, false);
      setInputText('');
      setTranslatedPreview('');

      appendNewMessage({
        id: `temp-${Date.now()}`,
        content: text,
        sender_type: 'admin',
        created_at: thoiGianGui,
        media_type: null,
        media_url: null
      });
    } catch (error) {
      console.error('Error sending:', error);
      if (error.message?.includes('Network') || error.message?.includes('fetch')) {
        await offlineQueue.savePendingMessage(conversation.id, text, false);
        alert('📴 Lỗi mạng - Tin nhắn đã được lưu để gửi sau');
      } else {
        alert('Lỗi gửi tin nhắn: ' + error.message);
      }
    } finally {
      setSending(false);
    }
  };

  const handleSend = async () => {
    if (selectedFile) { handleSendWithFile(); return; }
    if (!inputText.trim() || sending) return;

    const text = inputText.trim();

    // Vấn đề 4: Cảnh báo nếu là tiếng Việt
    if (isVietnamese(text)) {
      setPendingText(text);
      setShowViConfirm(true);
      return;
    }

    await doSend(text);
  };

  const handleConfirmSendOriginal = async () => {
    setShowViConfirm(false);
    await doSend(pendingText);
    setPendingText('');
  };

  const handleConfirmTranslateFirst = async () => {
    setShowViConfirm(false);
    setSending(true);
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pendingText, to: 'en' })
      });
      const data = await response.json();
      const finalText = data.success ? data.data.translated : pendingText;
      setSending(false);
      await doSend(finalText);
    } catch (e) {
      setSending(false);
      await doSend(pendingText);
    }
    setPendingText('');
  };

  const handleConfirmCancel = () => {
    setShowViConfirm(false);
    setPendingText('');
    setSending(false);
  };

  // ============= TRANSLATE PREVIEW =============
  const handleTranslate = async () => {
    if (!inputText.trim() || translating) return;
    setTranslating(true);
    try {
      const response = await fetch(`${process.env.REACT_APP_API_URL}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inputText, to: 'en' })
      });
      const data = await response.json();
      if (data.success) {
        setTranslatedPreview(data.data.translated);
        setShowTranslatePreview(true);
      } else {
        alert('Lỗi dịch: ' + data.error);
      }
    } catch (error) {
      alert('Lỗi kết nối dịch thuật');
    } finally {
      setTranslating(false);
    }
  };

  const handleApplyTranslation = () => {
    if (translatedPreview) {
      setInputText(translatedPreview);
      setTranslatedPreview('');
      setShowTranslatePreview(false);
    }
  };

  const handleCancelTranslation = () => {
    setTranslatedPreview('');
    setShowTranslatePreview(false);
  };

  // ============= FILE =============
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { alert('File quá lớn! Tối đa 25MB'); return; }
    setSelectedFile(file);
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => setFilePreview(reader.result);
      reader.readAsDataURL(file);
    } else if (file.type.startsWith('video/')) {
      setFilePreview(URL.createObjectURL(file));
    } else {
      setFilePreview(null);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setFilePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSendWithFile = async () => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('message', inputText);
      const response = await fetch(
        `${process.env.REACT_APP_API_URL}/api/conversations/${conversation.id}/send-media`,
        { method: 'POST', body: formData }
      );
      const data = await response.json();
      if (data.success) {
        setInputText('');
        handleRemoveFile();
        setTimeout(() => loadMessages(), 500);
      } else {
        alert('Lỗi gửi file: ' + data.error);
      }
    } catch (error) {
      alert('Lỗi upload file');
    } finally {
      setUploading(false);
    }
  };

  const handleQuickReply = (qr) => {
    setInputText(qr.text_vi);
    setShowQuickReplies(false);
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ============= RENDER =============
  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center text-gray-500">
          <div className="text-6xl mb-4">💬</div>
          <p className="text-lg">Chọn một cuộc hội thoại để bắt đầu</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white h-full">

      {/* Modal xác nhận tiếng Việt */}
      {showViConfirm && (
        <VietnameseConfirmModal
          text={pendingText}
          onSendOriginal={handleConfirmSendOriginal}
          onTranslateFirst={handleConfirmTranslateFirst}
          onCancel={handleConfirmCancel}
        />
      )}

      {/* Image Viewer */}
      {viewingImage && (
        <ImageViewer
          imageUrl={viewingImage}
          onClose={() => setViewingImage(null)}
        />
      )}

      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {conversation.avatar ? (
              <img
                src={conversation.avatar}
                alt={conversation.name}
                className="w-10 h-10 rounded-full object-cover"
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center font-bold">
                {conversation.name?.[0]?.toUpperCase() || '?'}
              </div>
            )}
            <div>
              <h2 className="font-semibold text-gray-800">{conversation.name || 'Unknown'}</h2>
              <p className="text-xs text-gray-500">#{conversation.fb_id?.slice(-6)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {conversation.labels?.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {conversation.labels.map((label, idx) => (
                  <span
                    key={idx}
                    className="text-xs px-2 py-1 rounded"
                    style={{ backgroundColor: label.color || '#999', color: '#fff' }}
                  >
                    {label.emoji} {label.name}
                  </span>
                ))}
              </div>
            )}
            <button
              onClick={() => setShowLabelManager(!showLabelManager)}
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-sm transition"
            >
              {showLabelManager ? '✕ Đóng' : '🏷️ Nhãn'}
            </button>
          </div>
        </div>
      </div>

      {showLabelManager && (
        <LabelManager
          conversation={conversation}
          onLabelsChange={() => {
            window.dispatchEvent(new CustomEvent('labelsUpdated', {
              detail: { conversationId: conversation.id }
            }));
          }}
        />
      )}

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto p-4 bg-gray-50 min-h-0"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {loading ? (
          <div className="text-center text-gray-500 py-8">Đang tải tin nhắn...</div>
        ) : messages.length === 0 ? (
          <div className="text-center text-gray-500 py-8">Chưa có tin nhắn nào</div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              // Fix vấn đề 2: key dùng id thật, không dùng index
              <div
                key={msg.id || `${msg.created_at}-${msg.sender_type}`}
                className={`flex ${msg.sender_type === 'admin' ? 'justify-end' : 'justify-start'}`}
              >
                {/* Tag COMMENT */}
                {msg.message_type === 'comment' && (
                  <div className="self-center mr-1">
                    <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full border border-yellow-300">
                      💬 Bình luận
                    </span>
                  </div>
                )}

                <div
                  className={`max-w-xs md:max-w-md lg:max-w-lg px-4 py-2 rounded-lg ${
                    msg.sender_type === 'admin'
                      ? 'bg-primary text-white'
                      : 'bg-white border border-gray-200 text-gray-800'
                  }`}
                >
                  {/* Media */}
                  {msg.media_type && msg.media_url && (
                    <div className="mb-2">
                      {msg.media_type === 'image' && (
                        <img
                          src={msg.media_url}
                          alt="Attachment"
                          className="max-w-full rounded cursor-pointer hover:opacity-90 transition"
                          style={{ maxHeight: '300px' }}
                          onClick={(e) => { e.stopPropagation(); setViewingImage(msg.media_url); }}
                        />
                      )}
                      {msg.media_type === 'video' && (
                        <video src={msg.media_url} controls className="max-w-full rounded" style={{ maxHeight: '300px' }} />
                      )}
                      {msg.media_type === 'audio' && (
                        <audio src={msg.media_url} controls className="w-full" />
                      )}
                      {msg.media_type === 'file' && (
                        <div className="flex items-center gap-2 p-2 bg-gray-100 rounded">
                          <span className="text-2xl">📎</span>
                          <span className="text-sm">{msg.content || 'File đính kèm'}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Content */}
                  {msg.content && !msg.media_type && (
                    <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  )}

                  {/* Vấn đề 5: Dịch VI cho TẤT CẢ tin (cả admin lẫn customer) */}
                  {msg.content && !msg.media_type && (
                    <>
                      {/* Tin khách: hiện translated_text từ DB trước */}
                      {msg.sender_type === 'customer' && msg.translated_text && (
                        <p className="text-xs mt-1 opacity-75 border-t border-gray-200 pt-1">
                          🇻🇳 {msg.translated_text}
                        </p>
                      )}
                      {/* Tin khách không có translated_text: auto dịch */}
                      {msg.sender_type === 'customer' && !msg.translated_text && (
                        <AutoTranslateVI content={msg.content} senderType="customer" />
                      )}
                      {/* Tin admin: auto dịch sang VI để admin đọc lại */}
                      {msg.sender_type === 'admin' && (
                        <AutoTranslateVI content={msg.content} senderType="admin" />
                      )}
                    </>
                  )}

                  {/* Timestamp */}
                  <p className="text-xs mt-1 opacity-75">
                    {new Date(msg.created_at).toLocaleTimeString('vi-VN', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                    {msg.offline && ' · 📴 Chờ gửi'}
                  </p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Quick Replies */}
      {showQuickReplies && quickReplies?.length > 0 && (
        <div className="border-t border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-700">⚡ Trả lời nhanh:</span>
            <button onClick={() => setShowQuickReplies(false)} className="text-gray-500 hover:text-gray-700">✕</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {quickReplies.map(qr => (
              <button
                key={qr.id}
                onClick={() => handleQuickReply(qr)}
                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm text-left transition"
              >
                {qr.emoji} {qr.key}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-4 border-t border-gray-200 bg-white">
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setShowQuickReplies(!showQuickReplies)}
            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-sm transition"
          >
            ⚡ Trả lời nhanh
          </button>
          <button
            onClick={handleTranslate}
            disabled={!inputText.trim() || translating}
            className="px-3 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-sm transition disabled:opacity-50"
          >
            {translating ? '⏳ Đang dịch...' : '🌐 Dịch sang EN'}
          </button>
        </div>

        {/* Translate Preview */}
        {showTranslatePreview && translatedPreview && (
          <div className="mb-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <span className="text-xs font-semibold text-blue-700">🇬🇧 Bản dịch:</span>
            <p className="text-sm text-gray-800 font-medium my-2">{translatedPreview}</p>
            <div className="flex gap-2">
              <button
                onClick={handleApplyTranslation}
                className="px-3 py-1 bg-green-500 text-white rounded text-sm hover:bg-green-600"
              >
                ✓ OK (Dùng bản dịch)
              </button>
              <button
                onClick={handleCancelTranslation}
                className="px-3 py-1 bg-gray-300 text-gray-700 rounded text-sm hover:bg-gray-400"
              >
                ✕ Xóa
              </button>
            </div>
          </div>
        )}

        {/* File Preview */}
        {selectedFile && (
          <div className="mb-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="flex items-start justify-between mb-2">
              <span className="text-xs font-semibold text-gray-700">📎 File đính kèm:</span>
              <button onClick={handleRemoveFile} className="text-red-500 hover:text-red-700 text-sm">✕</button>
            </div>
            {filePreview && selectedFile.type.startsWith('image/') && (
              <img src={filePreview} alt="Preview" className="max-w-full rounded mb-2" style={{ maxHeight: '200px' }} />
            )}
            {filePreview && selectedFile.type.startsWith('video/') && (
              <video src={filePreview} controls className="max-w-full rounded mb-2" style={{ maxHeight: '200px' }} />
            )}
            <p className="text-sm text-gray-600">
              {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleFileSelect}
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
            style={{ display: 'none' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={sending || uploading}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition disabled:opacity-50"
            title="Đính kèm file"
          >
            📎
          </button>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Nhập tin nhắn... (Enter để gửi)"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-primary resize-none"
            rows="2"
            disabled={sending || uploading}
          />
          <button
            onClick={handleSend}
            disabled={(!inputText.trim() && !selectedFile) || sending || uploading}
            className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition font-medium"
          >
            {uploading || sending ? '⏳' : '📤'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ============= IMAGE VIEWER =============
const ImageViewer = ({ imageUrl, onClose }) => {
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const imageRef = useRef(null);

  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(prev => Math.min(Math.max(0.5, prev + delta), 3));
  };

  useEffect(() => {
    let lastDistance = 0;
    const handleTouchMove = (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const distance = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
        if (lastDistance > 0) {
          const delta = (distance - lastDistance) * 0.01;
          setZoom(prev => Math.min(Math.max(0.5, prev + delta), 3));
        }
        lastDistance = distance;
      }
    };
    const handleTouchEnd = () => { lastDistance = 0; };
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    return () => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);

  const handleDownload = async () => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `image_${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert('Lỗi tải ảnh');
    }
  };

  const handleMouseDown = (e) => {
    if (zoom > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  const handleMouseMove = (e) => {
    if (isDragging) setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setIsDragging(false);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute top-4 right-4 flex gap-2 z-10">
        <button onClick={(e) => { e.stopPropagation(); handleDownload(); }} className="px-4 py-2 bg-white text-gray-800 rounded-lg hover:bg-gray-100 transition">
          📥 Tải về
        </button>
        <button onClick={onClose} className="px-4 py-2 bg-white text-gray-800 rounded-lg hover:bg-gray-100 transition">
          ✕ Đóng
        </button>
      </div>
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-white rounded-lg px-4 py-2 text-sm">
        Zoom: {(zoom * 100).toFixed(0)}% | Cuộn chuột hoặc pinch để zoom
      </div>
      <div
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="relative max-w-[90vw] max-h-[90vh] overflow-hidden cursor-move"
      >
        <img
          ref={imageRef}
          src={imageUrl}
          alt="Full view"
          style={{
            transform: `scale(${zoom}) translate(${position.x / zoom}px, ${position.y / zoom}px)`,
            transition: isDragging ? 'none' : 'transform 0.1s',
            maxWidth: '90vw',
            maxHeight: '90vh',
            objectFit: 'contain'
          }}
          draggable={false}
        />
      </div>
    </div>
  );
};

export default ChatWindow;
