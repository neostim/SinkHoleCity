// Thin PeerJS wrapper. One player hosts a room (a peer whose id is derived from a short code);
// the other connects to it. PeerJS's free public broker only brokers the handshake - game data
// then flows directly between the two browsers (WebRTC data channel), so no game server is needed.
import { Peer } from 'peerjs';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const PREFIX = 'sinkholecity-';
const makeCode = () => Array.from({ length: 5 }, () => ALPHA[(Math.random() * ALPHA.length) | 0]).join('');

export function normalizeCode(s) {
  return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

export function hostRoom({ onOpen, onGuest, onData, onGuestLeft, onError }) {
  let peer = null, conn = null, code = '', closed = false;

  const open = (attempt) => {
    code = makeCode();
    peer = new Peer(PREFIX + code);
    peer.on('open', () => onOpen(code));
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id' && attempt < 6) { try { peer.destroy(); } catch (x) {} open(attempt + 1); }
      else if (!closed) onError(e);
    });
    peer.on('connection', (c) => {
      if (conn && conn.open) { // room is full (2 humans)
        c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); });
        return;
      }
      conn = c;
      c.on('open', () => onGuest());
      c.on('data', (d) => onData(d));
      c.on('close', () => { if (conn === c) { conn = null; onGuestLeft(); } });
      c.on('error', () => {});
    });
  };
  open(0);

  return {
    get code() { return code; },
    get connected() { return !!(conn && conn.open); },
    send(m) { if (conn && conn.open) conn.send(m); },
    close() { closed = true; try { peer && peer.destroy(); } catch (e) {} },
  };
}

export function joinRoom(rawCode, { onOpen, onData, onClose, onError }) {
  const code = normalizeCode(rawCode);
  let peer = null, conn = null, opened = false, closed = false;
  const fail = (e) => { if (!closed && !opened) { closed = true; try { peer.destroy(); } catch (x) {} onError(e); } };

  peer = new Peer();
  peer.on('error', (e) => { if (opened) { if (!closed) { closed = true; onClose(); } } else fail(e); });
  peer.on('open', () => {
    conn = peer.connect(PREFIX + code, { reliable: true });
    conn.on('open', () => { opened = true; clearTimeout(timer); onOpen(); });
    conn.on('data', (d) => onData(d));
    conn.on('close', () => { if (!closed) { closed = true; onClose(); } });
    conn.on('error', () => {});
  });
  const timer = setTimeout(() => fail({ type: 'timeout' }), 15000);

  return {
    send(m) { if (conn && conn.open) conn.send(m); },
    close() { closed = true; clearTimeout(timer); try { peer.destroy(); } catch (e) {} },
  };
}
