"""ยืดดี — เว็บขายเสื้อยืด

รันด้วย:  python3 server.py
แล้วเปิด  http://localhost:8001        (หน้าร้าน)
          http://localhost:8001/admin.html  (ดูออเดอร์)

ใช้แค่ไลบรารีมาตรฐานของ Python 3.8+ ไม่ต้องติดตั้งอะไรเพิ่ม
สินค้าอยู่ใน products.json  ออเดอร์เก็บใน orders.json
"""

import json
import os
import random
import re
import threading
import time
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
PRODUCTS_FILE = ROOT / "products.json"
ORDERS_FILE = ROOT / "orders.json"
PORT = int(os.environ.get("PORT", "8001"))
ADMIN_KEY = os.environ.get("ADMIN_KEY", "yuetdee")

PAYMENTS = {"promptpay": "โอนพร้อมเพย์", "cod": "เก็บเงินปลายทาง"}
STATUSES = ["รอชำระเงิน", "รอจัดส่ง", "จัดส่งแล้ว", "ยกเลิก"]
MAX_QTY = 20

lock = threading.Lock()


# ---------- storage ----------

def catalog():
    with PRODUCTS_FILE.open(encoding="utf-8") as f:
        return json.load(f)


def load_orders():
    if not ORDERS_FILE.exists():
        return []
    with ORDERS_FILE.open(encoding="utf-8") as f:
        return json.load(f)


def save_orders(orders):
    tmp = ORDERS_FILE.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(orders, f, ensure_ascii=False, indent=2)
    tmp.replace(ORDERS_FILE)


# ---------- validation ----------

class BadRequest(Exception):
    pass


def text(body, key, max_len, label, required=True):
    v = str(body.get(key) or "").strip()[:max_len]
    if required and not v:
        raise BadRequest("กรุณากรอก" + label)
    return v


def new_order(body, cat):
    """คิดราคาใหม่ฝั่งเซิร์ฟเวอร์ทั้งหมด ไม่เชื่อราคาที่ส่งมาจากเบราว์เซอร์"""
    shop = cat["shop"]
    products = {p["id"]: p for p in cat["products"]}
    items = []
    for raw in body.get("items") or []:
        p = products.get(raw.get("id"))
        if not p:
            raise BadRequest("มีสินค้าที่ไม่อยู่ในร้านแล้ว ลองลบออกจากตะกร้า")
        sizes = [s[0] for s in cat["sizes"][p["fit"]]]
        colors = [c[0] for c in p["colors"]]
        if raw.get("size") not in sizes or raw.get("color") not in colors:
            raise BadRequest("ไซซ์หรือสีของ " + p["name"] + " ไม่ถูกต้อง")
        try:
            qty = int(raw.get("qty"))
        except (TypeError, ValueError):
            raise BadRequest("จำนวนต้องเป็นตัวเลข")
        if not 1 <= qty <= MAX_QTY:
            raise BadRequest("สั่งได้ 1–%d ตัวต่อรายการ" % MAX_QTY)
        items.append({"id": p["id"], "name": p["name"], "color": raw["color"],
                      "size": raw["size"], "qty": qty, "price": p["price"]})
    if not items:
        raise BadRequest("ตะกร้ายังว่างอยู่")

    payment = body.get("payment")
    if payment not in PAYMENTS:
        raise BadRequest("เลือกวิธีชำระเงิน")
    phone = re.sub(r"\D", "", str(body.get("phone") or ""))
    if not re.fullmatch(r"0\d{8,9}", phone):
        raise BadRequest("เบอร์โทรไม่ถูกต้อง ใส่ 9–10 หลักขึ้นต้นด้วย 0")
    postcode = str(body.get("postcode") or "").strip()
    if not re.fullmatch(r"\d{5}", postcode):
        raise BadRequest("รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก")

    subtotal = sum(i["price"] * i["qty"] for i in items)
    shipping = 0 if subtotal >= shop["freeShippingAt"] else shop["shipping"]
    cod_fee = shop["codFee"] if payment == "cod" else 0
    now = datetime.now()
    return {
        "id": "YD%s-%04d" % (now.strftime("%y%m%d"), random.randint(0, 9999)),
        "createdAt": int(time.time()),
        "status": "รอชำระเงิน" if payment == "promptpay" else "รอจัดส่ง",
        "name": text(body, "name", 60, "ชื่อผู้รับ"),
        "phone": phone,
        "address": text(body, "address", 300, "ที่อยู่"),
        "postcode": postcode,
        "note": text(body, "note", 200, "", required=False),
        "payment": payment,
        "items": items,
        "subtotal": subtotal,
        "shipping": shipping,
        "codFee": cod_fee,
        "total": subtotal + shipping + cod_fee,
    }


# ---------- HTTP ----------

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC), **kwargs)

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 20000:
            raise BadRequest("ข้อมูลยาวเกินไป")
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            raise BadRequest("ข้อมูลไม่ใช่ JSON")

    def send_json(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def is_admin(self):
        return self.headers.get("X-Admin-Key", "") == ADMIN_KEY

    def route(self, method):
        path = self.path.split("?")[0].rstrip("/")
        try:
            if method == "GET" and path == "/api/products":
                return self.send_json(200, catalog())

            if method == "POST" and path == "/api/orders":
                with lock:
                    orders = load_orders()
                    order = new_order(self.body(), catalog())
                    orders.append(order)
                    save_orders(orders)
                return self.send_json(201, order)

            if path == "/api/orders" or path.startswith("/api/orders/"):
                if not self.is_admin():
                    return self.send_json(401, {"error": "รหัสแอดมินไม่ถูกต้อง"})
                if method == "GET" and path == "/api/orders":
                    with lock:
                        orders = load_orders()
                    return self.send_json(200, {"orders": orders[::-1], "statuses": STATUSES})
                m = re.fullmatch(r"/api/orders/(YD\d{6}-\d{4})", path)
                if method == "PATCH" and m:
                    status = self.body().get("status")
                    if status not in STATUSES:
                        raise BadRequest("สถานะไม่ถูกต้อง")
                    with lock:
                        orders = load_orders()
                        o = next((x for x in orders if x["id"] == m.group(1)), None)
                        if o is None:
                            return self.send_json(404, {"error": "ไม่พบออเดอร์นี้"})
                        o["status"] = status
                        save_orders(orders)
                    return self.send_json(200, o)

            self.send_json(404, {"error": "ไม่พบหน้านี้"})
        except BadRequest as e:
            self.send_json(400, {"error": str(e)})

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.route("GET")
        return super().do_GET()

    def do_POST(self):
        self.route("POST")

    def do_PATCH(self):
        self.route("PATCH")


if __name__ == "__main__":
    try:
        server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    except OSError:
        print("พอร์ต %d ถูกใช้อยู่ ลองพอร์ตอื่น:  PORT=8002 python3 server.py" % PORT, flush=True)
        raise SystemExit(1)
    print("ร้านยืดดี เปิดแล้ว → http://localhost:%d" % PORT, flush=True)
    print("ดูออเดอร์         → http://localhost:%d/admin.html  (รหัส: %s)" % (PORT, ADMIN_KEY), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nปิดร้านแล้ว", flush=True)
