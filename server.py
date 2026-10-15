"""เว็บหาเพื่อนตีแบต — เซิร์ฟเวอร์ Python ล้วน ไม่ต้องติดตั้งอะไรเพิ่ม

รัน:  python3 server.py   แล้วเปิด http://localhost:8000
"""

import hashlib
import json
import os
import re
import secrets
import threading
import time
from datetime import date, datetime
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(ROOT, "static")
DATA_FILE = os.path.join(ROOT, "data.json")
PORT = int(os.environ.get("PORT", "8000"))

LEVELS = ["มือใหม่", "เริ่มต้น", "กลาง", "เก่ง", "ทุกระดับ"]
PLAYER_LEVELS = LEVELS[:-1]  # "ทุกระดับ" ใช้กับก๊วนเท่านั้น
DAYS = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"]
AVATARS = ["🏸", "🦅", "🐯", "🐼", "🦊", "🐱", "🐶", "🐸", "🦄", "🔥", "⚡", "🌟"]

MAX_BODY = 16 * 1024
SESSION_AGE = 30 * 24 * 3600
PBKDF2_ROUNDS = 200_000
LOGIN_LIMIT, LOGIN_WINDOW = 5, 600  # ล็อกอินผิดได้ 5 ครั้งใน 10 นาที

lock = threading.Lock()
login_failures = {}  # ip -> [timestamps]


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


# ---------- storage ----------
def load_db():
    try:
        with open(DATA_FILE, encoding="utf-8") as f:
            db = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        db = {}
    db.setdefault("users", [])
    db.setdefault("sessions", {})
    db.setdefault("posts", [])
    return db


def save_db(db):
    now = time.time()
    today = date.today().isoformat()
    # ล้างของหมดอายุทุกครั้งที่เขียน ไฟล์จะได้ไม่โตเรื่อยๆ
    db["sessions"] = {t: s for t, s in db["sessions"].items() if s["expires"] > now}
    db["posts"] = [p for p in db["posts"] if p["date"] >= today]
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DATA_FILE)


# ---------- validation ----------
def text(data, field, label, max_len, required=True):
    value = str(data.get(field) or "").strip()
    if required and not value:
        raise ApiError(400, f"กรุณากรอก{label}")
    if len(value) > max_len:
        raise ApiError(400, f"{label}ยาวเกิน {max_len} ตัวอักษร")
    return value


def number(data, field, label, lo, hi, default=None):
    raw = data.get(field)
    if raw in (None, "") and default is not None:
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ApiError(400, f"{label}ไม่ถูกต้อง")
    if not lo <= value <= hi:
        raise ApiError(400, f"{label}ต้องอยู่ระหว่าง {lo}–{hi}")
    return value


def validate_profile(data):
    profile = {
        "displayName": text(data, "displayName", "ชื่อที่แสดง", 40),
        "avatar": text(data, "avatar", "อวตาร", 8, required=False) or AVATARS[0],
        "level": text(data, "level", "ระดับฝีมือ", 20),
        "area": text(data, "area", "ย่านที่สะดวก", 60, required=False),
        "contact": text(data, "contact", "ช่องทางติดต่อ", 80, required=False),
        "times": text(data, "times", "ช่วงเวลาที่สะดวก", 60, required=False),
        "bio": text(data, "bio", "แนะนำตัว", 300, required=False),
        "lookingForPartner": bool(data.get("lookingForPartner")),
    }
    if profile["avatar"] not in AVATARS:
        raise ApiError(400, "อวตารไม่ถูกต้อง")
    if profile["level"] not in PLAYER_LEVELS:
        raise ApiError(400, "ระดับฝีมือไม่ถูกต้อง")
    days = data.get("days") or []
    if not isinstance(days, list) or any(d not in DAYS for d in days):
        raise ApiError(400, "วันที่สะดวกไม่ถูกต้อง")
    profile["days"] = [d for d in DAYS if d in days]
    return profile


def validate_post(data):
    post = {
        "title": text(data, "title", "ชื่อนัด", 60, required=False),
        "court": text(data, "court", "ชื่อสนาม", 80),
        "area": text(data, "area", "ย่าน", 60, required=False),
        "date": text(data, "date", "วันที่", 10),
        "time": text(data, "time", "เวลาเริ่ม", 5),
        "endTime": text(data, "endTime", "เวลาจบ", 5, required=False),
        "level": text(data, "level", "ระดับฝีมือ", 20),
        "note": text(data, "note", "หมายเหตุ", 300, required=False),
        "need": number(data, "need", "จำนวนคนที่ขาด", 1, 20),
        "cost": number(data, "cost", "ค่าใช้จ่ายต่อคน", 0, 10000, default=0),
    }
    try:
        play_day = datetime.strptime(post["date"], "%Y-%m-%d").date()
    except ValueError:
        raise ApiError(400, "รูปแบบวันที่ไม่ถูกต้อง")
    if play_day < date.today():
        raise ApiError(400, "วันที่ต้องไม่ย้อนหลัง")
    for f in ("time", "endTime"):
        if post[f] and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", post[f]):
            raise ApiError(400, "รูปแบบเวลาไม่ถูกต้อง")
    if post["level"] not in LEVELS:
        raise ApiError(400, "ระดับฝีมือไม่ถูกต้อง")
    return post


