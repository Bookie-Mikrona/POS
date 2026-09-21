"""Signed HTTP protocol simulation for the gateway LAN boundary.

TestClient exercises FastAPI routing and middleware with real raw request
signatures.  It is deliberately not a TLS/socket test; physical Windows LAN
coverage remains a deployment concern.
"""
import base64
import hashlib
import hmac
import json
import os
import re
import sys
import tempfile
import time
import uuid
from pathlib import Path

os.environ["BOOKIE_FISCAL_ALLOW_INSECURE_DEV"] = "1"
sys.path.insert(0, str(Path(__file__).parents[1]))

try:
    from fastapi.testclient import TestClient
except RuntimeError as error:  # CI installs httpx from project requirements.
    import pytest
    pytest.skip(str(error), allow_module_level=True)

import fiscal_service as module
from fiscal_service import DPAPI, GatewayV2, Store


def _client(store: Store, role: str, secret: bytes) -> str:
    client_id = str(uuid.uuid4())
    store.db.execute(
        "INSERT INTO clients(client_id,name,secret_blob,active,role,created_at) VALUES(?,?,?,?,?,?)",
        (client_id, role, DPAPI.protect(secret), 1, role, "2026-01-01T00:00:00Z"),
    )
    return client_id


def _signed(client_id: str, secret: bytes, method: str, path: str, body: bytes = b"",
            nonce: str | None = None) -> dict[str, str]:
    timestamp = str(int(time.time()))
    nonce = nonce or uuid.uuid4().hex + uuid.uuid4().hex
    digest = hashlib.sha256(body).hexdigest()
    message = f"{method.upper()}\n{path}\n{timestamp}\n{nonce}\n{digest}".encode()
    return {
        "X-Bookie-Client-Id": client_id,
        "X-Bookie-Timestamp": timestamp,
        "X-Bookie-Nonce": nonce,
        "X-Bookie-Body-SHA256": digest,
        "X-Bookie-Signature": hmac.new(secret, message, hashlib.sha256).hexdigest(),
        "Content-Type": "application/json",
    }


