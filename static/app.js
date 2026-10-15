"use strict";

const state = { me: null, meta: null, posts: [], players: [] };
const postFilter = { q: "", area: "", when: "all", level: "", slot: "", sort: "soon" };
const playerFilter = { q: "", level: "", day: "", looking: false };
let weekOffset = 0;
const view = document.getElementById("view");

// ---------- helpers ----------
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ไม่เป็นไร */ }
  },
};
const saved = new Set(store.get("saved", []));

async function api(path, body) {
  const opts = { credentials: "same-origin" };
  if (body !== undefined) {
    opts.method = "POST";
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง");
    err.status = res.status;
    throw err;
  }
  return data;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

// ---------- dates ----------
const TH_DAYS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const TH_MONTHS_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

function localISO(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return localISO(d);
}
function thaiDate(iso) {
  const d = parseISO(iso);
  return `${TH_DAYS[d.getDay()]} ${d.getDate()} ${TH_MONTHS[d.getMonth()]}`;
}
function dayLabel(iso) {
  const today = localISO();
  if (iso === today) return `วันนี้ · ${thaiDate(iso)}`;
  if (iso === addDays(today, 1)) return `พรุ่งนี้ · ${thaiDate(iso)}`;
  return thaiDate(iso);
}
function timeRange(p) {
  return `${p.endTime ? `${p.time}–${p.endTime}` : p.time} น.`;
}
// วันเสาร์-อาทิตย์ที่จะถึง (ถ้าวันนี้เป็นวันอาทิตย์ = วันนี้วันเดียว)
function isThisWeekend(iso) {
  const today = localISO();
  const end = addDays(today, (7 - parseISO(today).getDay()) % 7);
  const day = parseISO(iso).getDay();
  return iso >= today && iso <= end && (day === 0 || day === 6);
}

// ---------- icons & art ----------
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  level: '<path d="M6 20v-4M12 20V10M18 20V4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  arrowUpRight: '<path d="M7 17 17 7M7 7h10v10"/>',
  arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  chevLeft: '<path d="m15 18-6-6 6-6"/>',
  chevRight: '<path d="m9 18 6-6-6-6"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
};

