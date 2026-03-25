import React, { useState, useEffect } from 'react';
import api from '../services/api';

const QuickReplyManager = ({ onClose, onUpdate }) => {
  const [quickReplies, setQuickReplies] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [formData, setFormData] = useState({
    key: '',
    emoji: '💬',
    text_vi: '',
    text_en: ''
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadQuickReplies();
  }, []);

  const loadQuickReplies = async () => {
    try {
      const response = await api.get('/quickreplies');
      setQuickReplies(response.data.data || []);
    } catch (error) {
      console.error('Error loading quick replies:', error);
    }
  };

  const handleEdit = (qr) => {
    setEditing(qr.id);
    setFormData({
      key: qr.key,
      emoji: qr.emoji,
      text_vi: qr.text_vi,
      text_en: qr.text_en
    });
    setShowAdd(false);
  };

  const handleCancelEdit = () => {
    setEditing(null);
    setFormData({
      key: '',
      emoji: '💬',
      text_vi: '',
      text_en: ''
    });
  };

  const handleSave = async () => {
    if (!formData.key || !formData.text_vi || !formData.text_en) {
      alert('Vui lòng điền đầy đủ thông tin');
      return;
    }

    setLoading(true);
    try {
      if (editing) {
        // Update
        await api.put(`/quickreplies/${editing}`, formData);
      } else {
        // Create
        await api.post('/quickreplies', formData);
      }

      await loadQuickReplies();
      handleCancelEdit();
      setShowAdd(false);
      
      if (onUpdate) onUpdate();
    } catch (error) {
      console.error('Error saving quick reply:', error);
      alert(error.response?.data?.error || 'Lỗi lưu quick reply');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Bạn có chắc muốn xóa quick reply này?')) {
      return;
    }

    setLoading(true);
    try {
      await api.delete(`/quickreplies/${id}`);
      await loadQuickReplies();
      
      if (onUpdate) onUpdate();
    } catch (error) {
      console.error('Error deleting quick reply:', error);
      alert('Lỗi xóa quick reply');
    } finally {
      setLoading(false);
    }
  };

  const handleAddNew = () => {
    setShowAdd(true);
    setEditing(null);
    setFormData({
      key: '',
      emoji: '💬',
      text_vi: '',
      text_en: ''
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-800">⚡ Quản lý Trả lời nhanh</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Add/Edit Form */}
          {(showAdd || editing) && (
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="font-semibold text-gray-800 mb-3">
                {editing ? '✏️ Chỉnh sửa' : '➕ Thêm mới'}
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-gray-700">Key (ID):</label>
                  <input
                    type="text"
                    value={formData.key}
                    onChange={(e) => setFormData({...formData, key: e.target.value})}
                    placeholder="chao, camOn..."
                    className="w-full px-3 py-2 border border-gray-300 rounded mt-1"
                    disabled={editing} // Không cho sửa key khi edit
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700">Emoji:</label>
                  <input
                    type="text"
                    value={formData.emoji}
                    onChange={(e) => setFormData({...formData, emoji: e.target.value})}
                    placeholder="👋"
                    className="w-full px-3 py-2 border border-gray-300 rounded mt-1"
                    maxLength="2"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700">Tiếng Việt:</label>
                  <textarea
                    value={formData.text_vi}
                    onChange={(e) => setFormData({...formData, text_vi: e.target.value})}
                    placeholder="Xin chào..."
                    className="w-full px-3 py-2 border border-gray-300 rounded mt-1"
                    rows="3"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-700">Tiếng Anh:</label>
                  <textarea
                    value={formData.text_en}
                    onChange={(e) => setFormData({...formData, text_en: e.target.value})}
                    placeholder="Hello..."
                    className="w-full px-3 py-2 border border-gray-300 rounded mt-1"
                    rows="3"
                  />
                </div>
              </div>

              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleSave}
                  disabled={loading}
                  className="px-4 py-2 bg-primary text-white rounded hover:bg-blue-600 disabled:opacity-50"
                >
                  {loading ? '⏳ Đang lưu...' : '✓ Lưu'}
                </button>
                <button
                  onClick={handleCancelEdit}
                  disabled={loading}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                >
                  Hủy
                </button>
              </div>
            </div>
          )}

          {/* Add Button */}
          {!showAdd && !editing && (
            <button
              onClick={handleAddNew}
              className="w-full mb-4 px-4 py-3 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg font-medium transition"
            >
              ➕ Thêm Quick Reply mới
            </button>
          )}

          {/* List */}
          <div className="space-y-3">
            {quickReplies.map(qr => (
              <div
                key={qr.id}
                className={`p-4 border rounded-lg ${
                  editing === qr.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{qr.emoji}</span>
                    <span className="font-semibold text-gray-800">{qr.key}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(qr)}
                      disabled={loading}
                      className="px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-sm transition disabled:opacity-50"
                    >
                      ✏️ Sửa
                    </button>
                    <button
                      onClick={() => handleDelete(qr.id)}
                      disabled={loading}
                      className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded text-sm transition disabled:opacity-50"
                    >
                      🗑️ Xóa
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="font-medium text-gray-600">🇻🇳 VI:</span>
                    <p className="text-gray-800 mt-1">{qr.text_vi}</p>
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">🇬🇧 EN:</span>
                    <p className="text-gray-800 mt-1">{qr.text_en}</p>
                  </div>
                </div>
              </div>
            ))}

            {quickReplies.length === 0 && (
              <p className="text-center text-gray-500 py-8">
                Chưa có quick reply nào
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <p className="text-sm text-gray-600">
            💡 Tổng cộng: <strong>{quickReplies.length}</strong> quick replies
          </p>
        </div>
      </div>
    </div>
  );
};

export default QuickReplyManager;
