// Vercel Sandbox lifecycle — one ephemeral microVM per chat, each running a
// dev server on port 3000. (@vercel/sandbox is ESM; load it via dynamic import.)
let SandboxMod;
async function Sandbox() {
  if (!SandboxMod) SandboxMod = await import("@vercel/sandbox");
  return SandboxMod.Sandbox;
}

const chats = new Map(); // id -> chat
const sandboxes = new Map(); // id -> Sandbox instance
let counter = 0;

const PALETTE = ["#6366f1", "#ec4899", "#10b981", "#f59e0b", "#06b6d4", "#ef4444"];

/** The dev server that runs inside each VM, on port 3000. */
function devServerSource(title, accent) {
  return `import { createServer } from "node:http";
const TITLE = ${JSON.stringify(title)};
const ACCENT = ${JSON.stringify(accent)};
const started = new Date().toISOString();
const page = () => \`<!doctype html><html><head><meta charset="utf8">
<title>\${TITLE}</title><style>
  *{box-sizing:border-box} body{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  background:#0b0b0f;color:#e7e7ee;display:grid;place-items:center;height:100vh}
  .card{text-align:center} h1{font-size:2.4rem;margin:0 0 .3rem;color:\${ACCENT}}
  .meta{opacity:.5;font-size:.8rem;margin-top:1rem;line-height:1.6}
  button{margin-top:1.4rem;background:\${ACCENT};border:0;color:#fff;font:inherit;
  padding:.7rem 1.4rem;border-radius:8px;cursor:pointer}
  #n{font-size:3rem;font-weight:700} a{color:\${ACCENT}}
</style></head><body><div class="card">
  <h1>\${TITLE}</h1>
  <div>live dev server — count: <span id="n">0</span></div>
  <button onclick="document.getElementById('n').textContent=++c">increment</button>
  <div style="margin-top:1rem"><a href="/about">/about</a> · <a href="/settings">/settings</a></div>
  <div class="meta">url: <span id="u"></span><br>running on Vercel Sandbox<br>booted \${started}<br>pid \${process.pid}</div>
</div><script>let c=0;
  const u=document.getElementById("u");
  const show=()=>u.textContent=location.href;
  show();addEventListener("popstate",show);addEventListener("hashchange",show);
</script></body></html>\`;
createServer((req, res) => { res.setHeader("content-type","text/html"); res.end(page()); })
  .listen(process.env.PORT || 3000, () => console.log("dev server up"));
`;
}

function listChats() {
  return [...chats.values()].sort((a, b) => a.createdAt - b.createdAt);
}
function getChat(id) {
  return chats.get(id);
}

async function createChat() {
  const n = ++counter;
  const id = `chat${n}`;
  const chat = { id, title: `Chat ${n}`, status: "booting", createdAt: Date.now() };
  chats.set(id, chat);
  boot(chat, PALETTE[(n - 1) % PALETTE.length]).catch((err) => {
    chat.status = "failed";
    chat.error = String((err && err.message) || err);
    console.error(`[${id}] boot failed:`, err);
  });
  return chat;
}

async function boot(chat, accent) {
  const SB = await Sandbox();
  console.log(`[${chat.id}] creating sandbox…`);
  const sandbox = await SB.create({ runtime: "node24", ports: [3000], timeout: 30 * 60 * 1000 });
  sandboxes.set(chat.id, sandbox);
  await sandbox.fs.writeFile("server.mjs", devServerSource(chat.title, accent));
  await sandbox.runCommand({ cmd: "node", args: ["server.mjs"], env: { PORT: "3000" }, detached: true });
  chat.domain = sandbox.domain(3000);
  chat.status = "ready";
  console.log(`[${chat.id}] ready → ${chat.domain}`);
}

module.exports = { createChat, listChats, getChat };
