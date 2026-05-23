const { app, BrowserWindow, ipcMain, session, net } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");

// Electron's Node doesn't auto-load .env — pull the Vercel OIDC token in by hand.
try {
  for (const line of fs.readFileSync(path.join(__dirname, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
} catch {}

const { createChat, listChats, getChat } = require("./sandboxes.js");

// Each chat's webview runs in its own session partition. We intercept that
// partition's http://localhost:3000 traffic and forward it to that chat's VM —
// so every view is genuinely localhost:3000, all at once, no shared cookie jar.
const routed = new Set();

function ensureRoute(chat) {
  if (!chat || chat.status !== "ready" || !chat.domain || routed.has(chat.id)) return;
  routed.add(chat.id);
  const ses = session.fromPartition("persist:" + chat.id);
  ses.protocol.handle("http", (request) => proxy(chat, request));
}

async function proxy(chat, request) {
  const url = new URL(request.url);
  if (url.host !== "localhost:3000") {
    return net.fetch(request, { bypassCustomProtocolHandlers: true });
  }
  const target = chat.domain + url.pathname + url.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  const init = { method: request.method, headers, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = await request.arrayBuffer();

  const resp = await fetch(target, init);
  const out = new Headers(resp.headers);
  out.delete("content-encoding");
  out.delete("content-length");
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: out });
}

const serialize = (c) => ({ id: c.id, title: c.title, status: c.status, error: c.error });

// A real socket on :3000 for browsers OUTSIDE the desktop app. The desktop
// webviews never reach this — their localhost:3000 traffic is intercepted
// per-partition above. Outside, it's a cookie-multiplexed picker.
const CONTROL = "/__meshnet__";
function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
function pickerHtml() {
  const rows = listChats().length === 0
    ? `<p style="opacity:.5">No projects yet — create one in the desktop app.</p>`
    : listChats().map((c) => {
        const ready = c.status === "ready";
        return `<a class="row ${ready ? "" : "off"}" ${ready ? `href="${CONTROL}/select/${c.id}"` : ""}>
          <span>${c.title}</span><span class="st ${c.status}">${c.status}</span></a>`;
      }).join("");
  return `<!doctype html><meta charset="utf8"><meta http-equiv="refresh" content="3">
    <title>meshnet · projects</title><style>
      body{margin:0;font-family:ui-monospace,Menlo,monospace;background:#0b0b0f;color:#e7e7ee;display:grid;place-items:center;height:100vh}
      .wrap{width:min(440px,90vw)} h1{font-size:1rem;letter-spacing:.1em;text-transform:uppercase;opacity:.6}
      .row{display:flex;justify-content:space-between;align-items:center;padding:.9rem 1rem;margin:.4rem 0;border:1px solid #1c1c24;border-radius:10px;text-decoration:none;color:inherit}
      .row:hover{background:#14141c} .row.off{opacity:.45;cursor:default}
      .st{font-size:.7rem} .st.ready{color:#10b981}.st.booting{color:#f59e0b}.st.failed{color:#ef4444}
    </style><div class="wrap"><h1>meshnet · projects</h1>${rows}</div>`;
}
const switcherPill = (title) =>
  `<div style="position:fixed;top:12px;right:12px;z-index:2147483647;font:12px ui-monospace,Menlo,monospace">
    <a href="${CONTROL}/projects" style="display:inline-flex;gap:7px;align-items:center;background:#16161fe6;color:#e7e7ee;border:1px solid #2a2a35;border-radius:999px;padding:7px 13px;text-decoration:none">
    <span style="color:#10b981">●</span>${title}<span style="opacity:.55">⇄ projects</span></a></div>`;

function startEdgeServer() {
  http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost:3000");
      const send = (code, body, type = "text/html; charset=utf-8") =>
        res.writeHead(code, { "content-type": type }).end(body);

      if (url.pathname === `${CONTROL}/projects`) return send(200, pickerHtml());
      if (url.pathname.startsWith(`${CONTROL}/select/`)) {
        const id = url.pathname.split("/").pop();
        return res.writeHead(302, { location: "/", "set-cookie": `mesh=${id}; Path=/; SameSite=Lax` }).end();
      }

      const chat = readCookie(req, "mesh") && getChat(readCookie(req, "mesh"));
      if (!chat || chat.status !== "ready" || !chat.domain) return send(200, pickerHtml());

      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (k !== "host" && k !== "cookie") headers.set(k, v);
      const init = { method: req.method, headers, redirect: "manual" };
      if (req.method !== "GET" && req.method !== "HEAD") {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        init.body = Buffer.concat(chunks);
      }
      const r = await fetch(chat.domain + url.pathname + url.search, init);
      const out = {};
      r.headers.forEach((v, k) => { if (k !== "content-encoding" && k !== "content-length") out[k] = v; });

      if ((r.headers.get("content-type") || "").includes("text/html")) {
        let body = await r.text();
        body = body.includes("</body>") ? body.replace("</body>", switcherPill(chat.title) + "</body>") : body + switcherPill(chat.title);
        return res.writeHead(r.status, out).end(body);
      }
      res.writeHead(r.status, out).end(Buffer.from(await r.arrayBuffer()));
    } catch (err) {
      res.writeHead(502, { "content-type": "text/plain" }).end(String(err));
    }
  }).listen(3000, () => console.log("edge server → http://localhost:3000"));
}

ipcMain.handle("chats:create", async () => serialize(await createChat()));
ipcMain.handle("chats:list", async () => {
  const cs = listChats();
  cs.forEach(ensureRoute);
  return cs.map(serialize);
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: "#0b0b0f",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      webviewTag: true,
      contextIsolation: true,
    },
  });
  win.loadFile("index.html");
  win.webContents.on("did-finish-load", () => win.webContents.setZoomFactor(1.3));
}

app.whenReady().then(() => { createWindow(); startEdgeServer(); });
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
