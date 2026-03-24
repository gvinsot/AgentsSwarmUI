import React, { createContext, useContext, useState, useEffect } from 'react';
import { getSocket } from '../socket';

const WebSocketContext = createContext({ socket: null, connected: false });

export function WebSocketProvider({ children }) {
  const [connected, setConnected] = useState(false);
  const socket = getSocket();

  useEffect(() => {
    if (!socket) return;

    setConnected(socket.connected);

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket]);

  return (
    <WebSocketContext.Provider value={{ socket, connected }}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  return useContext(WebSocketContext);
}