function icon(name, size = 16) {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

function hashStr(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return h >>> 0;
}

const ART_THEMES = [
  ["#163d2b", "#2c6a4c", "#3c8a5f"],
  ["#15343e", "#2a5b69", "#3a7d8d"],
  ["#2a3816", "#4a6229", "#6a8a3a"],
  ["#34241b", "#6b4632", "#8f5f43"],
  ["#1d2742", "#384d77", "#4d68a0"],
];

// ภาพคอร์ทแบดวาดด้วย SVG แทนรูปถ่าย — สีและตำแหน่งลูกขนไก่สุ่มจาก seed ให้แต่ละก๊วนไม่ซ้ำกัน
function courtArt(seed) {
  const h = hashStr(seed);
  const [deep, mid, floor] = ART_THEMES[h % ART_THEMES.length];
  const gid = `g${h.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const sx = 70 + ((h >> 4) % 260);
  const sy = 135 + ((h >> 12) % 40);
  const rot = ((h >> 16) % 80) - 40;
  return `<svg class="art" viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${deep}"/><stop offset="1" stop-color="${mid}"/></linearGradient></defs>
    <rect width="400" height="200" fill="url(#${gid})"/>
    <g fill="#fff" opacity=".22"><ellipse cx="70" cy="14" rx="30" ry="4"/><ellipse cx="200" cy="10" rx="34" ry="4"/><ellipse cx="330" cy="14" rx="30" ry="4"/></g>
    <polygon points="120,48 280,48 380,200 20,200" fill="${floor}"/>
    <g fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="2">
      <polygon points="120,48 280,48 380,200 20,200"/>
      <path d="M132 48 47 200M268 48l85 152M97.6 82h204.8M59.5 140h281M200 48v34M200 140v60"/>
    </g>
    <path d="M80.5 108h239" stroke="#fff" stroke-width="3"/>
    <rect x="80.5" y="90" width="239" height="18" fill="#fff" opacity=".18"/>
    <path d="M80.5 90h239M80.5 88v22M319.5 88v22" stroke="#fff" stroke-width="2"/>
    <g transform="translate(${sx} ${sy}) rotate(${rot})">
      <path d="M-8-20h16l-4 18h-8Z" fill="#fff" opacity=".95"/>
      <path d="M-3-20-2-2M3-20 2-2" stroke="${floor}" stroke-width="1" opacity=".5"/>
      <circle cy="2" r="5" fill="#f6f1e4"/>
    </g>
  </svg>`;
}

function avatar(u, cls = "") {
  return `<span class="av ${cls}" title="${esc(u.displayName)}">${esc(u.avatar)}</span>`;
}

function daysRow(days) {
  return `<div class="days">${state.meta.days
    .map((d) => `<span class="${days.includes(d) ? "on" : ""}">${esc(d)}</span>`).join("")}</div>`;
}

// ---------- account ----------
function renderAccount() {
  const el = document.getElementById("account");
  el.innerHTML = state.me
    ? `<a class="me-link" href="#/me" title="โปรไฟล์ของฉัน">${avatar(state.me, "md")}${icon("chevDown", 14)}</a>`
    : `<button class="btn" id="loginBtn">เข้าสู่ระบบ</button>`;
  document.getElementById("loginBtn")?.addEventListener("click", () => openAuth("login"));
}

function setMe(me) {
  state.me = me;
  renderAccount();
}

// ---------- profile form (ใช้ทั้งตอนสมัครและแก้ไข) ----------
function profileFields(values = {}) {
  const frag = document.getElementById("profileFields").content.cloneNode(true);
  const { avatars, playerLevels, days } = state.meta;
  const current = values.avatar || avatars[0];
  frag.querySelector("[data-avatars]").innerHTML = avatars.map((a) => `
    <label><input type="radio" name="avatar" value="${esc(a)}" ${a === current ? "checked" : ""}><span>${esc(a)}</span></label>`).join("");
  frag.querySelector("[data-player-levels]").innerHTML = `<option value="">เลือก…</option>` +
    playerLevels.map((l) => `<option ${l === values.level ? "selected" : ""}>${esc(l)}</option>`).join("");
  const myDays = values.days || [];
  frag.querySelector("[data-days]").innerHTML = days.map((d) => `
    <label><input type="checkbox" name="days" value="${esc(d)}" ${myDays.includes(d) ? "checked" : ""}><span>${esc(d)}</span></label>`).join("");
  for (const name of ["displayName", "area", "contact", "times", "bio"]) {
    frag.querySelector(`[name="${name}"]`).value = values[name] || "";
  }
  frag.querySelector('[name="lookingForPartner"]').checked = values.lookingForPartner ?? true;
  return frag;
}

function readProfile(form) {
  const fd = new FormData(form);
  return {
    displayName: fd.get("displayName"),
    avatar: fd.get("avatar"),
    level: fd.get("level"),
    area: fd.get("area"),
    contact: fd.get("contact"),
    times: fd.get("times"),
    bio: fd.get("bio"),
    days: fd.getAll("days"),
    lookingForPartner: fd.get("lookingForPartner") === "on",
  };
}

// ---------- auth dialog ----------
const authDialog = document.getElementById("authDialog");
const authForm = document.getElementById("authForm");
let authMode = "login";
let afterLogin = null;

function setAuthMode(mode) {
  authMode = mode;
  authForm.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
  const extra = document.getElementById("registerFields");
  extra.innerHTML = "";
  if (mode === "register") extra.appendChild(profileFields());
  authForm.password.autocomplete = mode === "register" ? "new-password" : "current-password";
  document.getElementById("authSubmit").textContent = mode === "register" ? "สมัครสมาชิก" : "เข้าสู่ระบบ";
  document.getElementById("authError").textContent = "";
}

function openAuth(mode, then = null) {
  afterLogin = then;
  setAuthMode(mode);
  authDialog.showModal();
}

function requireLogin(then) {
  if (state.me) return then();
  toast("กรุณาเข้าสู่ระบบก่อน");
  openAuth("login", then);
}

authForm.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setAuthMode(t.dataset.mode)));

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = { username: authForm.username.value, password: authForm.password.value };
  if (authMode === "register") Object.assign(body, readProfile(authForm));
  try {
    const data = await api(`/api/${authMode}`, body);
    setMe(data.me);
    authDialog.close();
    authForm.reset();
    toast(authMode === "register" ? `ยินดีต้อนรับ ${data.me.displayName}! 🏸` : `สวัสดี ${data.me.displayName}`);
    const then = afterLogin;
    afterLogin = null;
    if (then) await then();
    else route();
  } catch (err) {
    document.getElementById("authError").textContent = err.message;
  }
});

document.querySelectorAll("[data-close]").forEach((b) =>
  b.addEventListener("click", () => b.closest("dialog").close()));

// ---------- create dialog ----------
const postDialog = document.getElementById("postDialog");
const postForm = document.getElementById("postForm");

function openPostDialog() {
  requireLogin(() => {
    postForm.reset();
    document.getElementById("postError").textContent = "";
    const level = document.getElementById("postLevel");
    level.innerHTML = state.meta.levels.map((l) => `<option>${esc(l)}</option>`).join("");
    level.value = state.me.level;  // เติมจากโปรไฟล์
    postForm.area.value = state.me.area || "";
    postForm.date.min = localISO();
    postForm.date.value = localISO();
    postDialog.showModal();
  });
}

document.getElementById("createBtn").addEventListener("click", openPostDialog);

postForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(postForm));
  try {
    const { post } = await api("/api/posts", body);
    postDialog.close();
    toast("สร้างนัดแล้ว รอเพื่อนมาเข้าร่วมได้เลย");
    location.hash = `#/p/${encodeURIComponent(post.id)}`;
  } catch (err) {
    document.getElementById("postError").textContent = err.message;
  }
});

// ---------- data ----------
async function loadPosts() {
  try {
    state.posts = (await api("/api/posts")).posts;
  } catch (err) {
    toast(err.message);
  }
}

function myPosts() {
  return state.posts.filter((p) => p.isHost || p.joined);
}

// ---------- game card ----------
function spotBadge(p) {
  if (p.spotsLeft <= 0) return `<span class="spot-badge closed">เต็มแล้ว</span>`;
  if (p.spotsLeft <= 2) return `<span class="spot-badge">เหลืออีก ${p.spotsLeft} ที่</span>`;
  return `<span class="spot-badge open">เปิดรับ ${p.spotsLeft} ที่</span>`;
}