# ---------- auth ----------
def hash_password(password, salt):
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ROUNDS
    ).hex()


def check_login_limit(ip):
    now = time.time()
    recent = [t for t in login_failures.get(ip, []) if now - t < LOGIN_WINDOW]
    login_failures[ip] = recent
    if len(recent) >= LOGIN_LIMIT:
        raise ApiError(429, "ล็อกอินผิดหลายครั้งเกินไป ลองใหม่อีก 10 นาที")


# ---------- shaping output ----------
def find_user(db, user_id=None, username=None):
    for u in db["users"]:
        if u["id"] == user_id or (username and u["username"] == username.lower()):
            return u
    return None


def user_card(u):
    """ข้อมูลย่อของผู้ใช้ ใช้แสดงในการ์ดก๊วน"""
    return {
        "username": u["username"],
        "displayName": u["displayName"],
        "avatar": u["avatar"],
        "level": u["level"],
    }


def public_user(u, viewer):
    """จุดเดียวที่แปลงข้อมูลผู้ใช้ก่อนส่งออก — ห้ามส่ง hash/salt ออกไป
    ช่องทางติดต่อเห็นเฉพาะคนที่ล็อกอินแล้ว"""
    out = user_card(u)
    for f in ("area", "times", "bio", "days", "lookingForPartner", "createdAt"):
        out[f] = u[f]
    if viewer:
        out["contact"] = u["contact"]
    return out


def public_post(db, post, viewer):
    host = find_user(db, post["hostId"])
    players = [find_user(db, pid) for pid in post["players"]]
    out = {k: v for k, v in post.items() if k not in ("hostId", "players")}
    out["host"] = user_card(host) if host else None
    if host and viewer:
        out["host"]["contact"] = host["contact"]
    out["players"] = [user_card(p) for p in players if p]
    out["spotsLeft"] = post["need"] - len(post["players"])
    if viewer:
        out["isHost"] = post["hostId"] == viewer["id"]
        out["joined"] = viewer["id"] in post["players"]
    return out


def upcoming(db):
    today = date.today().isoformat()
    posts = [p for p in db["posts"] if p["date"] >= today]
    return sorted(posts, key=lambda p: (p["date"], p["time"]))


