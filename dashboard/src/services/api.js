import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    'Content-Type': 'application/json'
  }
});

export const conversationsAPI = {
  getAll: (params) => api.get('/conversations', { params }),
  getMessages: (customerId, limit = 50) => 
    api.get(`/conversations/${customerId}/messages`, { params: { limit } }),
  sendMessage: (customerId, data) => 
    api.post(`/conversations/${customerId}/send`, data)
};

export const labelsAPI = {
  getAll: () => api.get('/labels'),
  addToCustomer: (customerId, labelId) => 
    api.post(`/customers/${customerId}/labels`, { labelId })
};

export const quickRepliesAPI = {
  getAll: () => api.get('/quickreplies')
};

export const healthAPI = {
  check: () => api.get('/health')
};

export default api;