def test_signed_http_two_operator_manager_lan_protocol_and_restart():
    """HTTP protocol simulation (not TLS/socket coverage)."""
    old_store, old_gateway, old_v2, old_sync, old_lan, old_admin, old_is_admin = (
        module.store, module.gateway, module.gateway_v2, module.sync_worker,
        module.LAN_MODE, module.store.get("admin_token"), module.is_windows_admin,
    )
    path = Path(tempfile.mktemp())
    store = Store(path)
    scope = {"companyId": "company-http", "enotaId": "9"}
    store.put("metadata", json.dumps(scope).encode())
    store.put("provisioning_bundle", json.dumps({"device": scope}).encode())
    admin_token = b"test-admin-token"
    store.put("admin_token", DPAPI.protect(admin_token))
    secret_a, secret_b, secret_m = b"A" * 32, b"B" * 32, b"M" * 32
    operator_a = _client(store, "operator", secret_a)
    operator_b = _client(store, "operator", secret_b)
    manager = _client(store, "manager", secret_m)
    module.store = store
    module.gateway = module.Gateway(store)
    module.gateway_v2 = GatewayV2(store)
    module.sync_worker = module.BackgroundSync(store)
    module.LAN_MODE = True
    module.is_windows_admin = lambda: True

    def post(client_id, secret, path_name, payload, nonce=None):
        raw = json.dumps(payload, separators=(",", ":")).encode()
        return client.post(path_name, content=raw,
                           headers=_signed(client_id, secret, "POST", path_name, raw, nonce))

    try:
        with TestClient(module.app, client=("127.0.0.1", 50000)) as client:
            assert client.get("/v1/gateway/health").status_code == 200
            snap_path = "/v1/gateway/v2/snapshot?companyId=company-http&enotaId=9"
            snap = client.get(snap_path, headers=_signed(operator_a, secret_a, "GET", snap_path))
            assert snap.status_code == 200

            order_id = str(uuid.uuid4())
            table_id = "table-http"
            prime = {
                "commandId": "http-prime", **scope, "managerConfirmed": True,
                "tables": [{"tableId": table_id, "status": "available", "activeOrderIds": []}],
                "orders": [],
            }
            assert post(manager, secret_m, "/v1/gateway/v2/prime", prime).status_code == 200
            open_payload = {
                "operationId": "http-open", "commandId": "http-open", **scope,
                "orderId": order_id, "expectedVersion": 0,
                "payload": {"orderId": order_id, "tableId": table_id, "status": "open", "lines": []},
            }
            opened = post(operator_a, secret_a, "/v1/gateway/v2/orders/open", open_payload)
            assert opened.status_code == 200
            opened_body = opened.json()
            assert client.get(snap_path, headers=_signed(operator_b, secret_b, "GET", snap_path)
                              ).json()["orders"][0]["orderId"] == order_id

            replay_nonce = uuid.uuid4().hex + uuid.uuid4().hex
            first = post(operator_a, secret_a, "/v1/gateway/v2/orders/open",
                         {**open_payload, "operationId": "http-open-replay"}, replay_nonce)
            second = post(operator_a, secret_a, "/v1/gateway/v2/orders/open",
                          {**open_payload, "operationId": "http-open-replay-2"}, replay_nonce)
            assert first.status_code == 409 or first.status_code == 200
            assert second.status_code == 409

            lease = {
                "commandId": "http-lease-a", **scope, "orderId": order_id,
                "expectedVersion": opened_body["version"], "leaseSeconds": 120,
            }
            acquired = post(operator_a, secret_a,
                            f"/v1/gateway/v2/orders/{order_id}/lease/acquire", lease)
            assert acquired.status_code == 200
            lease_body = acquired.json()
            conflict = post(operator_b, secret_b,
                             f"/v1/gateway/v2/orders/{order_id}/lease/acquire",
                             {**lease, "commandId": "http-lease-b"})
            assert conflict.status_code == 409
            renew = post(operator_a, secret_a,
                         f"/v1/gateway/v2/orders/{order_id}/lease/renew",
                             {**lease, "commandId": "http-renew", "leaseId": lease_body["leaseId"]})
            assert renew.status_code == 200

            approval = client.post(
                "/v1/gateway/admin/transfer-approval",
                json={"orderId": order_id, "targetClientId": operator_b,
                      "currentFencingVersion": lease_body["fencingVersion"]},
                headers={"X-Bookie-Admin-Token": admin_token.decode()},
            )
            assert approval.status_code == 200
            transfer = post(operator_b, secret_b,
                            f"/v1/gateway/v2/orders/{order_id}/lease/acquire",
                            {**lease, "commandId": "http-transfer", "forceTransfer": True,
                             "approvalCode": approval.json()["approvalCode"]})
            assert transfer.status_code == 200
            used_again = post(operator_b, secret_b,
                               f"/v1/gateway/v2/orders/{order_id}/lease/acquire",
                               {**lease, "commandId": "http-transfer-again", "forceTransfer": True,
                                "approvalCode": approval.json()["approvalCode"]})
            assert used_again.status_code == 403

            line_id = str(uuid.uuid4())
            snapshot = {
                "commandId": "http-snapshot", **scope, "orderId": order_id,
                "expectedVersion": transfer.json()["version"],
                "leaseId": transfer.json()["leaseId"],
                "fencingVersion": transfer.json()["fencingVersion"],
                "snapshot": {"orderId": order_id, "tableId": table_id, "status": "open",
                             "lines": [{"lineId": line_id, "postajaId": 7, "postajaIds": [7],
                                        "quantity": "1"},
                                       {"lineId": str(uuid.uuid4()), "postajaId": 8,
                                        "postajaIds": [8], "quantity": "1"}]},
            }
            first_snapshot = post(operator_b, secret_b,
                                   f"/v1/gateway/v2/orders/{order_id}/snapshot", snapshot)
            assert first_snapshot.status_code == 200
            second_snapshot = {
                **snapshot, "commandId": "http-snapshot-2",
                "expectedVersion": first_snapshot.json()["version"],
                "snapshot": {**snapshot["snapshot"], "lines": [snapshot["snapshot"]["lines"][0]]},
            }
            second = post(operator_b, secret_b,
                          f"/v1/gateway/v2/orders/{order_id}/snapshot", second_snapshot)
            assert second.status_code == 200
            assert second.json()["version"] == first_snapshot.json()["version"] + 1
            exact_replay = post(operator_b, secret_b,
                                f"/v1/gateway/v2/orders/{order_id}/snapshot", second_snapshot)
            assert exact_replay.status_code == 200
            assert exact_replay.json()["version"] == second.json()["version"]
            jobs = client.get("/v1/gateway/v2/kds?companyId=company-http&enotaId=9",
                              headers=_signed(operator_b, secret_b, "GET",
                                              "/v1/gateway/v2/kds?companyId=company-http&enotaId=9"))
            assert jobs.status_code == 200
            assert len(jobs.json()["jobs"]) == 2
            assert [job["state"] for job in jobs.json()["jobs"]
                    if job["payload"]["line"]["postajaId"] == 8] == ["CANCELLED"]
            assert [job["state"] for job in jobs.json()["jobs"]
                    if job["payload"]["line"]["postajaId"] == 7] == ["STARTED"]
            station_path = "/v1/gateway/v2/kds?companyId=company-http&enotaId=9&postajaId=7"
            station_jobs = client.get(station_path, headers=_signed(
                operator_b, secret_b, "GET", station_path,
            ))
            assert [job["payload"]["line"]["postajaId"] for job in station_jobs.json()["jobs"]] == [7]
            job = next(job for job in jobs.json()["jobs"] if job["state"] == "STARTED")
            transition_path = f"/v1/gateway/v2/kds/{job['jobId']}/ready"
            transitioned = post(operator_b, secret_b, transition_path, {
                "operationId": "http-kds-ready", "commandId": "http-kds-ready",
                "jobId": job["jobId"], "expectedVersion": job["version"], **scope,
                "fencingVersion": snapshot["fencingVersion"],
            })
            assert transitioned.status_code == 200
            cancel_snapshot = {
                **second_snapshot, "commandId": "http-snapshot-cancel",
                "expectedVersion": second.json()["version"],
                "snapshot": {**second_snapshot["snapshot"], "status": "cancelled", "lines": []},
            }
            cancelled = post(operator_b, secret_b,
                             f"/v1/gateway/v2/orders/{order_id}/snapshot", cancel_snapshot)
            assert cancelled.status_code == 200
            all_jobs = client.get("/v1/gateway/v2/kds?companyId=company-http&enotaId=9",
                                  headers=_signed(operator_b, secret_b, "GET",
                                                  "/v1/gateway/v2/kds?companyId=company-http&enotaId=9"))
            assert {job["state"] for job in all_jobs.json()["jobs"]} == {"CANCELLED"}
            event_path = "/v1/gateway/events?after=0"
            before_replay_events = client.get(event_path, headers=_signed(
                operator_b, secret_b, "GET", event_path,
            )).json()["events"]
            cancel_replay = post(operator_b, secret_b,
                                 f"/v1/gateway/v2/orders/{order_id}/snapshot", cancel_snapshot)
            assert cancel_replay.status_code == 200
            after_replay_events = client.get(event_path, headers=_signed(
                operator_b, secret_b, "GET", event_path,
            )).json()["events"]
            assert len(all_jobs.json()["jobs"]) == 2
            assert len(after_replay_events) == len(before_replay_events)
            for event in after_replay_events:
                assert re.fullmatch(r"[0-9a-f]{64}", event["payloadHash"])
                assert event["payloadHash"] == hashlib.sha256(
                    module.canonical_json(event["payload"]).encode()
                ).hexdigest()
            events_path = "/v1/gateway/events?after=0"
            events = client.get(events_path, headers=_signed(operator_b, secret_b, "GET", events_path))
            assert events.status_code == 200
            seqs = [event["seq"] for event in events.json()["events"]]
            assert seqs == list(range(1, len(seqs) + 1))
            for event in events.json()["events"]:
                assert re.fullmatch(r"[0-9a-f]{64}", event["payloadHash"])
                assert event["payloadHash"] == hashlib.sha256(
                    module.canonical_json(event["payload"]).encode()
                ).hexdigest()

        # Re-open the same database through fresh global gateway instances.
        restarted = Store(path)
        module.store = restarted
        module.gateway_v2 = GatewayV2(restarted)
        with TestClient(module.app, client=("127.0.0.1", 50000)) as client:
            response = client.get(snap_path, headers=_signed(operator_a, secret_a, "GET", snap_path))
            assert response.status_code == 200
            assert any(str(order["orderId"]) == order_id for order in response.json()["orders"])
    finally:
        module.store = old_store
        module.gateway = old_gateway
        module.gateway_v2 = old_v2
        module.sync_worker = old_sync
        module.LAN_MODE = old_lan
        module.is_windows_admin = old_is_admin


