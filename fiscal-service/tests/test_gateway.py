import base64
import hashlib
import hmac
import json
import os
import tempfile
import time
import uuid
import sys
from pathlib import Path

import pytest

os.environ["BOOKIE_FISCAL_ALLOW_INSECURE_DEV"] = "1"
os.environ["BOOKIE_FISCAL_ALLOW_NONWINDOWS_ADMIN"] = "1"
os.environ["BOOKIE_FISCAL_MOCK_PRINTER"] = "1"
sys.path.insert(0, str(Path(__file__).parents[1]))

from fiscal_service import (  # noqa: E402
    DPAPI, Gateway, GatewayCommandIn, Store, authenticate_gateway_request,
)
import fiscal_service as fiscal_module  # noqa: E402
from test_core import make_fiscal, request  # noqa: E402


def new_store():
    return Store(Path(tempfile.mktemp()))


def add_client(store: Store):
    client_id, secret = str(uuid.uuid4()), os.urandom(32)
    store.db.execute(
        "INSERT INTO clients(client_id,name,secret_blob,active,created_at) VALUES(?,?,?,?,?)",
        (client_id, "Test POS", DPAPI.protect(secret), 1, "2025-01-01T00:00:00Z"),
    )
    return client_id, secret


def signed(store, client_id, secret, nonce=None, timestamp=None, body=b"{}"):
    timestamp = str(timestamp if timestamp is not None else int(time.time()))
    nonce = nonce or base64.urlsafe_b64encode(os.urandom(18)).decode().rstrip("=")
    path = "/v1/gateway/events?after=0"
    digest = hashlib.sha256(body).hexdigest()
    text = f"GET\n{path}\n{timestamp}\n{nonce}\n{digest}".encode()
    signature = hmac.new(secret, text, hashlib.sha256).hexdigest()
    return authenticate_gateway_request(
        store, "GET", path, timestamp, nonce, body, client_id,
        base64.urlsafe_b64encode(secret).decode(), signature,
    )


def test_gateway_schema_migration_restart_preserves_data():
    path = Path(tempfile.mktemp())
    store = new_store()
    store = Store(path)
    store.db.execute("INSERT INTO sync_state(key,value,updated_at) VALUES('x','1','now')")
    store.db.close()
    restarted = Store(path)
    names = {row[0] for row in restarted.db.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert {"clients", "gateway_events", "entity_versions", "order_projections",
            "table_projections", "kds_jobs", "print_jobs", "sync_state"} <= names
    assert restarted.db.execute("SELECT value FROM sync_state WHERE key='x'").fetchone()[0] == "1"


def test_hmac_valid_skew_replay_and_revoke():
    store = new_store()
    client_id, secret = add_client(store)
    assert signed(store, client_id, secret) == client_id
    with pytest.raises(Exception):
        signed(store, client_id, secret, nonce=base64.urlsafe_b64encode(os.urandom(18)).decode(),
               timestamp=int(time.time()) - 301)
    nonce = base64.urlsafe_b64encode(os.urandom(18)).decode().rstrip("=")
    signed(store, client_id, secret, nonce=nonce)
    with pytest.raises(Exception):
        signed(store, client_id, secret, nonce=nonce)
    store.db.execute("UPDATE clients SET active=0 WHERE client_id=?", (client_id,))
    with pytest.raises(Exception):
        signed(store, client_id, secret)


def test_lan_hmac_never_requires_pairing_header(monkeypatch):
    store = new_store()
    client_id, secret = add_client(store)
    monkeypatch.setattr(fiscal_module, "LAN_MODE", True)
    assert signed(store, client_id, secret) == client_id


def test_order_idempotency_payload_mismatch_version_and_lease():
    store = new_store()
    gateway = Gateway(store)
    first = GatewayCommandIn(operationId="order-1", expectedVersion=0, orderId=8, payload={"total": 4})
    assert gateway.command(first, "client-a", "order-open")["version"] == 1
    assert gateway.command(first, "client-a", "order-open")["version"] == 1
    changed = first.model_copy(update={"payload": {"total": 5}})
    with pytest.raises(Exception):
        gateway.command(changed, "client-a", "order-open")
    with pytest.raises(Exception):
        gateway.command(GatewayCommandIn(operationId="order-2", expectedVersion=0, orderId=8), "client-a", "order-update")
    with pytest.raises(Exception):
        gateway.command(GatewayCommandIn(operationId="order-3", expectedVersion=1, orderId=8), "client-b", "order-update")


def test_event_resume_and_cash_atomically_emits_projections():
    store = new_store()
    gateway = Gateway(store)
    for index in range(2):
        gateway.command(GatewayCommandIn(operationId=f"event-{index}", expectedVersion=0,
                                         payload={"index": index}), "client-a", "event")
    rows = store.db.execute(
        "SELECT seq,operation_id FROM gateway_events WHERE seq>? ORDER BY seq", (1,)).fetchall()
    assert [row["operation_id"] for row in rows] == ["event-1"]

    fiscal, cash_store, _ = make_fiscal()
    envelope = fiscal.issue_furs_v2(request())
    operation_id = envelope["operationId"]
    assert cash_store.db.execute(
        "SELECT event_type FROM gateway_events WHERE operation_id=?", (operation_id,)).fetchone()[0] == "receipt-issued"
    assert cash_store.db.execute("SELECT COUNT(*) FROM print_jobs WHERE job_id LIKE ?", (operation_id + ":%",)).fetchone()[0] == 1
    assert cash_store.db.execute("SELECT COUNT(*) FROM kds_jobs WHERE job_id LIKE ?", (operation_id + ":%",)).fetchone()[0] >= 1
    assert cash_store.db.execute("SELECT COUNT(*) FROM order_projections WHERE order_id=?",
                                 (envelope["canonicalPayload"]["finalizationPlan"]["receipt"]["orderId"],)).fetchone()[0] == 1
    assert cash_store.db.execute("SELECT COUNT(*) FROM receipts WHERE operation_id=?", (operation_id,)).fetchone()[0] == 1


def test_print_worker_retries_durable_job_without_second_receipt():
    fiscal, store, _ = make_fiscal()
    fiscal.printer.fail = True
    envelope = fiscal.issue_furs_v2(request())
    operation_id = envelope["operationId"]
    assert store.db.execute("SELECT state FROM print_jobs WHERE job_id=?",
                            (operation_id + ":print",)).fetchone()[0] == "QUEUED"
    fiscal.process_print_jobs()
    assert store.db.execute("SELECT state FROM print_jobs WHERE job_id=?",
                            (operation_id + ":print",)).fetchone()[0] == "RETRY"
    assert store.db.execute("SELECT COUNT(*) FROM receipts WHERE operation_id=?",
                            (operation_id,)).fetchone()[0] == 1


def test_windows_service_listener_assignments_are_global_and_tls_gated():
    source = Path(__file__).parents[1].joinpath("fiscal_service.py").read_text()
    assert "global LISTEN_HOST, LISTEN_PORT, LAN_MODE, TLS_CERTFILE, TLS_KEYFILE" in source
    assert 'if LAN_MODE and (not TLS_CERTFILE or not TLS_KEYFILE' in source