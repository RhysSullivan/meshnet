# meshnet

POC coding harness: **infinite VM-backed dev servers, every one served at `localhost:3000`.**

Each chat owns an ephemeral [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) microVM running a dev server on port 3000. The Electron shell renders one `<webview>` per chat, each in its own session **partition**, and the main process intercepts that partition's `http://localhost:3000` traffic and forwards it to the chat's sandbox. So every view is genuinely `localhost:3000` — simultaneously, with no subdomains, ports, or shared cookies. (This is the [portless](https://github.com/vercel-labs/portless) multiplex idea, reimagined first-party at the desktop network layer.)

A real HTTP server also listens on `:3000` for browsers **outside** the app: a cookie-multiplexed project picker.

## Run

```bash
bun install
vercel link && vercel env pull .env.local   # provides VERCEL_OIDC_TOKEN
bun start
```

The OIDC token expires (~12h); re-run `vercel env pull .env.local` when sandbox creation starts failing.

## Layout

| File | Role |
| --- | --- |
| `main.js` | Electron main: per-partition `localhost:3000` proxy + outside `:3000` picker server |
| `preload.js` | IPC bridge (`window.meshnet.list/create`) |
| `index.html` + `renderer.js` | Harness UI: chat sidebar, browser chrome, one webview per chat |
| `sandboxes.js` | Vercel Sandbox lifecycle (one microVM per chat) |
