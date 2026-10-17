# Sinkhole City

A hole.io-style 3D game. Steer a hole around a city, swallow everything that fits, and grow. Don't get swallowed by a bigger hole.

Plays in any modern browser, including iPad Safari (touch & drag to steer).

## Multiplayer (2 players + bots)

Peer-to-peer over WebRTC via [PeerJS](https://peerjs.com), so it works on static hosting like GitHub Pages.

1. Player 1 taps **Host a room** and shares the invite link (**Copy invite link** in the HUD) or the 5-letter code.
2. Player 2 opens the link (or types the code under **Join**) and taps **Join**. They can join mid-round.

The host's browser runs the whole simulation (bots, pedestrians, traffic) and streams state to the guest, so the host needs to keep the tab open. If the host leaves, the room ends. Only the free PeerJS broker is used to introduce the two browsers; gameplay data flows directly between them.

## Play locally

Open `index.html` directly, or run `node serve.js` and visit http://localhost:8123.

## Develop

```bash
npm install
npm run build   # bundles src/ + three.js into game.js
```

`game.js` is the built bundle and **is committed**, so GitHub Pages can serve the repo as-is. Re-run `npm run build` after editing anything in `src/`.

## Publish on GitHub Pages

1. Create a new empty repository on GitHub.
2. From this folder:
   ```bash
   git init
   git add .
   git commit -m "Sinkhole City"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
3. On GitHub: **Settings -> Pages -> Build and deployment -> Deploy from a branch -> `main` / `(root)` -> Save**.
4. After a minute the game is live at `https://<you>.github.io/<repo>/`. Open that URL on the iPad.

Tip for iPad: Share -> **Add to Home Screen** launches it full-screen with no browser bars.
