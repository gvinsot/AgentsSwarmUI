import { io } from 'socket.io-client';

let socket = null;

export function connectSocket(token) {
  if (socket?.connected) return socket;

  // In production (behind reverse proxy), connect to same origin
  // In dev, Vite proxies /socket.io to the backend
  socket = io({
    auth: { token },
    transports: ['websocket', 'polling']
  });

  socket.on('connect', () => {
    console.log('🔌 WebSocket connected');
  });

  socket.on('connect_error', (err) => {
    console.error('WebSocket error:', err.message);
  });

  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
