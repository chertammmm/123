"""ก๊วนขาดขา — เว็บนัดเพื่อนตีแบด

รันด้วย:  python3 server.py
แล้วเปิด  http://localhost:8000

ใช้แค่ไลบรารีมาตรฐานของ Python 3.8+ ไม่ต้องติดตั้งอะไรเพิ่ม
ข้อมูลเก็บในไฟล์ data.json ข้าง ๆ ไฟล์นี้
"""

import json
import os
import re
import threading
import time
import uuid
from datetime import date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
DATA_FILE = ROOT / "data.json"
PORT = int(os.environ.get("PORT", "8000"))

LEVELS = ["BG", "N", "S", "P-", "P", "P+"]
MODES = ["คู่", "เดี่ยว", "คละ"]
MAX_SESSIONS = 500

lock = threading.Lock()


# ---------- storage ----------

def load():
    if not DATA_FILE.exists():
        return {"sessions": []}
    with DATA_FILE.open(encoding="utf-8") as f:
        return json.load(f)


def save(data):
    tmp = DATA_FILE.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(DATA_FILE)


def prune(data):
    """ลบก๊วนที่ผ่านไปแล้วเกิน 1 วัน"""
    today = date.today().isoformat()
    data["sessions"] = [s for s in data["sessions"] if s["date"] >= today]


# ---------- validation ----------

class BadRequest(Exception):
    pass


def text(body, key, max_len, required=False):
    v = str(body.get(key) or "").strip()[:max_len]
    if required and not v:
        raise BadRequest("กรุณากรอก " + key)
    return v


def integer(body, key, lo, hi, default=0):
    try:
        v = int(body.get(key, default))
    except (TypeError, ValueError):
        raise BadRequest(key + " ต้องเป็นตัวเลข")
    return max(lo, min(hi, v))


def valid_date(v):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v or ""):
        raise BadRequest("รูปแบบวันที่ไม่ถูกต้อง")
    if v < date.today().isoformat():
        raise BadRequest("เลือกวันที่วันนี้หรือหลังจากนี้")
    return v


def valid_time(v):
    if not re.fullmatch(r"\d{2}:\d{2}", v or ""):
        raise BadRequest("รูปแบบเวลาไม่ถูกต้อง")
    return v


def new_session(body, player_id):
    level_min = integer(body, "levelMin", 0, len(LEVELS) - 1)
    level_max = integer(body, "levelMax", 0, len(LEVELS) - 1)
    if level_min > level_max:
        raise BadRequest("มือต่ำสุดต้องไม่สูงกว่ามือสูงสุด")
    mode = body.get("mode")
    return {
        "id": uuid.uuid4().hex[:12],
        "venue": text(body, "venue", 60, required=True),
        "area": text(body, "area", 40),
        "date": valid_date(body.get("date")),
        "start": valid_time(body.get("start")),
        "end": valid_time(body.get("end")),
        "levelMin": level_min,
        "levelMax": level_max,
        "mode": mode if mode in MODES else "คู่",
        "need": integer(body, "need", 1, 20, 2),
        "courtFee": integer(body, "courtFee", 0, 10000),
        "shuttleFee": integer(body, "shuttleFee", 0, 10000),
        "contact": text(body, "contact", 40),
        "note": text(body, "note", 240),
        "hostNick": text(body, "hostNick", 24, required=True),
        "hostId": player_id,
        "players": [],
        "createdAt": int(time.time()),
    }


def public_view(s, player_id):
    """ข้อมูลที่ส่งให้หน้าเว็บ: ซ่อน id ของผู้เล่น และโชว์ LINE เฉพาะคนตั้งกับคนที่จอยแล้ว"""
    is_host = s["hostId"] == player_id
    joined = any(p["id"] == player_id for p in s["players"])
    out = {k: v for k, v in s.items() if k not in ("hostId", "players", "contact")}
    out["isHost"] = is_host
    out["joined"] = joined
    out["contact"] = s["contact"] if (is_host or joined) else ""
    out["players"] = [
        {"nick": p["nick"], "level": p["level"], "isMe": p["id"] == player_id}
        for p in s["players"]
    ]
    return out