function actionButton(p, size = "small") {
  const id = esc(p.id);
  if (p.isHost) return `<a class="btn ${size}" href="#/p/${id}">ก๊วนของคุณ</a>`;
  if (p.joined) return `<button class="btn ${size}" data-act="leave" data-id="${id}">${icon("check", 14)} เข้าร่วมแล้ว</button>`;
  if (p.spotsLeft <= 0) return `<button class="btn ${size}" disabled>เต็มแล้ว</button>`;
  return `<button class="btn primary ${size}" data-act="join" data-id="${id}">${icon("arrowUpRight", 14)} เข้าร่วมก๊วน</button>`;
}

function postCard(p) {
  const href = `#/p/${encodeURIComponent(p.id)}`;
  const isSaved = saved.has(p.id);
  return `
    <article class="gcard ${p.spotsLeft <= 0 ? "full" : ""}">
      <a class="gcover" href="${href}" tabindex="-1">${courtArt(p.id)}${spotBadge(p)}</a>
      <button class="bookmark ${isSaved ? "on" : ""}" data-save="${esc(p.id)}" aria-pressed="${isSaved}" aria-label="บันทึกก๊วนนี้">${icon("bookmark", 16)}</button>
      <div class="gbody">
        <div class="gdate-row"><span class="gdate">${esc(dayLabel(p.date))}</span><span class="lvl">${esc(p.level)}</span></div>
        <h3><a href="${href}">${esc(p.title || p.court)}</a></h3>
        <div class="ginfo">${icon("clock")}<span>${esc(timeRange(p))}</span></div>
        <div class="ginfo">${icon("pin")}<div>${esc(p.court)}${p.area ? `<small>${esc(p.area)}</small>` : ""}</div></div>
        <div class="host-row">
          ${p.host ? `<a href="#/u/${encodeURIComponent(p.host.username)}">${avatar(p.host)} ${esc(p.host.displayName)}</a>` : "<span></span>"}
          <span class="price">${p.cost ? `฿${esc(p.cost)} <small>/ คน</small>` : `<small>ไม่ระบุค่าคอร์ท</small>`}</span>
        </div>
        <div class="gfoot">
          <span>${icon("users")} ${p.players.length}/${p.need} คนเข้าร่วม</span>
          ${actionButton(p)}
        </div>
      </div>
    </article>`;
}

async function postAction(id, act) {
  if (act === "leave" && !confirm("ยกเลิกการเข้าร่วมก๊วนนี้?")) return;
  if (act === "delete" && !confirm("ลบนัดนี้? คนที่เข้าร่วมแล้วจะไม่เห็นนัดนี้อีก")) return;
  try {
    await api(`/api/posts/${encodeURIComponent(id)}/${act}`, {});
    toast({ join: "เข้าร่วมแล้ว! อย่าลืมทักเจ้าของก๊วน", leave: "ยกเลิกการเข้าร่วมแล้ว", delete: "ลบนัดแล้ว" }[act]);
    if (act === "delete") {
      location.hash = "#/my";
      return;
    }
  } catch (err) {
    toast(err.message);
  }
  route();
}

view.addEventListener("click", (e) => {
  const act = e.target.closest("[data-act]");
  if (act) {
    const { id, act: action } = act.dataset;
    requireLogin(() => postAction(id, action));
    return;
  }
  const save = e.target.closest("[data-save]");
  if (save) {
    const id = save.dataset.save;
    if (saved.has(id)) saved.delete(id);
    else saved.add(id);
    store.set("saved", [...saved]);
    save.classList.toggle("on", saved.has(id));
    save.setAttribute("aria-pressed", saved.has(id));
    toast(saved.has(id) ? "บันทึกไว้แล้ว ดูได้ที่ นัดของฉัน" : "เอาออกจากที่บันทึกแล้ว");
    return;
  }
  if (e.target.closest("[data-create]")) openPostDialog();
  if (e.target.closest("[data-login]")) openAuth("login");
});

// ---------- views ----------
function setNav(name) {
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
}

function options(list, selected, allLabel) {
  return `<option value="">${esc(allLabel)}</option>` +
    list.map((v) => `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(v)}</option>`).join("");
}

const SLOTS = { morning: "ช่วงเช้า (ก่อน 12:00)", afternoon: "ช่วงบ่าย (12:00–17:00)", evening: "ช่วงเย็น (17:00 เป็นต้นไป)" };

function inSlot(p, slot) {
  const hour = parseInt(p.time, 10);
  if (slot === "morning") return hour < 12;
  if (slot === "afternoon") return hour >= 12 && hour < 17;
  if (slot === "evening") return hour >= 17;
  return true;
}

function matchesWhen(p) {
  const w = postFilter.when;
  const today = localISO();
  if (w === "today") return p.date === today;
  if (w === "tomorrow") return p.date === addDays(today, 1);
  if (w === "weekend") return isThisWeekend(p.date);
  if (w.startsWith("date:")) return p.date === w.slice(5);
  return true;
}