def test_authority_release_is_role_scope_and_global_state_bound():
    old_store, old_gateway, old_v2, old_sync, old_lan = (
        module.store, module.gateway, module.gateway_v2, module.sync_worker, module.LAN_MODE,
    )
    path = Path(tempfile.mktemp())
    store = Store(path)
    scope = {"companyId": "release-company", "enotaId": "11"}
    store.put("metadata", json.dumps(scope).encode())
    operator_secret, manager_secret = b"O" * 32, b"M" * 32
    operator = _client(store, "operator", operator_secret)
    manager = _client(store, "manager", manager_secret)
    # Pairing/provisioning scope is persisted on the trusted manager row.
    store.db.execute("UPDATE clients SET company_id=?, enota_id=? WHERE client_id IN (?,?)",
                     (scope["companyId"], scope["enotaId"], operator, manager))
    store.db.execute("INSERT INTO sync_state(key,value,updated_at) VALUES('authority_mode','GATEWAY','now')")
    store.db.execute("INSERT INTO sync_state(key,value,updated_at) VALUES('release_generation','7','now')")
    module.store = store
    module.gateway = module.Gateway(store)
    module.gateway_v2 = GatewayV2(store)
    module.sync_worker = module.BackgroundSync(store)
    module.LAN_MODE = True

    def signed_post(http_client, client_id, secret, path_name, payload):
        raw = json.dumps(payload, separators=(",", ":")).encode()
        return http_client.post(path_name, content=raw,
                                headers=_signed(client_id, secret, "POST", path_name, raw))

    def signed_get(http_client, client_id, secret, path_name):
        return http_client.get(path_name, headers=_signed(client_id, secret, "GET", path_name))

    release_path = "/v1/gateway/authority/release"
    release_payload = {**scope}
    status_path = "/v1/gateway/authority/status?companyId=release-company&enotaId=11"
    try:
        with TestClient(module.app, client=("127.0.0.1", 50000)) as client:
            before = tuple(store.db.execute(
                "SELECT value FROM sync_state WHERE key IN ('authority_mode','release_generation') ORDER BY key"
            ).fetchall())
            assert signed_post(client, operator, operator_secret, release_path, release_payload).status_code == 403
            assert tuple(store.db.execute(
                "SELECT value FROM sync_state WHERE key IN ('authority_mode','release_generation') ORDER BY key"
            ).fetchall()) == before
            assert signed_post(client, manager, manager_secret, release_path,
                               {"companyId": "wrong", "enotaId": "11"}).status_code == 403
            assert tuple(store.db.execute(
                "SELECT value FROM sync_state WHERE key IN ('authority_mode','release_generation') ORDER BY key"
            ).fetchall()) == before

            # Every blocker is global: this OPEN row belongs to another scope.
            store.db.execute(
                "INSERT INTO gateway_v2_orders(order_id,version,state,projection_json,company_id,enota_id) "
                "VALUES('other-order',1,'OPEN','{}','other-company','99')"
            )
            assert signed_post(client, manager, manager_secret, release_path, release_payload).status_code == 409
            store.db.execute("DELETE FROM gateway_v2_orders")
            store.db.execute(
                "INSERT INTO order_leases(lease_id,order_id,client_id,fencing_version,lease_until,company_id,enota_id) "
                "VALUES('lease','order',?,?,?, 'other-company','99')",
                ("other-client", 1, "2999-01-01T00:00:00Z"),
            )
            assert signed_post(client, manager, manager_secret, release_path, release_payload).status_code == 409
            store.db.execute("DELETE FROM order_leases")
            store.db.execute(
                "INSERT INTO gateway_events(operation_id,payload_hash,event_type,payload_json,created_at) "
                "VALUES('event-release','hash','ORDER','{}','2026-01-01T00:00:00Z')"
            )
            assert signed_post(client, manager, manager_secret, release_path, release_payload).status_code == 409
            store.db.execute("DELETE FROM gateway_events")
            store.db.execute(
                "INSERT INTO sync_state(key,value,updated_at) VALUES('gateway_blocked_review','review','now')"
            )
            assert signed_post(client, manager, manager_secret, release_path, release_payload).status_code == 409
            store.db.execute("DELETE FROM sync_state WHERE key='gateway_blocked_review'")
            store.db.execute(
                "INSERT INTO jobs(id,operation_id,attempts,next_attempt,deadline,state) "
                "VALUES('job','op',0,'2999-01-01','2999-01-01','QUEUED')"
            )
            assert signed_post(client, manager, manager_secret, release_path, release_payload).status_code == 409
            store.db.execute("DELETE FROM jobs")
            store.db.execute(
                "INSERT INTO print_jobs(job_id,version,state,payload_json,attempts,created_at,updated_at) "
                "VALUES('print',1,'QUEUED','{}',0,'2026-01-01','2026-01-01')"
            )
            assert signed_post(client, manager, manager_secret, release_path, release_payload).status_code == 409
            store.db.execute("DELETE FROM print_jobs")

            released = signed_post(client, manager, manager_secret, release_path, release_payload)
            assert released.status_code == 200
            assert released.json()["authorityMode"] == "CLOUD"
            assert released.json()["companyId"] == scope["companyId"]
            assert str(released.json()["enotaId"]) == scope["enotaId"]
            generation = released.json()["releaseGeneration"]
            replay = signed_post(client, manager, manager_secret, release_path, release_payload)
            assert replay.status_code == 200
            assert replay.json()["releaseGeneration"] == generation
            status = signed_get(client, manager, manager_secret, status_path)
            assert status.status_code == 200
            body = status.json()
            assert body["authorityMode"] == "CLOUD"
            assert body["releaseGeneration"] == generation
            assert body["companyId"] == scope["companyId"] and str(body["enotaId"]) == scope["enotaId"]
            assert all(body[key] == 0 for key in (
                "openLocalOrders", "pendingEvents", "unresolvedReviews", "leasedJobs", "inFlightFiscalJobs"))
    finally:
        module.store, module.gateway, module.gateway_v2, module.sync_worker, module.LAN_MODE = (
            old_store, old_gateway, old_v2, old_sync, old_lan,
        )
        try: path.unlink()
        except FileNotFoundError: pass