# ---------- HTTP ----------
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def send_json(self, status, payload, cookie=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            raise ApiError(415, "ต้องส่งข้อมูลเป็น JSON")
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ApiError(413, "ข้อมูลใหญ่เกินไป")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError(400, "ข้อมูลไม่ถูกต้อง")
        if not isinstance(data, dict):
            raise ApiError(400, "ข้อมูลไม่ถูกต้อง")
        return data

    def session_token(self):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        return cookie["sid"].value if "sid" in cookie else None

    def current_user(self, db):
        session = db["sessions"].get(self.session_token() or "")
        if not session or session["expires"] < time.time():
            return None
        return find_user(db, session["userId"])

    def require_user(self, db):
        user = self.current_user(db)
        if not user:
            raise ApiError(401, "กรุณาเข้าสู่ระบบก่อน")
        return user

    def start_session(self, db, user):
        token = secrets.token_urlsafe(32)
        db["sessions"][token] = {"userId": user["id"], "expires": time.time() + SESSION_AGE}
        return f"sid={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_AGE}"

    def do_GET(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/"):
            return super().do_GET()
        try:
            with lock:
                db = load_db()
                viewer = self.current_user(db)
                if path == "/api/me":
                    me = public_user(viewer, viewer) if viewer else None
                    return self.send_json(200, {
                        "me": me, "levels": LEVELS, "playerLevels": PLAYER_LEVELS,
                        "days": DAYS, "avatars": AVATARS,
                    })
                if path == "/api/posts":
                    posts = [public_post(db, p, viewer) for p in upcoming(db)]
                    return self.send_json(200, {"posts": posts})
                if path == "/api/players":
                    users = sorted(
                        db["users"],
                        key=lambda u: (not u["lookingForPartner"], -u["createdAt"]),
                    )
                    return self.send_json(200, {"players": [public_user(u, viewer) for u in users]})
                m = re.fullmatch(r"/api/players/([^/]+)", path)
                if m:
                    user = find_user(db, username=unquote(m.group(1)))
                    if not user:
                        raise ApiError(404, "ไม่พบผู้เล่นคนนี้")
                    posts = [
                        public_post(db, p, viewer) for p in upcoming(db)
                        if p["hostId"] == user["id"] or user["id"] in p["players"]
                    ]
                    return self.send_json(200, {"player": public_user(user, viewer), "posts": posts})
            raise ApiError(404, "ไม่พบหน้านี้")
        except ApiError as e:
            return self.send_json(e.status, {"error": str(e)})

    def do_POST(self):
        path = urlparse(self.path).path
        routes = {
            "/api/register": self.register,
            "/api/login": self.login,
            "/api/logout": self.logout,
            "/api/me": self.update_me,
            "/api/posts": self.create_post,
        }
        try:
            data = self.read_json()
            if path in routes:
                return routes[path](data)
            m = re.fullmatch(r"/api/posts/([\w-]+)/(join|leave|delete)", path)
            if m:
                return self.post_action(m.group(1), m.group(2))
            raise ApiError(404, "ไม่พบหน้านี้")
        except ApiError as e:
            return self.send_json(e.status, {"error": str(e)})

    # ---------- account ----------
    def register(self, data):
        username = text(data, "username", "ชื่อผู้ใช้", 20).lower()
        if not re.fullmatch(r"[a-z0-9_]{3,20}", username):
            raise ApiError(400, "ชื่อผู้ใช้ต้องเป็น a-z, 0-9 หรือ _ ยาว 3–20 ตัว")
        password = str(data.get("password") or "")
        if not 6 <= len(password) <= 128:
            raise ApiError(400, "รหัสผ่านต้องยาว 6 ตัวขึ้นไป")
        profile = validate_profile(data)
        salt = secrets.token_hex(16)
        pw_hash = hash_password(password, salt)  # คำนวณนอก lock เพราะช้า
        with lock:
            db = load_db()
            if find_user(db, username=username):
                raise ApiError(409, "ชื่อผู้ใช้นี้มีคนใช้แล้ว")
            user = {
                "id": secrets.token_urlsafe(8),
                "username": username,
                "pwSalt": salt,
                "pwHash": pw_hash,
                "createdAt": int(time.time()),
                **profile,
            }
            db["users"].append(user)
            cookie = self.start_session(db, user)
            save_db(db)
        return self.send_json(201, {"me": public_user(user, user)}, cookie)

    def login(self, data):
        ip = self.client_address[0]
        check_login_limit(ip)
        username = str(data.get("username") or "").strip().lower()
        password = str(data.get("password") or "")
        with lock:
            user = find_user(load_db(), username=username) if username else None
        ok = user and secrets.compare_digest(hash_password(password, user["pwSalt"]), user["pwHash"])
        if not ok:
            login_failures.setdefault(ip, []).append(time.time())
            raise ApiError(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")
        login_failures.pop(ip, None)
        with lock:
            db = load_db()
            cookie = self.start_session(db, user)
            save_db(db)
        return self.send_json(200, {"me": public_user(user, user)}, cookie)

    def logout(self, data):
        with lock:
            db = load_db()
            if db["sessions"].pop(self.session_token() or "", None):
                save_db(db)
        return self.send_json(200, {"ok": True}, "sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")

    def update_me(self, data):
        profile = validate_profile(data)
        with lock:
            db = load_db()
            user = self.require_user(db)
            user.update(profile)
            save_db(db)
        return self.send_json(200, {"me": public_user(user, user)})

    # ---------- posts ----------
    def create_post(self, data):
        post = validate_post(data)
        with lock:
            db = load_db()
            user = self.require_user(db)
            post.update(
                id=secrets.token_urlsafe(6),
                hostId=user["id"],
                players=[],
                createdAt=int(time.time()),
            )
            db["posts"].append(post)
            save_db(db)
            return self.send_json(201, {"post": public_post(db, post, user)})

    def post_action(self, post_id, action):
        with lock:
            db = load_db()
            user = self.require_user(db)
            post = next((p for p in db["posts"] if p["id"] == post_id), None)
            if not post:
                raise ApiError(404, "ไม่พบก๊วนนี้ (อาจถูกลบไปแล้ว)")
            if action == "join":
                if post["hostId"] == user["id"]:
                    raise ApiError(409, "คุณเป็นเจ้าของก๊วนนี้อยู่แล้ว")
                if user["id"] in post["players"]:
                    raise ApiError(409, "คุณลงชื่อไว้แล้ว")
                if len(post["players"]) >= post["need"]:
                    raise ApiError(409, "ก๊วนนี้เต็มแล้ว")
                post["players"].append(user["id"])
            elif action == "leave":
                if user["id"] not in post["players"]:
                    raise ApiError(409, "คุณไม่ได้อยู่ในก๊วนนี้")
                post["players"].remove(user["id"])
            elif action == "delete":
                if post["hostId"] != user["id"]:
                    raise ApiError(403, "ลบได้เฉพาะเจ้าของก๊วน")
                db["posts"].remove(post)
                save_db(db)
                return self.send_json(200, {"ok": True})
            save_db(db)
            return self.send_json(200, {"post": public_post(db, post, user)})


if __name__ == "__main__":
    print(f"🏸 เปิดเว็บที่ http://localhost:{PORT}")
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