async function postsView() {
  setNav("posts");
  await loadPosts();
  const name = state.me ? ` ${state.me.displayName}` : "";
  const areas = [...new Set(state.posts.map((p) => p.area).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));
  const openCount = state.posts.filter((p) => p.spotsLeft > 0).length;
  const peopleCount = new Set(state.posts.flatMap((p) => [p.host?.username, ...p.players.map((u) => u.username)]).filter(Boolean)).size;
  const dateValue = postFilter.when.startsWith("date:") ? postFilter.when.slice(5) : "";

  view.innerHTML = `
    <section class="greet">
      <h1>สวัสดี${esc(name)} วันนี้ไปตีแบดกันไหม?</h1>
      <p class="sub">หาก๊วนที่ใช่ แล้วเจอกันที่คอร์ต — มีเพื่อนรอเล่นด้วยอีกเพียบ</p>
    </section>
    <section class="hero">
      <div class="hero-text">
        <span class="eyebrow">MORE THAN A GAME</span>
        <h2>ไม่ต้องมีก๊วน ก็มีเกมดี ๆ ได้</h2>
        <p>มือใหม่หรือมือเก๋า มาเจอเพื่อนใหม่ที่ชอบแบดเหมือนกัน</p>
        <div class="hero-stats"><span class="live-dot"></span><b>${openCount} ก๊วน</b>เปิดรับเพื่อน · เพื่อนร่วมคอร์ต ${peopleCount} คน</div>
      </div>
      <div class="hero-art">${courtArt("hero-court")}<span class="hero-tag">เพื่อนใหม่ เริ่มได้ที่คอร์ต</span></div>
    </section>
    <div class="layout">
      <div class="main-col">
        <div class="panel">
          <label class="searchbox">${icon("search", 18)}
            <input type="search" id="fq" placeholder="ค้นหาชื่อก๊วน สนาม หรือย่านที่อยากไปตี..." value="${esc(postFilter.q)}" aria-label="ค้นหา">
          </label>
          <div class="pills">
            <label class="pill ${postFilter.area ? "on" : ""}">${icon("pin", 14)}<select id="farea" aria-label="พื้นที่">${options(areas, postFilter.area, "ทุกพื้นที่")}</select></label>
            <label class="pill ${dateValue ? "on" : ""}">${icon("calendar", 14)}<input type="date" id="fdate" min="${localISO()}" value="${esc(dateValue)}" aria-label="วันที่"></label>
            <label class="pill ${postFilter.level ? "on" : ""}">${icon("level", 14)}<select id="flevel" aria-label="ระดับฝีมือ">${options(state.meta.playerLevels, postFilter.level, "ทุกระดับฝีมือ")}</select></label>
            <label class="pill ${postFilter.slot ? "on" : ""}">${icon("clock", 14)}<select id="fslot" aria-label="ช่วงเวลา">
              <option value="">ทุกช่วงเวลา</option>
              ${Object.entries(SLOTS).map(([k, v]) => `<option value="${k}" ${k === postFilter.slot ? "selected" : ""}>${v}</option>`).join("")}
            </select></label>
            <button class="btn ghost small reset" id="freset">${icon("sliders", 14)} ล้างตัวกรอง</button>
          </div>
        </div>

        <div class="section-head">
          <h2>ก๊วนที่เปิดรับเพื่อน <small id="postCount"></small></h2>
          <label class="sort">เรียงตาม:
            <select id="fsort">
              <option value="soon">วันเวลาใกล้สุด</option>
              <option value="fill">ใกล้เต็ม</option>
              <option value="cheap">ราคาถูกสุด</option>
            </select>
          </label>
        </div>
        <div class="quick" id="quick"></div>
        <div class="grid" id="postGrid"></div>
      </div>
      <aside class="side-col" id="side"></aside>
    </div>`;

  document.getElementById("fsort").value = postFilter.sort;
  const bind = (id, fn) => document.getElementById(id).addEventListener("input", (e) => {
    fn(e.target.value);
    e.target.closest(".pill")?.classList.toggle("on", Boolean(e.target.value));
    renderPosts();
  });
  bind("fq", (v) => { postFilter.q = v; });
  bind("farea", (v) => { postFilter.area = v; });
  bind("flevel", (v) => { postFilter.level = v; });
  bind("fslot", (v) => { postFilter.slot = v; });
  bind("fsort", (v) => { postFilter.sort = v; });
  bind("fdate", (v) => { postFilter.when = v ? `date:${v}` : "all"; });
  document.getElementById("freset").addEventListener("click", () => {
    Object.assign(postFilter, { q: "", area: "", when: "all", level: "", slot: "" });
    postsView();
  });
  renderPosts();
}

function renderPosts() {
  const grid = document.getElementById("postGrid");
  if (!grid) return;
  const q = postFilter.q.trim().toLowerCase();
  const posts = state.posts.filter((p) =>
    (!q || `${p.title} ${p.court} ${p.area}`.toLowerCase().includes(q)) &&
    (!postFilter.area || p.area === postFilter.area) &&
    (!postFilter.level || p.level === postFilter.level || p.level === "ทุกระดับ") &&
    inSlot(p, postFilter.slot) &&
    matchesWhen(p));
  if (postFilter.sort === "fill") posts.sort((a, b) => (a.spotsLeft <= 0) - (b.spotsLeft <= 0) || a.spotsLeft - b.spotsLeft);
  if (postFilter.sort === "cheap") posts.sort((a, b) => (a.cost || Infinity) - (b.cost || Infinity));

  document.getElementById("postCount").textContent = `${posts.length} นัด`;
  grid.innerHTML = posts.length
    ? posts.map(postCard).join("")
    : `<div class="empty">${state.posts.length
      ? "ไม่มีก๊วนที่ตรงกับตัวกรอง ลองเปลี่ยนวันหรือพื้นที่ดูนะ"
      : `ยังไม่มีใครเปิดนัด — เป็นคนแรกเลย! 🏸<br><br><button class="btn primary" data-create>${icon("plus", 14)} สร้างนัด</button>`}</div>`;

  const today = localISO();
  const quick = [
    ["all", "ทั้งหมด"],
    ["today", `วันนี้ ${parseISO(today).getDate()} ${TH_MONTHS[parseISO(today).getMonth()]}`],
    ["tomorrow", `พรุ่งนี้ ${thaiDate(addDays(today, 1)).split(" ").slice(1).join(" ")}`],
    ["weekend", "สุดสัปดาห์นี้"],
  ];
  const quickEl = document.getElementById("quick");
  quickEl.innerHTML = quick.map(([k, label]) =>
    `<button data-when="${k}" class="${postFilter.when === k ? "active" : ""}">${esc(label)}</button>`).join("");
  quickEl.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    postFilter.when = b.dataset.when;
    const dateInput = document.getElementById("fdate");
    dateInput.value = "";
    dateInput.closest(".pill").classList.remove("on");
    renderPosts();
  }));
  renderSide();
}

