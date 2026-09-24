const LEVELS = ["BG", "N", "S", "P-", "P", "P+"];
const LEVEL_NAME = { "BG": "BG มือใหม่", "N": "N เริ่มตีได้", "S": "S ตีเป็นเกม", "P-": "P- กลางอ่อน", "P": "P กลาง", "P+": "P+ กลางแข็ง" };
const TH_DAY = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const REFRESH_MS = 10000;

const $ = id => document.getElementById(id);
const state = { sessions: [], day: "all", level: "", q: "" };

// ---------- ตัวช่วย ----------

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key) || "";
    localStorage.setItem(key, value);
  } catch (e) { return ""; }
}

// รหัสผู้เล่นประจำเบราว์เซอร์ ใช้แยกว่าใครตั้งก๊วน/จอยก๊วน
function playerId() {
  let id = store("kuan.pid");
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
    store("kuan.pid", id);
  }
  return id;
}

async function api(method, path, body) {
  const res = await fetch("/api/sessions" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Player-Id": playerId() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
  return data;
}

function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); }
function parseYmd(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function fmtDate(s) { const d = parseYmd(s); return TH_DAY[d.getDay()] + " " + d.getDate() + " " + TH_MON[d.getMonth()]; }
function dayLabel(s) {
  if (s === addDays(0)) return "วันนี้ · " + fmtDate(s);
  if (s === addDays(1)) return "พรุ่งนี้ · " + fmtDate(s);
  return fmtDate(s);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2400);
}

// ---------- แสดงผล ----------

function matches(s) {
  const weekday = parseYmd(s.date).getDay();
  if (state.day === "today" && s.date !== addDays(0)) return false;
  if (state.day === "tomorrow" && s.date !== addDays(1)) return false;
  if (state.day === "weekend" && weekday !== 0 && weekday !== 6) return false;
  if (state.level !== "") {
    const lv = +state.level;
    if (lv < s.levelMin || lv > s.levelMax) return false;
  }
  if (state.q && !(s.venue + " " + s.area).toLowerCase().includes(state.q.toLowerCase())) return false;
  return true;
}

function render() {
  const list = $("list");
  list.textContent = "";
  $("statOpen").textContent = state.sessions.reduce((n, s) => n + Math.max(0, s.need - s.players.length), 0);

  const rows = state.sessions.filter(matches);
  if (!rows.length) {
    list.appendChild(el("div", "empty", state.sessions.length
      ? "ไม่มีก๊วนตรงกับตัวกรองนี้ ลองเปลี่ยนวันหรือระดับมือดู"
      : "ยังไม่มีใครตั้งก๊วน เป็นคนแรกเลย กด “+ ตั้งก๊วน”"));
    return;
  }

  let lastDay = "";
  for (const s of rows) {
    if (s.date !== lastDay) {
      lastDay = s.date;
      list.appendChild(el("div", "day", dayLabel(s.date)));
    }
    list.appendChild(card(s));
  }
}

function card(s) {
  const left = Math.max(0, s.need - s.players.length);
  const article = el("article", "card");

  const time = el("div", "time");
  time.append(el("b", null, s.start), el("span", null, "ถึง " + s.end));

  const body = el("div", "body");
  body.append(el("h3", null, s.venue));
  body.append(el("div", "where", [s.area, "ตีแบบ" + s.mode, "คนตั้ง: " + s.hostNick].filter(Boolean).join(" · ")));
  const levels = el("div", "levels");
  levels.title = "ระดับมือที่รับ";
  LEVELS.forEach((l, i) => levels.appendChild(el("i", i >= s.levelMin && i <= s.levelMax ? "on" : "", l)));
  body.append(levels);
  const facts = el("div", "facts");
  const court = el("span"); court.append("ค่าคอร์ท ", el("b", null, "฿" + s.courtFee), "/คน");
  const shuttle = el("span"); shuttle.append("ลูกละ ", el("b", null, "฿" + s.shuttleFee), " หาร 4");
  facts.append(court, shuttle);
  body.append(facts);
  if (s.note) body.append(el("p", "msg", s.note));

  const side = el("div", "side");
  side.append(el("span", "need" + (left ? "" : " full"), left ? "ขาดอีก " + left + " ขา" : "เต็มแล้ว"));
  const slots = el("div", "slots");
  for (let i = 0; i < s.need; i++) {
    const p = s.players[i];
    const dot = el("span", "slot" + (p ? " in" : "") + (p && p.isMe ? " me" : ""), p ? p.nick.slice(0, 1) : "");
    dot.title = p ? p.nick + " · มือ " + LEVELS[p.level] : "ว่าง";
    slots.appendChild(dot);
  }
  side.append(slots);
  if (s.players.length) {
    side.append(el("div", "who", "จอยแล้ว: " + s.players.map(p => p.nick + " (" + LEVELS[p.level] + ")").join(", ")));
  }
  if (s.contact) {
    const c = el("div", "contact");
    c.append("LINE: ", el("b", null, s.contact));
    side.append(c);
  }

  const actions = el("div", "actions");
  if (s.isHost) {
    const del = el("button", "btn warn", "ลบก๊วน");
    del.onclick = () => removeSession(s, del);
    actions.append(del);
  } else if (s.joined) {
    const leave = el("button", "btn ghost", "ยกเลิกจอย");
    leave.onclick = () => leaveSession(s, leave);
    actions.append(leave);
  } else {
    const join = el("button", "btn", left ? "ขอจอย" : "เต็มแล้ว");
    join.disabled = !left;
    join.onclick = () => openJoin(s);
    actions.append(join);
  }
  side.append(actions);

  article.append(time, body, side);
  return article;
}

