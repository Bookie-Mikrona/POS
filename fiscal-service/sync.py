"""Deliver immutable furs-v2 LegalInvoiceCore to Bookie; no FURS transport exists here."""
from __future__ import annotations
import base64
import hashlib
import json
import secrets
import sqlite3
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding


def _signed_request(method: str, url: str, body: bytes, device_id: str, private_key):
    timestamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    nonce = base64.urlsafe_b64encode(secrets.token_bytes(18)).decode().rstrip("=")
    body_hash = hashlib.sha256(body).hexdigest()
    parsed = urlsplit(url)
    path = parsed.path + (("?" + parsed.query) if parsed.query else "")
    signature_input = "\n".join((method, path, timestamp, nonce, body_hash)).encode()
    signature = private_key.sign(signature_input, padding.PKCS1v15(), hashes.SHA256())
    return urllib.request.Request(url, data=body if method == "POST" else None, method=method, headers={
        "Content-Type": "application/json", "X-Bookie-Device-Id": device_id,
        "X-Bookie-Timestamp": timestamp, "X-Bookie-Nonce": nonce,
        "X-Bookie-Body-SHA256": body_hash,
        "X-Bookie-Signature": base64.b64encode(signature).decode(),
    })


def _gateway_event_batch(db, config: dict, limit: int = 200) -> tuple[bytes, int, int] | None:
    blocked = db.execute("SELECT value FROM sync_state WHERE key='gateway_status'").fetchone()
    if blocked and blocked["value"] == "NEEDS_REVIEW":
        return None
    checkpoint_row = db.execute(
        "SELECT value FROM sync_state WHERE key='gateway_seq'").fetchone()
    checkpoint = int(checkpoint_row["value"]) if checkpoint_row else 0
    rows = db.execute(
        "SELECT seq,operation_id,event_type,payload_hash,payload_json,created_at "
        "FROM gateway_events WHERE seq>? ORDER BY seq LIMIT ?", (checkpoint, limit)).fetchall()
    if not rows:
        return None
    events = []
    for row in rows:
        envelope = json.loads(row["payload_json"])
        events.append({
            "seq": row["seq"], "operationId": row["operation_id"],
            "eventType": row["event_type"], "payloadHash": row["payload_hash"],
            "payload": envelope.get("payload", envelope), "createdAt": row["created_at"],
        })
    body = json.dumps({
        "fromSeq": rows[0]["seq"], "toSeq": rows[-1]["seq"], "events": events,
    }, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return body, rows[0]["seq"], rows[-1]["seq"]


def _sync_gateway_locked(db, config: dict, private_key) -> int:
    # Bundles issued before the gateway event contract remain receipt-only.
    # This preserves their exact legacy sync behavior while new provisioning
    # bundles opt into the durable collaborative stream explicitly.
    if "gatewayIngestPath" not in config.get("sync", {}):
        return 0
    status_row = db.execute("SELECT value FROM sync_state WHERE key='gateway_status'").fetchone()
    base = config["sync"]["httpsBaseUrl"].rstrip("/")
    status_path = config["sync"].get("gatewayStatusPath", "/api/offline-fiscal/sync/gateway-events/status")
    if status_row and status_row["value"] == "NEEDS_REVIEW":
        try:
            with urllib.request.urlopen(_signed_request("GET", base + status_path, b"", config["device"]["id"], private_key), timeout=20) as response:
                status = json.loads(response.read() or b"{}")
            if status.get("needsReview"):
                return 0
            if isinstance(status.get("checkpoint"), int):
                db.execute(
                    "INSERT INTO sync_state(key,value,updated_at) VALUES('gateway_seq',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
                    (str(status["checkpoint"]), datetime.now(timezone.utc).isoformat()))
            db.execute("INSERT OR REPLACE INTO sync_state(key,value,updated_at) VALUES('gateway_status','OK',?)",
                       (datetime.now(timezone.utc).isoformat(),))
        except Exception:
            return 0
    batch = _gateway_event_batch(db, config)
    if not batch:
        return 0
    body, from_seq, to_seq = batch
    base = config["sync"]["httpsBaseUrl"].rstrip("/")
    path = config["sync"].get("gatewayIngestPath", "/api/offline-fiscal/sync/gateway-events/ingest")
    request = _signed_request("POST", base + path, body, config["device"]["id"], private_key)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.loads(response.read() or b"{}")
        if result.get("state") == "accepted" and isinstance(result.get("checkpoint"), int):
            db.execute(
                "INSERT INTO sync_state(key,value,updated_at) VALUES('gateway_seq',?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
                (str(result["checkpoint"]), datetime.now(timezone.utc).isoformat()))
            db.execute(
                "INSERT INTO sync_state(key,value,updated_at) VALUES('gateway_status','OK',?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
                (datetime.now(timezone.utc).isoformat(),))
        else:
            db.execute(
                "INSERT OR REPLACE INTO sync_state(key,value,updated_at) VALUES('gateway_status','NEEDS_REVIEW',?)",
                (datetime.now(timezone.utc).isoformat(),))
    except urllib.error.HTTPError as exc:
        details = {}
        try:
            details = json.loads(exc.read() or b"{}")
        except Exception:
            pass
        if details.get("code") == "NEEDS_REVIEW":
            db.execute(
                "INSERT OR REPLACE INTO sync_state(key,value,updated_at) VALUES('gateway_review',?,?)",
                (json.dumps(details, separators=(",", ":")), datetime.now(timezone.utc).isoformat()))
        db.execute(
            "INSERT OR REPLACE INTO sync_state(key,value,updated_at) VALUES('gateway_status',?,?)",
            ("NEEDS_REVIEW" if 400 <= exc.code < 500 else "PENDING",
             datetime.now(timezone.utc).isoformat()))
    except Exception:
        db.execute(
            "INSERT OR REPLACE INTO sync_state(key,value,updated_at) VALUES('gateway_status','PENDING',?)",
            (datetime.now(timezone.utc).isoformat(),))
    return len(json.loads(body)["events"])


def _next_attempt(attempts: int) -> str:
    """Bounded exponential backoff keeps the durable worker active without hot-looping."""
    seconds = min(300, 2 ** min(attempts + 1, 8))
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def _transition(db, job, state: str, error: str | None, response=None) -> None:
    db.execute(
        "UPDATE jobs SET state=?,attempts=attempts+1,next_attempt=?,last_error=? WHERE id=?",
        (state, _next_attempt(job["attempts"]), error, job["id"]),
    )
    db.execute(
        "UPDATE receipts SET state=?,server_response=COALESCE(?,server_response) WHERE operation_id=?",
        (state, json.dumps(response, separators=(",", ":")) if response is not None else None,
         job["operation_id"]),
    )


def sync_once(store, unprotect) -> int:
    """Process due durable jobs using the installed bundle and DPAPI key.

    Returns the number of jobs examined. The caller owns periodic/wakeup policy.
    """
    with store.lock:
        bundle_raw = store.get("provisioning_bundle")
        key_blob = store.get("device_rsa_private_key")
        if not bundle_raw or not key_blob:
            return 0
        config = json.loads(bundle_raw)
        private_key = serialization.load_pem_private_key(unprotect(key_blob), password=None)
    db = sqlite3.connect(store.path, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=10000")
    try:
        return _sync_locked(db, config, private_key)
    finally:
        db.close()


def _sync_locked(db, config: dict, private_key) -> int:
    base = config["sync"]["httpsBaseUrl"].rstrip("/")
    if not base.startswith("https://"):
        raise ValueError("Provisioned sync base URL must use HTTPS")
    device_id = config["device"]["id"]
    jobs = db.execute("""SELECT j.*,r.envelope_json FROM jobs j JOIN receipts r ON r.operation_id=j.operation_id
                         WHERE j.state='PENDING' AND j.next_attempt<=?
                         ORDER BY j.next_attempt""", (datetime.now(timezone.utc).isoformat(),)).fetchall()
    for job in jobs:
        if not job["envelope_json"]:
            _transition(db, job, "NEEDS_REVIEW", "SEALED_ENVELOPE_MISSING")
            continue
        # The Bookie idempotency boundary is the exact device-signed legal core.
        body = json.dumps(json.loads(job["envelope_json"])["canonicalPayload"],
                          sort_keys=True, separators=(",", ":")).encode()
        request = _signed_request("POST", base + config["sync"]["ingestPath"], body, device_id, private_key)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                result = json.loads(response.read() or b"{}")
            delivery_state = result.get("deliveryState")
            if (
                delivery_state == "DELIVERED"
                and result.get("fursState") == "confirmed"
                and result.get("businessFinalized") is True
            ):
                _transition(db, job, "BOOKIE_DELIVERED", None, result)
            elif delivery_state == "NEEDS_REVIEW":
                _transition(db, job, "NEEDS_REVIEW", result.get("error") or "BOOKIE_NEEDS_REVIEW", result)
            else:
                _transition(db, job, "PENDING", result.get("error") or "BOOKIE_ACCEPTED_PENDING", result)
        except urllib.error.HTTPError as exc:
            if 400 <= exc.code < 500 and exc.code not in (408, 429):
                state = "NEEDS_REVIEW"
            else:
                state = "PENDING"
            _transition(db, job, state, f"HTTP {exc.code}")
        except Exception as exc:
            # Bookie ingest is idempotent on the sealed core; retry those same bytes.
            _transition(db, job, "PENDING", str(exc)[:500])
    # Collaborative events use their own durable checkpoint.  Receipt
    # envelopes remain the authoritative fiscal ingest boundary.
    _sync_gateway_locked(db, config, private_key)
    return len(jobs)