function renderSide() {
  const side = document.getElementById("side");
  if (!side) return;
  const mine = myPosts();
  const today = localISO();
  const start = addDays(today, weekOffset * 7 - 3);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const mid = parseISO(days[3]);
  const myDates = new Set(mine.map((p) => p.date));
  const selected = postFilter.when.startsWith("date:") ? postFilter.when.slice(5) : (postFilter.when === "today" ? today : "");

  let upcoming;
  if (!state.me) {
    upcoming = `<p class="muted-note">เข้าสู่ระบบเพื่อดูนัดของคุณ</p>
      <button class="btn small" data-login style="margin-top:10px">เข้าสู่ระบบ</button>`;
  } else if (!mine.length) {
    upcoming = `<p class="muted-note">ยังไม่มีนัด ลองเข้าร่วมก๊วนที่สนใจดูสิ 🏸</p>`;
  } else {
    const [first, ...rest] = mine;
    const others = first.players.length + (first.isHost ? 0 : 1) - 1;
    const crew = [first.host, ...first.players].filter(Boolean).slice(0, 4);
    upcoming = `
      <div class="next-up">
        <div class="top"><span>${esc(dayLabel(first.date).split(" · ")[0])} · ${esc(timeRange(first))}</span>${icon("check", 16)}</div>
        <h4>${esc(first.title || first.court)}</h4>
        <div class="ginfo">${icon("pin", 14)}<span>${esc(first.court)}${first.area ? ` · ${esc(first.area)}` : ""}</span></div>
        <div class="with"><span class="stack">${crew.map((u) => avatar(u)).join("")}</span>
          ${others > 0 ? `คุณและเพื่อนอีก ${others} คน` : first.isHost ? "รอเพื่อนเข้าร่วม" : "คุณกับเจ้าของก๊วน"}</div>
        <a class="btn small" href="#/p/${encodeURIComponent(first.id)}">${icon("arrowUpRight", 14)} ดูรายละเอียดนัด</a>
      </div>
      ${rest.slice(0, 2).map((p) => {
        const d = parseISO(p.date);
        return `<a class="later" href="#/p/${encodeURIComponent(p.id)}">
          <span class="datebox"><b>${d.getDate()}</b><small>${TH_MONTHS[d.getMonth()]}</small></span>
          <span><div class="later-title">${esc(p.title || p.court)}</div>
          <div class="later-meta">${esc(p.time)} น. · ${esc(p.court)}</div>
          <div class="later-meta">${p.isHost ? "คุณเป็นเจ้าของก๊วน" : "ยืนยันเข้าร่วมแล้ว"}</div></span>
        </a>`;
      }).join("")}
      <a class="see-all" href="#/my">ดูนัดของฉันทั้งหมด ${icon("arrowRight", 14)}</a>`;
  }

  const hosting = state.posts.filter((p) => p.isHost);
  const crewList = !state.me
    ? `<p class="muted-note">เข้าสู่ระบบเพื่อจัดการก๊วนของคุณ</p>`
    : hosting.length
      ? hosting.slice(0, 3).map((p) => `
        <a class="crew" href="#/p/${encodeURIComponent(p.id)}">
          <span class="crew-icon">${icon(parseInt(p.time, 10) < 17 ? "sun" : "moon", 18)}</span>
          <span class="crew-info"><div>${esc(p.title || p.court)}</div>
          <small>${esc(thaiDate(p.date))} · ${p.players.length}/${p.need} คน${p.area ? ` · ${esc(p.area)}` : ""}</small></span>
          ${icon("chevRight")}
        </a>`).join("")
      : `<p class="muted-note">ยังไม่ได้สร้างก๊วน</p>`;

  side.innerHTML = `
    <section class="panel">
      <div class="panel-head"><h3>นัดที่กำลังจะมาถึง</h3><span class="count">${mine.length}</span></div>
      <div class="week-head">
        <span>${TH_MONTHS_FULL[mid.getMonth()]} ${mid.getFullYear() + 543}</span>
        <div>
          <button class="icon-btn" data-week="-1" aria-label="สัปดาห์ก่อน" ${weekOffset <= 0 ? "disabled" : ""}>${icon("chevLeft")}</button>
          <button class="icon-btn" data-week="1" aria-label="สัปดาห์ถัดไป">${icon("chevRight")}</button>
        </div>
      </div>
      <div class="week">
        ${days.map((iso) => {
          const d = parseISO(iso);
          const cls = [iso === today && "today", iso === selected && "sel", myDates.has(iso) && "dot"].filter(Boolean).join(" ");
          return `<button class="${cls}" data-day="${iso}" ${iso < today ? "disabled" : ""} aria-label="${esc(thaiDate(iso))}">
            <small>${TH_DAYS[d.getDay()]}</small><b>${d.getDate()}</b></button>`;
        }).join("")}
      </div>
      ${upcoming}
    </section>
    <section class="panel">
      <div class="panel-head"><h3>ก๊วนของฉัน</h3>${state.me ? `<a href="#/my" style="font-size:13px">ดูทั้งหมด</a>` : ""}</div>
      ${crewList}
    </section>
    <section class="panel cta">
      <span class="corner">${icon("arrowUpRight", 18)}</span>
      <span class="eyebrow">YOUR COURT, YOUR CREW</span>
      <h3>มีคอร์ตแล้ว ขาดแต่เพื่อน?</h3>
      <p>เปิดนัดของคุณ ชวนเพื่อนเข้าก๊วน แล้วแชร์ค่าคอร์ตด้วยกัน</p>
      <button class="btn primary" data-create>${icon("plus", 14)} สร้างนัดของคุณ</button>
    </section>`;

  side.querySelectorAll("[data-week]").forEach((b) => b.addEventListener("click", () => {
    weekOffset = Math.max(0, weekOffset + Number(b.dataset.week));
    renderSide();
  }));
  side.querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => {
    const iso = b.dataset.day;
    postFilter.when = selected === iso ? "all" : `date:${iso}`;
    const dateInput = document.getElementById("fdate");
    dateInput.value = postFilter.when === "all" ? "" : iso;
    dateInput.closest(".pill").classList.toggle("on", postFilter.when !== "all");
    renderPosts();
  }));
}

