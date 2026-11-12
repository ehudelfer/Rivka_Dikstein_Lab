import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import smtplib
import sqlite3
import tempfile
import time
from contextlib import contextmanager
from datetime import date
from email.message import EmailMessage
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from flask import Flask, abort, jsonify, redirect, render_template, render_template_string, request, session, url_for

GROUP_URL = "https://www.weizmann.ac.il/Biomolecular_Sciences/dikstein/group"
ADMIN_EMAIL = "ehud.elfer@weizmann.ac.il"
EMAIL_PATTERN = re.compile(r"^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(weizmann\.ac\.il|weizzman\.ac\.il)$")
FIELDS = ("insertDate", "memberName", "orderedItem", "productName", "serialNumber", "sortingGroup", "deliveryDate", "status")
STATUSES = ("Pending", "Ordered", "Delivered", "Cancelled")
GROUPS = ("Weizmann Warehouse", "External Supplier")
app = Flask(__name__, instance_relative_config=True)
production = os.environ.get("APP_ENV") == "production"
secret = os.environ.get("SECRET_KEY")
base_url = os.environ.get("BASE_URL", "http://127.0.0.1:5000").rstrip("/")
if production and (not secret or not os.environ.get("BASE_URL") or urlparse(base_url).scheme != "https"):
    raise RuntimeError("Production requires SECRET_KEY and an HTTPS BASE_URL.")
app.config.update(
    SECRET_KEY=secret or secrets.token_hex(32),
    DATA_DIR=os.environ.get("DATA_DIR", str(Path(__file__).resolve().parent / "instance")),
    BASE_URL=base_url,
    PRODUCTION=production,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=production,
    MAX_CONTENT_LENGTH=64 * 1024,
)


