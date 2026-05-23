const $ = (id) => document.getElementById(id);
const listEl = $("list"), framesEl = $("frames"), emptyEl = $("empty");
const addr = $("addr"), backBtn = $("back"), fwdBtn = $("fwd"), reloadBtn = $("reload"), newBtn = $("new");

let chats = [], active = null;
const views = {}; // id -> <webview> (kept mounted so each VM stays live)

// Each webview loads the SAME url — localhost:3000 — but its own session
// partition routes it to its own VM in the main process.
function ensureView(id) {
  if (views[id]) return views[id];
  const v = document.createElement("webview");
  v.setAttribute("partition", "persist:" + id);
  v.setAttribute("src", "http://localhost:3000/");
  const sync = () => { if (active === id) chrome(); };
  v.addEventListener("did-navigate", sync);
  v.addEventListener("did-navigate-in-page", sync);
  v.addEventListener("dom-ready", () => { v.setZoomFactor(3); sync(); });
  framesEl.appendChild(v);
  views[id] = v;
  return v;
}

function activeView() { return active ? views[active] : null; }

function chrome() {
  const v = activeView();
  if (!v) { addr.value = ""; backBtn.disabled = fwdBtn.disabled = true; return; }
  try {
    addr.value = (v.getURL() || "http://localhost:3000/").replace(/^https?:\/\//, "");
    backBtn.disabled = !v.canGoBack();
    fwdBtn.disabled = !v.canGoForward();
  } catch { /* webview not ready yet */ }
}

function select(id) {
  const chat = chats.find((c) => c.id === id);
  if (!chat || chat.status !== "ready") return;
  active = id;
  emptyEl.style.display = "none";
  ensureView(id);
  for (const k in views) views[k].classList.toggle("active", k === id);
  chrome();
  render();
}

function render() {
  listEl.innerHTML = "";
  for (const c of chats) {
    const row = document.createElement("div");
    row.className = "chat" + (c.id === active ? " active" : "");
    row.onclick = () => select(c.id);
    row.innerHTML = `<span>${c.title}</span><span class="dot ${c.status}">● ${c.status}</span>`;
    listEl.appendChild(row);
  }
}

backBtn.onclick = () => activeView() && activeView().goBack();
fwdBtn.onclick = () => activeView() && activeView().goForward();
reloadBtn.onclick = () => activeView() && activeView().reload();
addr.onkeydown = (e) => {
  const v = activeView();
  if (e.key !== "Enter" || !v) return;
  let p = addr.value.trim().replace(/^https?:\/\//, "");
  if (p.startsWith("localhost:3000")) p = p.slice("localhost:3000".length);
  if (!p.startsWith("/")) p = "/" + p;
  v.loadURL("http://localhost:3000" + p);
};

newBtn.onclick = async () => {
  newBtn.disabled = true;
  const c = await window.meshnet.create();
  await refresh();
  newBtn.disabled = false;
};

async function refresh() {
  chats = await window.meshnet.list();
  render();
  // auto-show the active chat once its VM is ready
  if (active && views[active] === undefined) select(active);
}

refresh();
setInterval(refresh, 2000);