async function detailView(id) {
  setNav("posts");
  await loadPosts();
  const p = state.posts.find((x) => x.id === id);
  if (!p) {
    view.innerHTML = `<a class="back" href="#/">${icon("arrowLeft", 14)} กลับไปค้นหาก๊วน</a>
      <div class="empty" style="margin-top:14px">ไม่พบนัดนี้ (อาจถูกลบหรือผ่านไปแล้ว)</div>`;
    return;
  }
  const slots = Array.from({ length: p.need }, (_, i) => `<i class="${i < p.players.length ? "on" : ""}"></i>`).join("");
  const contact = p.host?.contact
    ? `<div class="contact-box">${icon("phone")} ${esc(p.host.contact)}</div>`
    : p.host && !state.me
      ? `<div class="contact-box">${icon("lock")} <span><button class="link-btn" data-login>เข้าสู่ระบบ</button> เพื่อดูช่องทางติดต่อ</span></div>`
      : "";
  view.innerHTML = `
    <a class="back" href="#/">${icon("arrowLeft", 14)} กลับไปค้นหาก๊วน</a>
    <div class="detail">
      <div>
        <div class="detail-cover">${courtArt(p.id)}${spotBadge(p)}</div>
        <h1>${esc(p.title || p.court)}</h1>
        <div class="ginfo">${icon("calendar")}<span>${esc(dayLabel(p.date))}</span></div>
        <div class="ginfo">${icon("clock")}<span>${esc(timeRange(p))}</span></div>
        <div class="ginfo">${icon("pin")}<span>${esc(p.court)}${p.area ? ` · ${esc(p.area)}` : ""}</span></div>
        <div class="ginfo">${icon("level")}<span>ระดับ ${esc(p.level)}</span></div>
        <div class="ginfo">${icon("users")}<span>${p.cost ? `ค่าคอร์ท ฿${esc(p.cost)} / คน` : "ไม่ระบุค่าคอร์ท"}</span></div>
        ${p.note ? `<p class="note">${esc(p.note)}</p>` : ""}
      </div>
      <aside class="panel">
        <div class="panel-head"><h3>คนที่เข้าร่วม</h3><span class="count">${p.players.length}/${p.need}</span></div>
        <div class="slots">${slots}</div>
        <div class="people">
          ${p.host ? `<a class="person" href="#/u/${encodeURIComponent(p.host.username)}">${avatar(p.host, "md")}<span>${esc(p.host.displayName)}<br><small>เจ้าของก๊วน · ${esc(p.host.level)}</small></span></a>` : ""}
          ${p.players.map((u) => `<a class="person" href="#/u/${encodeURIComponent(u.username)}">${avatar(u, "md")}<span>${esc(u.displayName)}<br><small>${esc(u.level)}</small></span></a>`).join("")}
        </div>
        ${contact}
        <div class="actions" style="justify-content:stretch">
          ${p.isHost
            ? `<button class="btn danger block" data-act="delete" data-id="${esc(p.id)}">ลบนัดนี้</button>`
            : actionButton(p, "block")}
        </div>
      </aside>
    </div>`;
}

async function myView() {
  setNav("my");
  if (!state.me) {
    view.innerHTML = `<div class="page-head"><h1>นัดของฉัน</h1></div>
      <div class="empty">เข้าสู่ระบบเพื่อดูนัดของคุณ<br><br><button class="btn primary" data-login>เข้าสู่ระบบ</button></div>`;
    return;
  }
  await loadPosts();
  const section = (title, posts, emptyText) => `
    <h2 class="subhead">${title} <small class="username">${posts.length}</small></h2>
    <div class="grid">${posts.length ? posts.map(postCard).join("") : `<div class="empty">${emptyText}</div>`}</div>`;
  view.innerHTML = `
    <div class="page-head"><h1>นัดของฉัน</h1>
      <button class="btn primary" data-create>${icon("plus", 14)} สร้างนัด</button></div>
    ${section("ก๊วนที่ฉันสร้าง", state.posts.filter((p) => p.isHost), "ยังไม่ได้สร้างนัด")}
    ${section("ก๊วนที่ฉันเข้าร่วม", state.posts.filter((p) => p.joined), `ยังไม่ได้เข้าร่วมก๊วนไหน — <a href="#/">ไปหาก๊วนกัน</a>`)}
    ${section("บันทึกไว้", state.posts.filter((p) => saved.has(p.id)), "กดไอคอนบันทึกบนการ์ดก๊วนเพื่อเก็บไว้ดูทีหลัง")}`;
}