# ---------- HTTP ----------

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC), **kwargs)

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    # helpers
    def player_id(self):
        pid = self.headers.get("X-Player-Id", "")
        if not re.fullmatch(r"[A-Za-z0-9-]{8,64}", pid):
            raise BadRequest("ไม่พบรหัสผู้เล่น ลองรีเฟรชหน้าเว็บ")
        return pid

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 10000:
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

    def route(self, method):
        m = re.fullmatch(r"/api/sessions(?:/([a-f0-9]{12})(/join)?)?/?", self.path.split("?")[0])
        if not m:
            return self.send_json(404, {"error": "ไม่พบหน้านี้"})
        sid, join = m.group(1), m.group(2)
        try:
            pid = self.player_id()
            with lock:
                data = load()
                prune(data)
                result = self.handle_api(method, data, sid, join, pid)
            self.send_json(*result)
        except BadRequest as e:
            self.send_json(400, {"error": str(e)})

    def handle_api(self, method, data, sid, join, pid):
        sessions = data["sessions"]

        if method == "GET" and not sid:
            sessions.sort(key=lambda s: (s["date"], s["start"]))
            return 200, {"sessions": [public_view(s, pid) for s in sessions]}

        if method == "POST" and not sid:
            if len(sessions) >= MAX_SESSIONS:
                raise BadRequest("บอร์ดเต็มแล้ว รอให้ก๊วนเก่าหมดเวลาก่อน")
            s = new_session(self.body(), pid)
            sessions.append(s)
            save(data)
            return 201, public_view(s, pid)

        s = next((x for x in sessions if x["id"] == sid), None)
        if s is None:
            return 404, {"error": "ไม่พบก๊วนนี้ อาจถูกลบไปแล้ว"}

        if method == "DELETE" and not join:
            if s["hostId"] != pid:
                return 403, {"error": "ลบได้เฉพาะคนตั้งก๊วน"}
            sessions.remove(s)
            save(data)
            return 200, {"ok": True}

        if method == "POST" and join:
            if s["hostId"] == pid:
                raise BadRequest("คุณเป็นคนตั้งก๊วนนี้อยู่แล้ว")
            if any(p["id"] == pid for p in s["players"]):
                raise BadRequest("คุณจอยก๊วนนี้แล้ว")
            if len(s["players"]) >= s["need"]:
                raise BadRequest("ก๊วนนี้เต็มแล้ว")
            body = self.body()
            s["players"].append({
                "id": pid,
                "nick": text(body, "nick", 24, required=True),
                "level": integer(body, "level", 0, len(LEVELS) - 1),
                "at": int(time.time()),
            })
            save(data)
            return 200, public_view(s, pid)

        if method == "DELETE" and join:
            s["players"] = [p for p in s["players"] if p["id"] != pid]
            save(data)
            return 200, public_view(s, pid)

        return 405, {"error": "ไม่รองรับคำสั่งนี้"}

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.route("GET")
        return super().do_GET()

    def do_POST(self):
        self.route("POST")

    def do_DELETE(self):
        self.route("DELETE")


if __name__ == "__main__":
    try:
        server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    except OSError:
        print("พอร์ต %d ถูกใช้อยู่ ลองพอร์ตอื่น:  PORT=8080 python3 server.py" % PORT)
        raise SystemExit(1)
    print("ก๊วนขาดขา พร้อมแล้ว → http://localhost:%d" % PORT)
    print("เพื่อนที่อยู่ Wi-Fi เดียวกันเข้าได้ทาง http://<IP เครื่องนี้>:%d" % PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nปิดเซิร์ฟเวอร์แล้ว")