async function refresh() {
  try {
    const data = await api("GET", "");
    state.sessions = data.sessions;
    render();
  } catch (e) {
    if (!state.sessions.length) $("list").replaceChildren(el("div", "empty", "โหลดข้อมูลไม่ได้ เช็กว่าเซิร์ฟเวอร์ยังรันอยู่"));
  }
}

// ---------- ตัวกรอง ----------

for (const id of ["fLevel", "nMin", "nMax", "jLevel"]) {
  LEVELS.forEach((l, i) => {
    const o = el("option", null, id === "fLevel" ? "ฉันมือ " + l : LEVEL_NAME[l]);
    o.value = i;
    $(id).appendChild(o);
  });
}
$("nMin").value = 1; $("nMax").value = 3; $("jLevel").value = 2;

document.querySelectorAll(".chip").forEach(c => c.onclick = () => {
  state.day = c.dataset.day;
  document.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", x === c));
  render();
});
$("fLevel").onchange = e => { state.level = e.target.value; render(); };
$("fQ").oninput = e => { state.q = e.target.value.trim(); render(); };
document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => b.closest("dialog").close());

// ---------- ตั้งก๊วน ----------

$("newBtn").onclick = () => {
  $("nDate").min = addDays(0);
  $("nDate").value = $("nDate").value || addDays(0);
  $("nNick").value = $("nNick").value || store("kuan.nick");
  $("newErr").hidden = true;
  $("newDlg").showModal();
};

$("newForm").onsubmit = async e => {
  e.preventDefault();
  const err = $("newErr");
  const nick = $("nNick").value.trim();
  store("kuan.nick", nick);
  try {
    await api("POST", "", {
      venue: $("nVenue").value, area: $("nArea").value,
      date: $("nDate").value, start: $("nStart").value, end: $("nEnd").value,
      levelMin: +$("nMin").value, levelMax: +$("nMax").value, mode: $("nMode").value,
      need: +$("nNeed").value, courtFee: +$("nCourt").value, shuttleFee: +$("nShuttle").value,
      hostNick: nick, contact: $("nContact").value, note: $("nNote").value,
    });
    $("newDlg").close();
    $("newForm").reset();
    toast("โพสต์ก๊วนแล้ว");
    refresh();
  } catch (x) {
    err.textContent = x.message;
    err.hidden = false;
  }
};

// ---------- จอย / ยกเลิก / ลบ ----------

let joining = null;

function openJoin(s) {
  joining = s;
  $("joinWhat").textContent = s.venue + " · " + fmtDate(s.date) + " " + s.start + "–" + s.end +
    " · รับมือ " + LEVELS[s.levelMin] + "–" + LEVELS[s.levelMax];
  $("jNick").value = store("kuan.nick");
  const lv = store("kuan.level");
  if (lv !== "") $("jLevel").value = lv;
  $("joinErr").hidden = true;
  $("joinDlg").showModal();
}

$("joinForm").onsubmit = async e => {
  e.preventDefault();
  const nick = $("jNick").value.trim(), level = +$("jLevel").value;
  store("kuan.nick", nick);
  store("kuan.level", String(level));
  try {
    await api("POST", "/" + joining.id + "/join", { nick, level });
    $("joinDlg").close();
    toast("จอยแล้ว ทัก LINE คนตั้งก๊วนได้เลย");
    refresh();
  } catch (x) {
    $("joinErr").textContent = x.message;
    $("joinErr").hidden = false;
  }
};

async function leaveSession(s, btn) {
  btn.disabled = true;
  try {
    await api("DELETE", "/" + s.id + "/join");
    toast("ยกเลิกจอยแล้ว");
    refresh();
  } catch (x) {
    btn.disabled = false;
    toast(x.message);
  }
}

async function removeSession(s, btn) {
  if (btn.dataset.armed !== "1") {
    btn.dataset.armed = "1";
    btn.textContent = "กดอีกครั้งเพื่อลบ";
    setTimeout(() => { btn.dataset.armed = ""; btn.textContent = "ลบก๊วน"; }, 3000);
    return;
  }
  btn.disabled = true;
  try {
    await api("DELETE", "/" + s.id);
    toast("ลบก๊วนแล้ว");
    refresh();
  } catch (x) {
    btn.disabled = false;
    toast(x.message);
  }
}

// ---------- เริ่มทำงาน ----------

if (location.protocol === "file:") {
  $("list").replaceChildren(el("div", "empty",
    "ห้ามเปิดไฟล์ index.html ตรง ๆ ให้พิมพ์ python3 server.py ใน Terminal แล้วเปิด http://localhost:8000 แทน"));
  throw new Error("เปิดผ่าน file:// ใช้งานไม่ได้");
}

refresh();
setInterval(() => { if (!document.hidden && !document.querySelector("dialog[open]")) refresh(); }, REFRESH_MS);