async function courtsView() {
  setNav("courts");
  await loadPosts();
  const courts = new Map();
  for (const p of state.posts) {
    const key = p.court.trim().toLowerCase();
    if (!courts.has(key)) courts.set(key, { name: p.court, areas: new Set(), posts: [] });
    const c = courts.get(key);
    if (p.area) c.areas.add(p.area);
    c.posts.push(p);
  }
  const list = [...courts.values()].sort((a, b) => b.posts.length - a.posts.length);
  view.innerHTML = `
    <div class="page-head"><h1>สนามแบด</h1><span class="username">สนามที่มีก๊วนเปิดนัดอยู่ตอนนี้</span></div>
    <div class="grid">
      ${list.length ? list.map((c) => {
        const open = c.posts.filter((p) => p.spotsLeft > 0).length;
        const costs = c.posts.map((p) => p.cost).filter(Boolean);
        return `<article class="gcard">
          <div class="gcover">${courtArt(c.name)}</div>
          <div class="gbody court-card">
            <h3>${esc(c.name)}</h3>
            ${c.areas.size ? `<div class="ginfo">${icon("pin")}<span>${esc([...c.areas].join(", "))}</span></div>` : ""}
            <div class="ginfo">${icon("calendar")}<span>นัดถัดไป ${esc(dayLabel(c.posts[0].date))} ${esc(c.posts[0].time)} น.</span></div>
            ${costs.length ? `<div class="ginfo">${icon("users")}<span>ค่าคอร์ท ฿${Math.min(...costs)}${Math.max(...costs) !== Math.min(...costs) ? `–${Math.max(...costs)}` : ""} / คน</span></div>` : ""}
            <div class="gfoot"><span>${c.posts.length} นัด · เปิดรับ ${open}</span>
              <button class="btn primary small" data-court="${esc(c.name)}">ดูก๊วนที่นี่</button></div>
          </div>
        </article>`;
      }).join("") : `<div class="empty">ยังไม่มีสนามที่มีนัด — สร้างนัดแรกได้เลย!<br><br><button class="btn primary" data-create>${icon("plus", 14)} สร้างนัด</button></div>`}
    </div>`;
  view.querySelectorAll("[data-court]").forEach((b) => b.addEventListener("click", () => {
    Object.assign(postFilter, { q: b.dataset.court, area: "", when: "all", level: "", slot: "" });
    location.hash = "#/";
  }));
}

function playerCard(u) {
  return `
    <a class="panel player" href="#/u/${encodeURIComponent(u.username)}">
      <div class="player-head">
        ${avatar(u, "md")}
        <div>
          <div class="player-name">${esc(u.displayName)}</div>
          <div class="username">@${esc(u.username)}</div>
        </div>
      </div>
      <div class="tags">
        <span class="lvl">${esc(u.level)}</span>
        ${u.lookingForPartner ? `<span class="tag-warn">หาเพื่อนตี</span>` : ""}
        ${u.area ? `<span>${icon("pin", 14)} ${esc(u.area)}</span>` : ""}
      </div>
      ${daysRow(u.days)}
      ${u.bio ? `<p class="bio">${esc(u.bio)}</p>` : ""}
    </a>`;
}

async function playersView() {
  setNav("players");
  view.innerHTML = `
    <div class="page-head"><h1>คอมมูนิตี้</h1><span class="username">หาเพื่อนหรือคู่ตีประจำที่ระดับและเวลาตรงกัน</span></div>
    <div class="panel filters">
      <input type="search" id="pq" placeholder="ค้นหาชื่อ / ย่าน" value="${esc(playerFilter.q)}" aria-label="ค้นหา">
      <select id="plevel" aria-label="ระดับฝีมือ">${options(state.meta.playerLevels, playerFilter.level, "ทุกระดับฝีมือ")}</select>
      <select id="pday" aria-label="วันที่ว่าง">
        <option value="">ทุกวัน</option>
        ${state.meta.days.map((d) => `<option value="${esc(d)}" ${d === playerFilter.day ? "selected" : ""}>ว่างวัน ${esc(d)}</option>`).join("")}
      </select>
      <label class="check"><input type="checkbox" id="plooking" ${playerFilter.looking ? "checked" : ""}> กำลังหาเพื่อนตี</label>
    </div>
    <div class="grid" id="playerList"></div>`;
  const bind = (id, key, prop = "value") => document.getElementById(id).addEventListener("input", (e) => {
    playerFilter[key] = e.target[prop];
    renderPlayers();
  });
  bind("pq", "q");
  bind("plevel", "level");
  bind("pday", "day");
  bind("plooking", "looking", "checked");
  try {
    state.players = (await api("/api/players")).players;
  } catch (err) {
    toast(err.message);
  }
  renderPlayers();
}

