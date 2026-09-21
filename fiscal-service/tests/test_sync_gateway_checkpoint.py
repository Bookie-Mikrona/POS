import json
import sqlite3
import io
import urllib.error
from unittest.mock import patch

import sync


class _Response:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode()
    def __enter__(self):
        return self
    def __exit__(self, *_):
        return False
    def read(self):
        return self.payload


def _db():
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.execute("CREATE TABLE sync_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)")
    db.execute("CREATE TABLE gateway_events(seq INTEGER,operation_id TEXT,event_type TEXT,payload_hash TEXT,payload_json TEXT,created_at TEXT)")
    payload = {"kind": "sale"}
    digest = __import__("hashlib").sha256(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()).hexdigest()
    db.execute("INSERT INTO gateway_events VALUES(?,?,?,?,?,?)", (2, "op-2", "sale", digest, json.dumps({"payload": payload}), "now"))
    db.execute("INSERT INTO sync_state VALUES('gateway_seq','1','now')")
    db.commit()
    return db


def test_gateway_409_blocks_then_status_resolution_sends_later_event_once():
    db = _db()
    config = {"sync": {"gatewayIngestPath": "/ingest", "gatewayStatusPath": "/status", "httpsBaseUrl": "https://cloud"},
              "device": {"id": "device"}}
    responses = [urllib.error.HTTPError("https://cloud/ingest", 409, "conflict", {}, io.BytesIO(
                    b'{"code":"NEEDS_REVIEW","reviewId":"r1","checkpoint":1}')),
                 _Response({"needsReview": True, "checkpoint": 1}),
                 _Response({"needsReview": False, "checkpoint": 1}),
                 _Response({"state": "accepted", "checkpoint": 2})]

    class Key:
        def sign(self, *_args, **_kwargs):
            return b"signature"

    with patch("sync.urllib.request.urlopen", side_effect=responses) as call:
        assert sync._sync_gateway_locked(db, config, Key()) == 1
        assert db.execute("SELECT value FROM sync_state WHERE key='gateway_status'").fetchone()[0] == "NEEDS_REVIEW"
        assert sync._sync_gateway_locked(db, config, Key()) == 0
        assert sync._sync_gateway_locked(db, config, Key()) == 1
        assert call.call_count == 4
        assert db.execute("SELECT value FROM sync_state WHERE key='gateway_seq'").fetchone()[0] == "2"