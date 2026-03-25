// Sidebar.jsx
import React from 'react';

const Sidebar = ({ conversations, selectedId, onSelect, labels, unreadConversations = new Set() }) => {
  const [search, setSearch] = React.useState('');
  const [selectedLabel, setSelectedLabel] = React.useState(null);

  const filteredConversations = conversations.filter(conv => {
    const matchSearch = conv.name?.toLowerCase().includes(search.toLowerCase());
    const matchLabel = !selectedLabel ||
      conv.labels?.some(l => l.name === selectedLabel);
    return matchSearch && matchLabel;
  });

  const handleLabelFilter = (labelName) => {
    setSelectedLabel(selectedLabel === labelName ? null : labelName);
  };

  return (
    <div className="w-full bg-white border-r border-gray-200 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-gray-800">💬 Hội thoại</h1>
          {unreadConversations.size > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
              {unreadConversations.size} chưa đọc
            </span>
          )}
        </div>
        <input
          type="text"
          placeholder="🔍 Tìm kiếm..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-primary text-sm"
        />
      </div>

      {/* Label Filters */}
      {labels?.length > 0 && (
        <div className="p-3 border-b border-gray-200">
          <div className="flex flex-wrap gap-2">
            {labels.map(label => (
              <button
                key={label.id}
                onClick={() => handleLabelFilter(label.name)}
                className={`px-2 py-1 rounded text-xs font-medium transition ${
                  selectedLabel === label.name
                    ? 'text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                style={selectedLabel === label.name
                  ? { backgroundColor: label.color || '#3b82f6' }
                  : {}
                }
              >
                {label.emoji} {label.name}
              </button>
            ))}
            {selectedLabel && (
              <button
                onClick={() => setSelectedLabel(null)}
                className="px-2 py-1 rounded text-xs bg-gray-200 text-gray-600 hover:bg-gray-300"
              >
                ✕ Xóa lọc
              </button>
            )}
          </div>
        </div>
      )}

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto">
        {filteredConversations.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            Không có cuộc hội thoại nào
          </div>
        ) : (
          filteredConversations.map(conv => {
            const isUnread = unreadConversations.has(conv.id);
            const isSelected = selectedId === conv.id;

            return (
              <div
                key={conv.id}
                onClick={() => onSelect(conv)}
                className={`p-3 border-b border-gray-100 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-blue-50 border-l-4 border-l-primary'
                    : isUnread
                      ? 'bg-red-50 hover:bg-red-100'
                      : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className="relative flex-shrink-0">
                    <div className="w-11 h-11 rounded-full overflow-hidden bg-primary text-white flex items-center justify-center font-bold text-base">
                      {conv.avatar ? (
                        <img
                          src={conv.avatar}
                          alt={conv.name}
                          className="w-full h-full object-cover"
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      ) : (
                        <span>{conv.name?.[0]?.toUpperCase() || '?'}</span>
                      )}
                    </div>

                    {/* Unread badge */}
                    {isUnread && (
                      <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center animate-pulse">
                        <span className="text-white text-xs">●</span>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <h3 className={`truncate text-sm ${
                        isUnread ? 'font-bold text-gray-900' : 'font-semibold text-gray-800'
                      }`}>
                        {conv.name || 'Unknown'}
                      </h3>
                      <div className="flex items-center gap-1 flex-shrink-0 ml-1">
                        {isUnread && (
                          <span className="text-red-500 text-xs font-bold">NEW</span>
                        )}
                        <span className="text-xs text-gray-400">
                          {conv.last_message_at
                            ? new Date(conv.last_message_at).toLocaleTimeString('vi-VN', {
                                hour: '2-digit',
                                minute: '2-digit'
                              })
                            : ''}
                        </span>
                      </div>
                    </div>

                    {/* Labels */}
                    {conv.labels?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-0.5">
                        {conv.labels.map((label, idx) => (
                          <span
                            key={idx}
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: label.color || '#999', color: '#fff' }}
                          >
                            {label.emoji} {label.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Last message */}
                    <p className={`text-xs truncate ${
                      isUnread ? 'font-semibold text-gray-800' : 'text-gray-500'
                    }`}>
                      {conv.last_sender === 'admin' ? '🤖 ' : ''}
                      {conv.last_message_type === 'comment' ? '💬 ' : ''}
                      {conv.last_message || 'Chưa có tin nhắn'}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Stats */}
      <div className="p-3 border-t border-gray-200 bg-gray-50">
        <div className="text-xs text-gray-500 flex items-center justify-between">
          <span>📊 {filteredConversations.length} hội thoại</span>
          {unreadConversations.size > 0 && (
            <span className="text-red-500 font-semibold">
              🔔 {unreadConversations.size} chưa đọc
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