function renderPlayers() {
  const list = document.getElementById("playerList");
  if (!list) return;
  const q = playerFilter.q.trim().toLowerCase();
  const players = state.players.filter((u) =>
    (!q || `${u.displayName} ${u.username} ${u.area}`.toLowerCase().includes(q)) &&
    (!playerFilter.level || u.level === playerFilter.level) &&
    (!playerFilter.day || u.days.includes(playerFilter.day)) &&
    (!playerFilter.looking || u.lookingForPartner));
  list.innerHTML = players.length
    ? players.map(playerCard).join("")
    : `<div class="empty">${state.players.length ? "ไม่มีผู้เล่นที่ตรงกับตัวกรอง" : "ยังไม่มีผู้เล่น — สมัครเป็นคนแรกเลย!"}</div>`;
}

async function profileView(username) {
  setNav("players");
  view.innerHTML = `<div class="empty" style="margin-top:28px">กำลังโหลด…</div>`;
  let data;
  try {
    data = await api(`/api/players/${encodeURIComponent(username)}`);
  } catch (err) {
    view.innerHTML = `<div class="empty" style="margin-top:28px">${esc(err.message)}<br><a href="#/players">กลับไปคอมมูนิตี้</a></div>`;
    return;
  }
  const u = data.player;
  const isMe = state.me && state.me.username === u.username;
  const notSet = `<span class="username">ไม่ได้ระบุ</span>`;
  const contact = u.contact !== undefined
    ? (u.contact ? esc(u.contact) : notSet)
    : `<button class="link-btn" data-login>${icon("lock", 14)} เข้าสู่ระบบเพื่อดู</button>`;
  view.innerHTML = `
    <section class="panel profile-card">
      <div class="profile-head">
        ${avatar(u, "lg")}
        <div style="flex:1;min-width:0">
          <h1>${esc(u.displayName)}</h1>
          <div class="username">@${esc(u.username)}</div>
          <div class="tags" style="margin-top:6px">
            <span class="lvl">${esc(u.level)}</span>
            ${u.lookingForPartner ? `<span class="tag-warn">กำลังหาเพื่อนตี</span>` : ""}
          </div>
        </div>
        ${isMe ? `<a class="btn small" href="#/me">แก้ไขโปรไฟล์</a>` : ""}
      </div>
      ${u.bio ? `<p class="bio-full">${esc(u.bio)}</p>` : ""}
      <dl class="facts">
        <dt>ย่าน</dt><dd>${u.area ? esc(u.area) : notSet}</dd>
        <dt>วันที่สะดวก</dt><dd>${daysRow(u.days)}</dd>
        <dt>ช่วงเวลา</dt><dd>${u.times ? esc(u.times) : notSet}</dd>
        <dt>ติดต่อ</dt><dd>${contact}</dd>
      </dl>
    </section>
    <h2 class="subhead">ก๊วนที่กำลังจะไป</h2>
    <div class="grid">
      ${data.posts.length ? data.posts.map(postCard).join("") : `<div class="empty">ยังไม่มีก๊วนที่กำลังจะไป</div>`}
    </div>`;
}

function meView() {
  setNav("");
  if (!state.me) {
    view.innerHTML = `<div class="empty" style="margin-top:28px">กรุณาเข้าสู่ระบบเพื่อแก้ไขโปรไฟล์</div>`;
    openAuth("login");
    return;
  }
  view.innerHTML = `
    <div class="page-head">
      <h1>โปรไฟล์ของฉัน</h1>
      <a href="#/u/${encodeURIComponent(state.me.username)}">ดูหน้าโปรไฟล์ ${icon("arrowRight", 14)}</a>
    </div>
    <form class="panel edit-form" id="meForm">
      <div class="username">@${esc(state.me.username)}</div>
      <div id="meFields" class="edit-form"></div>
      <p class="form-error" id="meError"></p>
      <div class="actions">
        <button type="button" class="btn danger" id="logoutBtn">ออกจากระบบ</button>
        <button type="submit" class="btn primary">บันทึก</button>
      </div>
    </form>`;
  document.getElementById("meFields").appendChild(profileFields(state.me));
  const form = document.getElementById("meForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      setMe((await api("/api/me", readProfile(form))).me);
      toast("บันทึกโปรไฟล์แล้ว");
      document.getElementById("meError").textContent = "";
    } catch (err) {
      document.getElementById("meError").textContent = err.message;
    }
  });
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api("/api/logout", {}).catch(() => {});
    setMe(null);
    toast("ออกจากระบบแล้ว");
    location.hash = "#/";
  });
}

// ---------- router ----------
function route() {
  const hash = location.hash.replace(/^#/, "") || "/";
  let m;
  if ((m = hash.match(/^\/u\/(.+)$/))) return profileView(decodeURIComponent(m[1]));
  if ((m = hash.match(/^\/p\/(.+)$/))) return detailView(decodeURIComponent(m[1]));
  if (hash === "/players") return playersView();
  if (hash === "/courts") return courtsView();
  if (hash === "/my") return myView();
  if (hash === "/me") return meView();
  return postsView();
}

window.addEventListener("hashchange", () => {
  route();
  window.scrollTo(0, 0);
});

// รีเฟรชรายการก๊วนเป็นระยะ ถ้าอยู่หน้าค้นหาและไม่มี dialog เปิดอยู่
setInterval(async () => {
  if (document.getElementById("postGrid") && !document.querySelector("dialog[open]") && !document.hidden) {
    await loadPosts();
    renderPosts();
  }
}, 30000);

(async function init() {
  try {
    const data = await api("/api/me");
    state.meta = data;
    setMe(data.me);
  } catch (err) {
    view.innerHTML = `<div class="empty" style="margin-top:28px">เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ${esc(err.message)}</div>`;
    return;
  }
  route();
})();