@contextmanager
def database():
    directory = Path(app.config["DATA_DIR"])
    directory.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(directory / "equipment_orders.sqlite3"), timeout=10)
    db.row_factory = sqlite3.Row
    try:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS approved_users (email TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS tokens (
                digest TEXT PRIMARY KEY, email TEXT NOT NULL, kind TEXT NOT NULL, expires INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, data TEXT NOT NULL);
        """)
        with db:
            yield db
    finally:
        db.close()


def csrf_token():
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(32)
    return session["csrf"]


@app.before_request
def protect_mutations():
    if request.method in ("POST", "PUT", "DELETE"):
        supplied = request.headers.get("X-CSRF-Token") or request.form.get("csrf", "")
        expected = session.get("csrf", "")
        if not expected or not hmac.compare_digest(supplied, expected):
            abort(403, "Invalid CSRF token.")


def parse_members(html):
    soup = BeautifulSoup(html, "html.parser")
    pi = soup.select_one(".pi-item .pi-title")
    team = soup.select(".current-group .current-team-item .team-title")
    if not pi or not team:
        raise ValueError("The group page does not contain the expected current team.")
    names = []
    for element in [pi, *team]:
        name = " ".join(element.get_text(" ", strip=True).split())
        if name and name not in names and name != "Other":
            names.append(name)
    if len(names) != len(team) + 1:
        raise ValueError("The group page contains missing or duplicate member names.")
    return names + ["Other"]


def get_lab_members(refresh=False):
    cache = Path(app.config["DATA_DIR"]) / "lab_members.json"
    if not refresh and cache.exists():
        with cache.open(encoding="utf-8") as file:
            names = json.load(file)
        if not isinstance(names, list) or not names or not all(isinstance(name, str) and name for name in names):
            raise ValueError("The member cache is invalid.")
        return [name for name in names if name != "Other"] + ["Other"]
    response = requests.get(GROUP_URL, timeout=(3, 5))
    response.raise_for_status()
    names = parse_members(response.text)
    cache.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=str(cache.parent), delete=False) as file:
            temporary = Path(file.name)
            json.dump(names, file, ensure_ascii=False, indent=2)
        temporary.replace(cache)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return names


def issue_token(email, kind):
    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode()).hexdigest()
    with database() as db:
        db.execute("DELETE FROM tokens WHERE expires < ?", (int(time.time()),))
        db.execute("INSERT INTO tokens VALUES (?, ?, ?, ?)", (digest, email, kind, int(time.time()) + 86400))
    return token


def deliver_email(recipient, subject, body):
    host = os.environ.get("SMTP_HOST")
    username = os.environ.get("SMTP_USERNAME")
    password = os.environ.get("SMTP_PASSWORD")
    sender = os.environ.get("SMTP_FROM")
    if not any((host, username, password, sender)):
        if app.config["PRODUCTION"]:
            raise RuntimeError("SMTP must be configured in production.")
        app.logger.warning("LOCAL EMAIL to %s: %s\n%s", recipient, subject, body)
        return "console"
    if not all((host, username, password, sender)):
        raise RuntimeError("SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD and SMTP_FROM are all required.")
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = sender
    message["To"] = recipient
    message.set_content(body)
    with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT", "587")), timeout=15) as smtp:
        smtp.starttls()
        smtp.login(username, password)
        smtp.send_message(message)
    return "email"


def authorized():
    email = session.get("email")
    if not email:
        return False
    with database() as db:
        return db.execute("SELECT 1 FROM approved_users WHERE email = ?", (email,)).fetchone() is not None


def require_authorized():
    if not authorized():
        abort(403, "Sign in with an approved email to make changes.")


@app.get("/")
def index():
    return render_template("index.html", csrf_token=csrf_token(), user=session.get("email") if authorized() else None)


@app.get("/api/members")
def members():
    try:
        return jsonify(members=get_lab_members(), warning=None)
    except (requests.RequestException, OSError, ValueError) as exc:
        app.logger.warning("Could not load lab members: %s", exc)
        return jsonify(members=["Prof. Rivka Dikstein", "Other"], warning="Member list unavailable. Please refresh it later.")


@app.post("/api/refresh-members")
def refresh_members():
    require_authorized()
    try:
        return jsonify(members=get_lab_members(refresh=True))
    except (requests.RequestException, OSError, ValueError) as exc:
        app.logger.warning("Could not refresh lab members: %s", exc)
        return jsonify(error="Could not refresh members; the existing list has not been changed."), 502


@app.post("/api/access")
def request_access():
    payload = request.get_json(silent=True)
    email = payload.get("email", "").strip().lower() if isinstance(payload, dict) and isinstance(payload.get("email"), str) else ""
    if len(email) > 254 or not EMAIL_PATTERN.fullmatch(email):
        return jsonify(error="Enter an eligible Weizmann email address. Other visitors have read-only access."), 400
    with database() as db:
        approved = db.execute("SELECT 1 FROM approved_users WHERE email = ?", (email,)).fetchone() is not None
    kind = "signin" if approved else "approve"
    token = issue_token(email, kind)
    link = app.config["BASE_URL"] + url_for("confirm_token", kind=kind, token=token)
    recipient = email if approved else ADMIN_EMAIL
    subject = "Equipment orders sign-in" if approved else "Equipment orders access request"
    body = f"{email} requested {'a sign-in link' if approved else 'access'}.\n\nOpen this link to confirm:\n{link}\n\nThe link expires in 24 hours."
    try:
        delivery = deliver_email(recipient, subject, body)
    except (OSError, smtplib.SMTPException, RuntimeError, ValueError):
        with database() as db:
            db.execute("DELETE FROM tokens WHERE digest = ?", (hashlib.sha256(token.encode()).hexdigest(),))
        app.logger.exception("Unable to send access email")
        return jsonify(error="Could not send the email. Please contact the administrator."), 503
    if delivery == "console":
        message = "Local test mode: the sign-in link is in the server console." if approved else "Local test mode: the approval link is in the server console; no email was sent."
    else:
        message = "Check your email for a sign-in link." if approved else "Your access request was sent to Ehud for approval."
    return jsonify(message=message)


@app.route("/<kind>/<token>", methods=["GET", "POST"])
def confirm_token(kind, token):
    if kind not in ("approve", "signin") or not re.fullmatch(r"[A-Za-z0-9_-]{43}", token):
        abort(404)
    digest = hashlib.sha256(token.encode()).hexdigest()
    with database() as db:
        entry = db.execute("SELECT email FROM tokens WHERE digest = ? AND kind = ? AND expires >= ?",
                           (digest, kind, int(time.time()))).fetchone()
        if not entry:
            return render_template_string("<h1>Link expired or already used</h1><p>Request a new link from the ordering site.</p>"), 400
        if request.method == "POST":
            deleted = db.execute("DELETE FROM tokens WHERE digest = ? AND expires >= ?", (digest, int(time.time())))
            if deleted.rowcount != 1:
                abort(400, "Link expired or already used.")
            if kind == "approve":
                db.execute("INSERT OR IGNORE INTO approved_users (email) VALUES (?)", (entry["email"],))
                return render_template_string("<h1>Access approved</h1><p>{{ email }} may now request a sign-in link.</p>", email=entry["email"])
            if not db.execute("SELECT 1 FROM approved_users WHERE email = ?", (entry["email"],)).fetchone():
                abort(403, "This account is not approved.")
            session.clear()
            session["email"] = entry["email"]
            return redirect(url_for("index"))
    return render_template_string("""<!doctype html><title>Confirm access</title>
        <h1>{{ action }}</h1><p>{{ email }}</p>
        <form method="post"><input type="hidden" name="csrf" value="{{ csrf }}">
        <button type="submit">{{ action }}</button></form>""",
        action="Approve access" if kind == "approve" else "Sign in", email=entry["email"], csrf=csrf_token())


@app.post("/api/signout")
def signout():
    session.clear()
    return jsonify(message="Signed out.")


def validate_order(data):
    if not isinstance(data, dict):
        raise ValueError("An order object is required.")
    result = {}
    for field in FIELDS:
        value = data.get(field, "")
        if not isinstance(value, str) or len(value) > 200:
            raise ValueError(f"{field} must be text of at most 200 characters.")
        result[field] = value.strip()
    for field in ("insertDate", "memberName", "orderedItem", "sortingGroup", "deliveryDate", "status"):
        if not result[field]:
            raise ValueError(f"{field} is required.")
    for field in ("insertDate", "deliveryDate"):
        try:
            date.fromisoformat(result[field])
        except ValueError:
            raise ValueError(f"{field} must be a valid YYYY-MM-DD date.")
    if result["sortingGroup"] not in GROUPS or result["status"] not in STATUSES:
        raise ValueError("Choose a valid sorting group and status.")
    return result


@app.route("/api/orders", methods=["GET", "POST"])
def orders():
    if request.method == "GET":
        with database() as db:
            rows = db.execute("SELECT id, data FROM orders ORDER BY rowid DESC").fetchall()
        return jsonify(orders=[dict(json.loads(row["data"]), id=row["id"]) for row in rows])
    require_authorized()
    try:
        data = validate_order(request.get_json(silent=True))
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    order_id = secrets.token_hex(16)
    with database() as db:
        db.execute("INSERT INTO orders VALUES (?, ?)", (order_id, json.dumps(data)))
    return jsonify(order=dict(data, id=order_id)), 201


@app.route("/api/orders/<order_id>", methods=["PUT", "DELETE"])
def modify_order(order_id):
    require_authorized()
    if request.method == "PUT":
        try:
            data = validate_order(request.get_json(silent=True))
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
    with database() as db:
        if request.method == "PUT":
            result = db.execute("UPDATE orders SET data = ? WHERE id = ?", (json.dumps(data), order_id))
        else:
            result = db.execute("DELETE FROM orders WHERE id = ?", (order_id,))
        if result.rowcount == 0:
            return jsonify(error="Order not found."), 404
    return jsonify(order=dict(data, id=order_id)) if request.method == "PUT" else jsonify(message="Order deleted.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    app.run(port=5000)
