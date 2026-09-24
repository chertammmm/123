const $ = id => document.getElementById(id);
const baht = n => "฿" + n.toLocaleString("th-TH");
const state = { shop: null, sizes: {}, products: [], cat: "ทั้งหมด", cart: [], step: "cart", pick: null };

// ---------- ตัวช่วย ----------

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || "null");
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { return null; }
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2200);
}

const product = id => state.products.find(p => p.id === id);
const colorHex = (p, name) => (p.colors.find(c => c[0] === name) || p.colors[0])[1];

// ---------- หน้าร้าน ----------

function renderChips() {
  const cats = ["ทั้งหมด", ...new Set(state.products.map(p => p.category))];
  $("chips").innerHTML = cats.map(c =>
    `<button class="chip" type="button" aria-pressed="${c === state.cat}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
}

function renderGrid() {
  const list = state.products.filter(p => state.cat === "ทั้งหมด" || p.category === state.cat);
  $("grid").innerHTML = list.map(p => `
    <button class="card" type="button" data-id="${p.id}">
      <div class="tile">
        ${p.print ? '<span class="badge">สกรีนลาย</span>' : ""}
        <span class="hangtag">${baht(p.price)}</span>
        ${shirtSVG(p.shape, p.colors[0][1], p.print)}
      </div>
      <div class="name">${esc(p.name)}</div>
      <div class="meta">
        <span class="muted small">${esc(p.category)} · ${state.sizes[p.fit].length} ไซซ์</span>
        <span class="dots">${p.colors.map(c => `<i style="background:${c[1]}" title="${esc(c[0])}"></i>`).join("")}</span>
      </div>
    </button>`).join("");
}

// ---------- หน้าต่างสินค้า ----------

function openProduct(id) {
  const p = product(id);
  state.pick = { id, color: p.colors[0][0], size: "", qty: 1 };
  $("pdCat").textContent = p.category;
  $("pdName").textContent = p.name;
  $("pdPrice").textContent = baht(p.price);
  $("pdDesc").textContent = p.desc;
  $("pdFabric").textContent = "ผ้า " + p.fabric;
  $("pdQty").value = 1;
  $("pdErr").hidden = true;
  $("pdChart").innerHTML = "<tr><th>ไซซ์</th><th>รอบอก</th><th>ความยาว</th></tr>" +
    state.sizes[p.fit].map(s => `<tr><td>${s[0]}</td><td>${s[1]}"</td><td>${s[2]}"</td></tr>`).join("");
  renderPick();
  $("pd").showModal();
}

function renderPick() {
  const p = product(state.pick.id);
  $("pdImg").innerHTML = shirtSVG(p.shape, colorHex(p, state.pick.color), p.print);
  $("pdColorName").textContent = state.pick.color;
  $("pdColors").innerHTML = p.colors.map(c =>
    `<button class="swatch" type="button" style="background:${c[1]}" aria-label="${esc(c[0])}" aria-pressed="${c[0] === state.pick.color}" data-color="${esc(c[0])}"></button>`).join("");
  $("pdSizes").innerHTML = state.sizes[p.fit].map(s =>
    `<button class="size" type="button" aria-pressed="${s[0] === state.pick.size}" data-size="${s[0]}"><b>${s[0]}</b><span>อก ${s[1]}"</span></button>`).join("");
}

function setQty(n) {
  $("pdQty").value = Math.max(1, Math.min(20, n || 1));
}

function addToCart() {
  const k = state.pick;
  if (!k.size) {
    $("pdErr").textContent = "เลือกไซซ์ก่อนนะ";
    $("pdErr").hidden = false;
    return;
  }
  const qty = Math.max(1, Math.min(20, parseInt($("pdQty").value, 10) || 1));
  const same = state.cart.find(i => i.id === k.id && i.color === k.color && i.size === k.size);
  if (same) same.qty = Math.min(20, same.qty + qty);
  else state.cart.push({ id: k.id, color: k.color, size: k.size, qty });
  saveCart();
  $("pd").close();
  toast("ใส่ตะกร้าแล้ว: " + product(k.id).name + " " + k.color + " " + k.size);
  $("cartBtn").classList.remove("bump");
  void $("cartBtn").offsetWidth;
  $("cartBtn").classList.add("bump");
}

// ---------- ตะกร้า ----------

function saveCart() {
  state.cart = state.cart.filter(i => product(i.id));
  store("yuetdee.cart", state.cart);
  renderCart();
}

function totals() {
  const shop = state.shop;
  const sub = state.cart.reduce((s, i) => s + product(i.id).price * i.qty, 0);
  const ship = sub === 0 || sub >= shop.freeShippingAt ? 0 : shop.shipping;
  const cod = state.step === "checkout" && $("payCOD").checked ? shop.codFee : 0;
  return { sub, ship, cod, total: sub + ship + cod };
}

function renderCart() {
  const n = state.cart.reduce((s, i) => s + i.qty, 0);
  $("cartCount").textContent = n;
  $("empty").hidden = state.cart.length > 0;
  $("lines").innerHTML = state.cart.map((i, idx) => {
    const p = product(i.id);
    return `<li class="line">
      <div class="thumb">${shirtSVG(p.shape, colorHex(p, i.color), p.print)}</div>
      <div><div class="t">${esc(p.name)}</div><div class="v">${esc(i.color)} · ${i.size}</div>
        <button class="link" type="button" data-remove="${idx}">ลบ</button></div>
      <div class="r"><b>${baht(p.price * i.qty)}</b>
        <div class="qty"><button type="button" data-dec="${idx}" aria-label="ลด">−</button><span>${i.qty}</span><button type="button" data-inc="${idx}" aria-label="เพิ่ม">+</button></div>
      </div>
    </li>`;
  }).join("");

  const t = totals();
  const gap = state.shop.freeShippingAt - t.sub;
  $("shipBar").hidden = state.cart.length === 0;
  $("shipFill").style.width = Math.min(100, t.sub / state.shop.freeShippingAt * 100) + "%";
  $("shipText").textContent = gap > 0 ? "ซื้อเพิ่มอีก " + baht(gap) + " ส่งฟรี" : "ได้ส่งฟรีแล้ว";
  $("sSub").textContent = baht(t.sub);
  $("sShip").textContent = t.ship ? baht(t.ship) : "ฟรี";
  $("sCod").textContent = baht(t.cod);
  $("sCod").hidden = $("sCodLabel").hidden = !t.cod;
  $("sTotal").textContent = baht(t.total);
  if (state.step === "cart") $("nextBtn").disabled = state.cart.length === 0;
}

function setStep(step) {
  state.step = step;
  $("stepCart").hidden = step !== "cart";
  $("stepCheckout").hidden = step !== "checkout";
  $("stepDone").hidden = step !== "done";
  $("panelFoot").hidden = step === "done";
  $("backBtn").hidden = step !== "checkout";
  $("drawerTitle").textContent = { cart: "ตะกร้า", checkout: "ที่อยู่และการชำระเงิน", done: "สั่งซื้อสำเร็จ" }[step];
  $("nextBtn").textContent = step === "cart" ? "สั่งซื้อ" : "ยืนยันสั่งซื้อ";
  $("nextBtn").disabled = false;
  $("coErr").hidden = true;
  renderCart();
}

function openDrawer() {
  if (state.step === "done") setStep("cart");
  $("drawer").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeDrawer() {
  $("drawer").hidden = true;
  document.body.style.overflow = "";
}

async function placeOrder() {
  const body = {
    name: $("fName").value, phone: $("fPhone").value, address: $("fAddress").value,
    postcode: $("fPost").value, note: $("fNote").value,
    payment: $("payCOD").checked ? "cod" : "promptpay",
    items: state.cart,
  };
  store("yuetdee.addr", { name: body.name, phone: body.phone, address: body.address, postcode: body.postcode });
  $("nextBtn").disabled = true;
  $("nextBtn").textContent = "กำลังส่ง…";
  try {
    const res = await fetch("/api/orders", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "เชื่อมต่อร้านไม่ได้ ลองใหม่อีกครั้ง");
    showDone(data);
  } catch (e) {
    $("coErr").textContent = e.message;
    $("coErr").hidden = false;
    $("nextBtn").disabled = false;
    $("nextBtn").textContent = "ยืนยันสั่งซื้อ";
  }
}

function showDone(order) {
  const shop = state.shop;
  $("doneId").textContent = order.id;
  $("donePay").innerHTML = order.payment === "promptpay"
    ? `<div class="pp">
        <span class="muted">โอนพร้อมเพย์ ยอด <b>${baht(order.total)}</b></span>
        <span class="num">${esc(shop.promptpay)}</span>
        <span>ชื่อบัญชี ${esc(shop.promptpayName)}</span>
        <span class="muted small">โอนแล้วส่งสลิปพร้อมเลขออเดอร์ทาง LINE ${esc(shop.line)} ร้านจะส่งของภายใน 1–2 วันทำการ</span>
      </div>`
    : `<div class="pp"><span>เตรียมเงินสด <b>${baht(order.total)}</b> ไว้จ่ายตอนรับของ</span>
        <span class="muted small">ร้านจะส่งของภายใน 1–2 วันทำการ มีคำถามทัก LINE ${esc(shop.line)}</span></div>`;
  state.cart = [];
  saveCart();
  setStep("done");
}

// ---------- เริ่มต้น ----------

async function init() {
  if (location.protocol === "file:") {
    $("grid").innerHTML = '<p class="err">เปิดไฟล์ตรง ๆ ไม่ได้ ให้รัน <b>cd shirt-shop && python3 server.py</b> ในเทอร์มินัล แล้วเปิด http://localhost:8001</p>';
    return;
  }
  try {
    const res = await fetch("/api/products");
    const data = await res.json();
    if (!data.products) throw new Error();
    Object.assign(state, data);
  } catch (e) {
    $("grid").innerHTML = '<p class="err">โหลดสินค้าไม่ได้ ให้รัน <b>cd shirt-shop && python3 server.py</b> แล้วเปิดลิงก์ที่มันพิมพ์ออกมา (ไม่ใช่ Live Server หรือพอร์ตอื่น)</p>';
    return;
  }
  state.cart = store("yuetdee.cart") || [];
  const addr = store("yuetdee.addr");
  if (addr) {
    $("fName").value = addr.name || ""; $("fPhone").value = addr.phone || "";
    $("fAddress").value = addr.address || ""; $("fPost").value = addr.postcode || "";
  }
  $("freeShip").textContent = "ส่งฟรี";
  document.querySelector(".perks li span").textContent = "เมื่อซื้อครบ " + state.shop.freeShippingAt + " บาท";
  $("codFee").textContent = state.shop.codFee;
  $("footLine").textContent = state.shop.line;
  renderChips();
  renderGrid();
  saveCart();
}

$("chips").addEventListener("click", e => {
  const b = e.target.closest("[data-cat]");
  if (!b) return;
  state.cat = b.dataset.cat;
  renderChips();
  renderGrid();
});
$("grid").addEventListener("click", e => {
  const c = e.target.closest(".card");
  if (c) openProduct(c.dataset.id);
});
$("pdColors").addEventListener("click", e => {
  const b = e.target.closest("[data-color]");
  if (b) { state.pick.color = b.dataset.color; renderPick(); }
});
$("pdSizes").addEventListener("click", e => {
  const b = e.target.closest("[data-size]");
  if (b) { state.pick.size = b.dataset.size; $("pdErr").hidden = true; renderPick(); }
});
$("qMinus").addEventListener("click", () => setQty(+$("pdQty").value - 1));
$("qPlus").addEventListener("click", () => setQty(+$("pdQty").value + 1));
$("addBtn").addEventListener("click", addToCart);
$("pd").addEventListener("click", e => { if (e.target === $("pd")) $("pd").close(); });

$("cartBtn").addEventListener("click", openDrawer);
$("closeDrawer").addEventListener("click", closeDrawer);
$("scrim").addEventListener("click", closeDrawer);
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("drawer").hidden) closeDrawer(); });
$("lines").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  const i = +(b.dataset.inc ?? b.dataset.dec ?? b.dataset.remove);
  if ("remove" in b.dataset) state.cart.splice(i, 1);
  else if ("inc" in b.dataset) state.cart[i].qty = Math.min(20, state.cart[i].qty + 1);
  else if (state.cart[i].qty > 1) state.cart[i].qty -= 1;
  else state.cart.splice(i, 1);
  saveCart();
});
$("stepCheckout").addEventListener("change", renderCart);
$("stepCheckout").addEventListener("submit", e => { e.preventDefault(); placeOrder(); });
$("backBtn").addEventListener("click", () => setStep("cart"));
$("nextBtn").addEventListener("click", () => {
  if (state.step === "cart") setStep("checkout");
  else placeOrder();
});

init();
