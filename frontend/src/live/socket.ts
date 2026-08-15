import { io, Socket } from 'socket.io-client';

/**
 * One socket for the whole app. React StrictMode mounts effects twice in dev,
 * so a per-component socket would double every session and burn a slot from
 * LIVE_MAX_SESSIONS immediately.
 *
 * transports: ['websocket'] skips the long-polling handshake. Note that this
 * only works because vite.config.ts proxies '/socket.io' with `ws: true`;
 * without it the upgrade 404s and Socket.IO silently degrades to polling,
 * which "works" at roughly 3 fps.
 */
let socket: Socket | null = null;

export function getLiveSocket(): Socket {
  if (socket) return socket;
  socket = io('/live', {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 500,
  });
  return socket;
}

export const SESSION_STORAGE_KEY = 'vr_live_session_id';
