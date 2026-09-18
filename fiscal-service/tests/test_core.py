import base64
import copy
import hashlib
import json
import os
import tempfile
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

os.environ["BOOKIE_FISCAL_ALLOW_INSECURE_DEV"] = "1"
os.environ["BOOKIE_FISCAL_ALLOW_NONWINDOWS_ADMIN"] = "1"
os.environ["BOOKIE_FISCAL_MOCK_PRINTER"] = "1"

import fiscal_service as fiscal_module
from fiscal_service import (BASE_URL, BackgroundSync, CashIssueIn, DPAPI, Fiscal, MockPrinter,
                             GatewayPrimeIn, GatewayV2, ProvisioningBundleIn, SloveniaBusinessCalendar, Store, canonical_json)
import sync as sync_worker

ROOT = Path(__file__).parents[1]
VECTOR = json.loads((ROOT / "contract/golden-vectors-furs-v1.json").read_text())
V2 = json.loads((ROOT / "contract/golden-vectors-furs-v2.json").read_text())
PRIVATE = serialization.load_pem_private_key(
    (ROOT / "contract" / VECTOR["testAuthority"]["fixturePrivateKeyPath"]).read_bytes(), None)
CERT = x509.load_pem_x509_certificate(
    (ROOT / "contract" / VECTOR["testAuthority"]["fixtureCertificatePath"]).read_bytes())

def make_test_bundle(device_key):
    bundle = copy.deepcopy(VECTOR["provisioning"]["signedBundle"])
    public = device_key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    bundle["device"]["publicKeyFingerprintSha256"] = hashlib.sha256(public).hexdigest()
    bundle["contract"] = {"version": "furs-v2",
                          "goldenAttestationSha256": V2["goldenAttestation"]["goldenAttestationSha256"]}
    unsigned = {k: v for k, v in bundle.items() if k not in ("payloadSha256", "signatureBase64")}
    raw = canonical_json(unsigned).encode()
    bundle["payloadSha256"] = hashlib.sha256(raw).hexdigest()
    bundle["signatureBase64"] = base64.b64encode(
        PRIVATE.sign(raw, padding.PKCS1v15(), hashes.SHA256())).decode()
    return bundle


def make_fiscal():
    path = Path(tempfile.mktemp())
    store = Store(path)
    device_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    store.put("device_rsa_private_key", DPAPI.protect(device_key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())))
    bundle = make_test_bundle(device_key)
    os.environ["BOOKIE_OFFLINE_AUTHORITY_PUBLIC_KEY_PEM"] = bundle["authority"]["publicKeyPem"]
    fiscal = Fiscal(store, MockPrinter())
    fiscal.apply_provisioning_bundle(
        ProvisioningBundleIn.model_validate(bundle),
        datetime.fromisoformat(bundle["validity"]["validFrom"].replace("Z", "+00:00")))
    metadata = json.loads(store.get("metadata"))
    metadata.update(taxNumber="12345678", businessName="Golden Company",
                    fursCertificateFingerprint=bundle["furs"]["expectedCertificateFingerprint"])
    store.put("metadata", canonical_json(metadata).encode())
    store.put("certificate", b"present")
    fiscal._cert = lambda: (PRIVATE, CERT, None)
    return fiscal, store, path


def request(operation_id=None):
    body = copy.deepcopy(VECTOR["cashIssueRequest"])
    authority = body["authorityBundle"]
    authority["contract"]["version"] = "furs-v2"
    authority["contract"]["goldenAttestationSha256"] = V2["goldenAttestation"]["goldenAttestationSha256"]
    unsigned = {k: v for k, v in authority.items() if k not in ("bundleSha256", "signatureBase64")}
    raw = canonical_json(unsigned).encode()
    authority["bundleSha256"] = hashlib.sha256(raw).hexdigest()
    authority["signatureBase64"] = base64.b64encode(PRIVATE.sign(raw, padding.PKCS1v15(), hashes.SHA256())).decode()
    if operation_id:
        body["operationId"] = operation_id
        body["finalizationPlanTemplate"]["sourceOperationId"] = operation_id
    return CashIssueIn.model_validate(body)


def test_complete_attestation_and_contract_paths():
    assert Fiscal.has_complete_furs_golden_vector()
    contract = json.loads((ROOT / "contract/bookie-fiscal-service-v1.json").read_text())
    assert {"/provisioning/proof", "/provisioning/install", "/admin/certificate",
            "/receipts/cash", "/receipts/{operationId}", "/queue", "/sync"} <= set(contract["paths"])


def test_signed_provisioning_install_is_idempotent_and_restart_safe():
    fiscal, store, path = make_fiscal()
    bundle = ProvisioningBundleIn.model_validate(json.loads(store.get("provisioning_bundle")))
    assert fiscal.apply_provisioning_bundle(
        bundle, datetime.fromisoformat(bundle.validity["validFrom"].replace("Z", "+00:00"))) is False
    store.db.close()
    restarted = Store(path)
    assert json.loads(restarted.get("provisioning_bundle"))["bundleId"] == bundle.bundleId
    assert restarted.get("device_rsa_private_key")


def test_provisioning_tamper_and_rollback_fail_closed():
    fiscal, _, _ = make_fiscal()
    tampered = copy.deepcopy(VECTOR["provisioning"]["signedBundle"])
    tampered["device"]["bIdentifier"] = "EVIL"
    with pytest.raises(Exception):
        fiscal.apply_provisioning_bundle(ProvisioningBundleIn.model_validate(tampered))


def test_furs_v1_issue_exact_replay_print_and_persistence():
    fiscal, store, _ = make_fiscal()
    first = fiscal.issue_furs_v2(request())
    replay = fiscal.issue_furs_v2(request())
    assert canonical_json(first) == canonical_json(replay)
    assert first["canonicalPayload"]["envelopeVersion"] == "furs-v2"
    assert "signedXmlBase64" not in first["canonicalPayload"]
    assert first["canonicalPayload"]["finalizationPlan"]["receipt"]["localReceiptId"]
    assert store.db.execute("select count(*) from receipts").fetchone()[0] == 1
    assert store.db.execute("select count(*) from print_attempts").fetchone()[0] == 0
    fiscal.process_print_jobs()
    assert store.db.execute("select count(*) from print_attempts").fetchone()[0] == 1
    assert "ZOI:" in fiscal.printer.attempts[0]


def test_gateway_uuid_cash_issue_closes_order_frees_table_and_replays_exactly():
    fiscal, store, _ = make_fiscal()
    gateway = GatewayV2(store)
    body = request().model_dump(mode="json")
    scope = {
        "companyId": body["authorityBundle"]["server"]["companyId"],
        "enotaId": str(body["authorityBundle"]["server"]["enotaId"]),
    }
    order_id = "5bdc2b5a-8cb9-4a4e-a7b0-8a20d0e2f11a"
    gateway.prime(GatewayPrimeIn(
        commandId="prime-local-receipt", companyId=scope["companyId"], enotaId=scope["enotaId"],
        tables=[{"tableId": "T-1", "status": "occupied", "activeOrderIds": [order_id]}],
        orders=[{"orderId": order_id, "tableId": "T-1", "state": "OPEN", "projection": {
            "orderId": order_id, "tableId": "T-1", "state": "OPEN",
        }}], managerConfirmed=True,
    ), "manager", scope, True)
    body["orderEventSnapshot"].update({
        "orderId": None, "cloudOrderId": None, "sourceOrderRef": order_id,
    })
    template = body["finalizationPlanTemplate"]
    template["receiptContext"].update({
        "orderId": None, "cloudOrderId": None, "sourceOrderRef": order_id,
    })
    template["closure"].update({
        "orderId": None, "cloudOrderId": None, "sourceOrderRef": order_id,
    })
    first = fiscal.issue_furs_v2(CashIssueIn.model_validate(body))
    replay = fiscal.issue_furs_v2(CashIssueIn.model_validate(body))
    assert canonical_json(first) == canonical_json(replay)
    order = store.db.execute(
        "SELECT state,owner_client_id,lease_until,projection_json FROM gateway_v2_orders WHERE order_id=? AND company_id=? AND enota_id=?",
        (order_id, scope["companyId"], scope["enotaId"]),
    ).fetchone()
    table = store.db.execute(
        "SELECT status,projection_json FROM gateway_v2_tables WHERE table_id=? AND company_id=? AND enota_id=?",
        ("T-1", scope["companyId"], scope["enotaId"]),
    ).fetchone()
    assert order["state"] == "CLOSED"
    assert order["owner_client_id"] is None and order["lease_until"] is None
    assert json.loads(order["projection_json"])["status"] == "zakljuceno"
    assert table["status"] == "available"
    assert json.loads(table["projection_json"])["activeOrderIds"] == []


def test_gateway_prime_normalizes_cloud_postavke_to_canonical_lines():
    _, store, _ = make_fiscal()
    gateway = GatewayV2(store)
    scope = {"companyId": "company", "enotaId": "1"}
    gateway.prime(GatewayPrimeIn(
        commandId="prime-cloud-lines", companyId=scope["companyId"], enotaId=scope["enotaId"],
        orders=[{"orderId": "42", "cloudOrderId": 42, "status": "open", "postavke": [{
            "id": 17, "artikelId": 9, "ime": "Kava", "kolicina": 1,
            "cenaKos": "2.50", "skupaj": "2.50", "davek": "22.00",
        }]}], managerConfirmed=True,
    ), "manager", scope, True)
    row = store.db.execute(
        "SELECT projection_json FROM gateway_v2_orders WHERE order_id=? AND company_id=? AND enota_id=?",
        ("42", scope["companyId"], scope["enotaId"]),
    ).fetchone()
    projection = json.loads(row["projection_json"])
    assert projection["orderId"] == "42"
    assert projection["cloudOrderId"] == 42
    assert "postavke" not in projection
    assert projection["lines"] == [{
        "artikelId": 9, "cenaKos": "2.50", "cloudLineId": 17, "davek": "22.00",
        "id": 17, "ime": "Kava", "kolicina": 1, "lineId": "cloud:42:17", "skupaj": "2.50",
    }]


def test_operation_payload_mismatch_is_rejected():
    fiscal, _, _ = make_fiscal()
    fiscal.issue_furs_v2(request())
    changed = request()
    changed.orderEventSnapshot["orderVersion"] = 999
    with pytest.raises(Exception):
        fiscal.issue_furs_v2(changed)


def test_concurrent_issuance_allocates_unique_sequences():
    fiscal, store, _ = make_fiscal()
    errors = []
    def issue(index):
        try:
            fiscal.issue_furs_v2(request(f"018f47d2-44d2-7a6b-8d7c-{index:012x}"))
        except Exception as error:
            errors.append(error)
    threads = [threading.Thread(target=issue, args=(i + 1,)) for i in range(8)]
    [thread.start() for thread in threads]
    [thread.join() for thread in threads]
    assert not errors
    assert [row[0] for row in store.db.execute("select number from receipts order by number")] == list(range(1, 9))


def test_signing_failure_rolls_back_sequence():
    fiscal, store, _ = make_fiscal()
    fiscal._cert = lambda: (_ for _ in ()).throw(RuntimeError("certificate unavailable"))
    with pytest.raises(RuntimeError):
        fiscal.issue_furs_v2(request())
    assert store.db.execute("select count(*) from receipts").fetchone()[0] == 0
    assert store.db.execute("select count(*) from sequences").fetchone()[0] == 0


def test_failed_print_is_durable_without_unsealing_receipt():
    fiscal, store, _ = make_fiscal()
    fiscal.printer.fail = True
    envelope = fiscal.issue_furs_v2(request())
    assert envelope["payloadSha256"]
    assert store.db.execute("select count(*) from print_attempts").fetchone()[0] == 0
    fiscal.process_print_jobs()
    assert store.db.execute("select success from print_attempts").fetchone()[0] == 0
    assert store.db.execute("select count(*) from receipts").fetchone()[0] == 1


def test_windows_core_signature_matches_bookie_typescript_verifier_input_and_tamper_fails():
    fiscal, store, _ = make_fiscal()
    envelope = fiscal.issue_furs_v2(request())
    core = envelope["canonicalPayload"]
    signature = base64.b64decode(core["deviceSignatureBase64"])
    unsigned = {key: value for key, value in core.items() if key != "deviceSignatureBase64"}
    canonical = canonical_json(unsigned).encode()
    assert hashlib.sha256(canonical_json(core).encode()).hexdigest() == envelope["payloadSha256"]
    device_key = serialization.load_pem_private_key(
        DPAPI.unprotect(store.get("device_rsa_private_key")), None)
    device_key.public_key().verify(signature, canonical, padding.PKCS1v15(), hashes.SHA256())
    assert core["legalInvoice"]["certificateFingerprint"] == core["certificateFingerprint"]
    tampered = copy.deepcopy(unsigned)
    tampered["legalInvoice"]["invoiceAmount"] = "99.99"
    with pytest.raises(Exception):
        device_key.public_key().verify(
            signature, canonical_json(tampered).encode(), padding.PKCS1v15(), hashes.SHA256())


def test_queue_projection_matches_shared_pos_android_schema_for_new_and_delivered_receipts(monkeypatch):
    fiscal, store, _ = make_fiscal()
    envelope = fiscal.issue_furs_v2(request())
    monkeypatch.setattr(fiscal_module, "store", store)
    def projected():
        return fiscal_module.queue()["items"][0]
    pending = projected()
    assert pending["envelope"] == envelope
    assert pending["bookieDeliveryState"] == "pending"
    assert pending["serverFursProjection"] == {
        "fursState": None, "eor": None, "attemptCount": 0, "lastError": None,
    }
    raw_bookie = {
        "id": "server-id", "operationId": envelope["operationId"],
        "localReceiptId": envelope["canonicalPayload"]["localReceiptId"],
        "fursState": "pending", "eor": None, "unexpected": "must-not-leak",
    }
    store.db.execute("UPDATE jobs SET state='BOOKIE_DELIVERED'")
    store.db.execute("UPDATE receipts SET server_response=?", (json.dumps(raw_bookie),))
    delivered = projected()
    assert delivered["bookieDeliveryState"] == "confirmed"
    assert delivered["serverFursProjection"]["attemptCount"] == 0
    assert delivered["serverFursProjection"]["lastError"] is None
    assert "unexpected" not in delivered["serverFursProjection"]
    store.db.execute("UPDATE receipts SET server_response=?", (json.dumps({
        "fursState": "needs_review", "eor": "late-differing-eor",
        "attemptCount": 2, "lastError": "EOR differs from a late FURS response",
    }),))
    review = projected()
    assert review["serverFursProjection"] == {
        "fursState": "needs_review", "eor": "late-differing-eor", "attemptCount": 2,
        "lastError": "EOR differs from a late FURS response",
    }


def test_two_business_day_deadline_skips_weekend():
    start = datetime.fromisoformat("2025-01-03T10:15:30+01:00")
    assert SloveniaBusinessCalendar().submission_deadline(start).isoformat() == "2025-01-07T10:15:30+01:00"


def sync_fixture():
    fiscal, store, _ = make_fiscal()
    envelope = fiscal.issue_furs_v2(request())
    sealed = store.db.execute("select envelope_json from receipts").fetchone()[0].encode()
    return store, sealed, envelope


def http_error(req, code):
    return urllib.error.HTTPError(req.full_url, code, f"HTTP {code}", {}, None)


@pytest.mark.parametrize("failure", ["timeout", 500, 429, 408])
def test_ambiguous_bookie_delivery_retries_identical_core(monkeypatch, failure):
    store, _, _ = sync_fixture()
    calls = []
    def urlopen(req, timeout):
        calls.append(req)
        if failure == "timeout":
            raise TimeoutError("response lost")
        raise http_error(req, failure)
    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    sync_worker.sync_once(store, DPAPI.unprotect)
    assert store.db.execute("select state from jobs").fetchone()[0] == "PENDING"
    store.db.execute("update jobs set next_attempt='2000-01-01T00:00:00+00:00'")
    calls.clear()
    sync_worker.sync_once(store, DPAPI.unprotect)
    assert len(calls) == 1 and calls[0].method == "POST"


def test_bookie_acceptance_stops_delivery_of_exact_core(monkeypatch):
    store, sealed, _ = sync_fixture()
    calls = []
    class Response:
        def __enter__(self): return self
        def __exit__(self, *_): pass
        def read(self): return json.dumps({
            "operationId": request().operationId, "deliveryState": "DELIVERED",
            "fursState": "confirmed", "businessFinalized": True, "eor": "test-eor",
        }).encode()
    outcomes = ["timeout", "confirmed"]
    def urlopen(req, timeout):
        calls.append(req)
        outcome = outcomes.pop(0)
        if outcome == "timeout": raise TimeoutError("response lost")
        return Response()
    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    for expected in ("PENDING", "BOOKIE_DELIVERED"):
        sync_worker.sync_once(store, DPAPI.unprotect)
        assert store.db.execute("select state from jobs").fetchone()[0] == expected
        store.db.execute("update jobs set next_attempt='2000-01-01T00:00:00+00:00'")
    assert [call.method for call in calls] == ["POST", "POST"]
    expected_core = canonical_json(json.loads(sealed)["canonicalPayload"]).encode()
    assert calls[0].data == expected_core == calls[1].data
    assert tuple(store.db.execute("select count(*),min(number),max(number) from receipts").fetchone()) == (1, 1, 1)
    projection = store.db.execute(
        "select j.deadline,r.server_response from jobs j join receipts r on r.operation_id=j.operation_id"
    ).fetchone()
    assert projection["deadline"] and json.loads(projection["server_response"])["eor"] == "test-eor"


@pytest.mark.parametrize("incomplete", [
    {"fursState": "confirmed", "businessFinalized": True, "eor": "eor"},
    {"deliveryState": "DELIVERED", "fursState": "confirmed", "businessFinalized": False, "eor": "eor"},
    {"deliveryState": "DELIVERED", "fursState": "pending", "businessFinalized": True, "eor": "eor"},
])
def test_incomplete_bookie_acceptance_stays_pending(monkeypatch, incomplete):
    store, sealed, _ = sync_fixture()
    calls = []

    class Response:
        def __enter__(self): return self
        def __exit__(self, *_): pass
        def read(self): return json.dumps({"operationId": request().operationId, **incomplete}).encode()

    def urlopen(req, timeout):
        calls.append(req)
        return Response()

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    sync_worker.sync_once(store, DPAPI.unprotect)
    assert store.db.execute("select state from jobs").fetchone()[0] == "PENDING"
    store.db.execute("update jobs set next_attempt='2000-01-01T00:00:00+00:00'")
    sync_worker.sync_once(store, DPAPI.unprotect)
    assert len(calls) == 2
    expected_core = canonical_json(json.loads(sealed)["canonicalPayload"]).encode()
    assert calls[0].data == calls[1].data == expected_core


def test_permanent_post_409_needs_review_and_is_not_retried(monkeypatch):
    store, _, _ = sync_fixture()
    calls = []
    def urlopen(req, timeout):
        calls.append(req)
        raise http_error(req, 409)
    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    sync_worker.sync_once(store, DPAPI.unprotect)
    assert store.db.execute("select state from jobs").fetchone()[0] == "NEEDS_REVIEW"
    assert store.db.execute("select state from receipts").fetchone()[0] == "NEEDS_REVIEW"
    store.db.execute("update jobs set next_attempt='2000-01-01T00:00:00+00:00'")
    sync_worker.sync_once(store, DPAPI.unprotect)
    assert len(calls) == 1


def test_sync_uses_dpapi_store_key_without_plaintext_artifacts(monkeypatch):
    store, _, _ = sync_fixture()
    protected = store.get("device_rsa_private_key")
    assert protected and not protected.startswith(b"-----BEGIN")
    seen = []
    def unprotect(blob):
        seen.append(blob)
        return DPAPI.unprotect(blob)
    monkeypatch.setattr(urllib.request, "urlopen",
                        lambda req, timeout: (_ for _ in ()).throw(TimeoutError("offline")))
    sync_worker.sync_once(store, unprotect)
    assert seen == [protected]
    source = (ROOT / "sync.py").read_text()
    assert "--private-key" not in source and "private_key_path" not in source


def test_background_worker_startup_wakeup_and_clean_shutdown(monkeypatch):
    store = Store(Path(tempfile.mktemp()))
    calls = []
    invoked = threading.Event()
    def run_once(actual_store, unprotect):
        calls.append(actual_store)
        invoked.set()
        return 0
    monkeypatch.setattr(sync_worker, "sync_once", run_once)
    worker = BackgroundSync(store, interval_seconds=60)
    worker.start()
    assert invoked.wait(2)
    worker.wake("reconnect")
    deadline = time.time() + 2
    while len(calls) < 2 and time.time() < deadline:
        time.sleep(.01)
    worker.stop()
    assert len(calls) >= 2 and not worker._thread.is_alive()
    assert store.get("sync_last_run")


def test_install_and_package_use_contract_loopback_port_and_embedded_sync():
    install = (ROOT / "install.ps1").read_text()
    start = (ROOT / "start.bat").read_text()
    build = (ROOT / "build.bat").read_text()
    assert BASE_URL == "http://127.0.0.1:17831/v1"
    assert "--host 127.0.0.1 --port 17831" in install
    assert "--host 127.0.0.1 --port 17831" in start
    assert "8766" not in start
    assert "sc.exe config" in install and "ProgramData" in install
    assert "--hidden-import sync" in build and '--add-data "contract;contract"' in build
    assert "--private-key" not in install + start + build


def test_windows_release_scripts_are_fail_closed_and_redact_private_material():
    build_release = (ROOT / "build-release.ps1").read_text()
    install = (ROOT / "install.ps1").read_text()
    verify = (ROOT / "verify-windows-install.ps1").read_text()
    export = (ROOT / "export-client-certificate.ps1").read_text()
    checklist = (ROOT / "WINDOWS-RELEASE-CHECKLIST.md").read_text()
    assert "CertificateThumbprint" in build_release and "signtool.exe" in build_release
    assert "TimestampUrl" in build_release and "Assert-Signed" in build_release
    assert "AllowUnsignedDevelopment" in install and "ExpectedSignerThumbprint" in install
    assert "ConfirmSafeCloudRelease" in install and "BookieFiscal-Backups" in install
    assert "ScmRecoveryApi" in install and "LocalSubnet" in install and "Private" in install
    assert "RunCrashRecoveryTest" in verify and "RunPrinterTest" in verify
    assert "EvidencePath" in verify and "TimeStamperCertificate" in verify
    assert "InstallToTrustedRoot" in export and "BEGIN CERTIFICATE" in export
    checklist_flat = " ".join(checklist.lower().split())
    assert "private key" in checklist_flat and "cannot be validated on linux" in checklist_flat
    assert "Invoke-Native" in build_release and "Invoke-Native" in install and "Invoke-Native" in verify
    assert "release-manifest.json is excluded" in build_release
    assert "allowlist" in build_release and "release-build-work" in build_release
    assert "Remove-Item $OutputRoot" not in build_release
    assert "dangerous or ambiguous location" in build_release
    assert "package-" in build_release and "GetPathRoot" in build_release
    assert "Get-FileHash $stageExe" in install and "Assert-Signed $stageExe" in install
    assert "Get-TreeManifest" in install and "Assert-TreeManifest" in install
    assert "Loopback has no firewall rule" in verify and "DelayedAutostart" in verify
    assert "SkipCertificateCheck" not in verify + install
    assert "Invoke-WebRequest" not in verify + install
    assert "SkipCertificateCheck" not in build_release + verify + install + export
    assert "Get-NetFirewallPortFilter" in verify + install
    assert "ProcessId" in verify and "BookieFiscalService" in verify
    assert "ConfirmPhysicalPrinterOutput" not in verify
    assert "X509Store" in install and "LocalMachine" in install and "generatedCertificateThumbprint" in install
    assert "S-1-5-18" in install and "S-1-5-32-544" in install and "SetAccessRuleProtection" in install
    assert "IdentityReference.Translate" in install and "entries.Count -ne 2" in verify
    assert "Get-BookieFirewallState" in install and "Get-NetFirewallApplicationFilter" in install
    assert "Exactly one Bookie firewall rule" in verify
    assert "Resolve-PriorHealthHost" in install and '"0.0.0.0","::","*"' in install
    assert "service-before.reg" in install and "ScmRecoveryApi" in install
    assert "ChangeServiceConfig2" in install and "QueryServiceConfig2" in install
    assert "Get-ItemProperty" in install and "DelayedAutostart" in install
    assert install.index("$oldFirewall = @(Get-FirewallSnapshot)") < install.index("Stop-Service BookieFiscalService")
    assert "if ($existing -and $wasRunning)" in install and "elseif ($existing)" in install
    assert "Write-Error" not in install
    assert "$originalFailure = $_.Exception" in install
    assert "Invoke-RollbackPhase" in install and "$rollbackFailures = @()" in install
    assert "Rollback succeeded; backup=" in install and "FATAL ROLLBACK ERROR: installation failed:" in install
    assert "productVersion=$manifestProductVersion" in build_release
    assert "fileVersion=$manifestFileVersion" in build_release
    assert "-like" not in build_release[build_release.find("$versionInfo"):build_release.find("$commit")]
    assert "manifest.productVersion" in install and "manifest.fileVersion" in install
    assert "Manifest ProductVersion" in verify and "Manifest FileVersion" in verify
    assert '"/s","My"' in build_release and '"/sm"' in build_release
    assert "1.3.6.1.5.5.7.3.3" in build_release and "HasPrivateKey" in build_release
    assert "Timestamp:|The signature is timestamped" not in build_release
    assert "qfailure" not in install + verify and "RESET_PERIOD" not in install + verify
    assert "return @(Get-BookieFirewallState | Sort-Object DisplayName)" in install
    assert "Enabled" in install and "Direction" in install and "Action" in install and "ExpectedPort" in install
    assert "StartPagePrinter" in verify and "w!=b.Length" in verify and "EndDocPrinter" in verify
    send_block = verify[verify.find("if (-not (\"Bookie.RawSpool\""):verify.find("Check \"Printer installed\"")]
    assert send_block.count("[Bookie.RawSpool]::Send") == 1
    helper = (ROOT / "new-test-signing-certificate.ps1").read_text()
    internal_helper = (ROOT / "new-internal-signing-certificate.ps1").read_text()
    remover = (ROOT / "remove-test-signing-certificate.ps1").read_text()
    runbook = (ROOT / "WINDOWS-TEST-RUNBOOK.md").read_text()
    assert 'CN=Bookie Local Gateway TEST ONLY' in helper and 'KeyLength 3072' in helper
    assert 'AddDays(30)' in helper and 'KeyExportPolicy NonExportable' in helper
    assert '-Provider "Microsoft Software Key Storage Provider"' in helper
    assert 'RSACertificateExtensions]::GetRSAPrivateKey' in helper
    assert 'Where-Object Oid.Value' not in helper
    assert 'RSAType=' in helper and 'ExportPolicy=' in helper and 'CodeSigningEKU=' in helper
    assert '$createdThumbprint = $null' in helper and 'Cleanup failures:' in helper
    assert 'foreach ($storeName in "My","Root","TrustedPublisher")' in helper
    assert '.PrivateKey' not in helper
    assert 'Cert:\\CurrentUser\\My' in helper and 'TrustedPublisher' in helper
    assert 'productionAllowed=$false' in helper and 'releaseChannel="test"' in helper
    assert 'CN=Bookie Local Gateway BOOKIE INTERNAL PRODUCTION' in internal_helper
    assert 'KeyExportPolicy NonExportable' in internal_helper
    assert 'ExportPfx' in internal_helper and 'PfxPassword' in internal_helper
    assert 'ConfirmRemoval' in remover and 'Where-Object Thumbprint -eq $thumb' in remover
    assert '-TestOnly' in build_release and 'releaseChannel=$releaseChannel' in build_release
    assert 'productionAllowed=$productionAllowed' in build_release and 'TEST-ONLY' in build_release
    assert 'AllowTestPackage' in install and 'AllowTestPackage' in verify
    assert 'NOT FOR CUSTOMER DISTRIBUTION' in install and 'releaseChannel=$releaseChannel' in verify
    assert '1.0.0' in runbook and '192.168.1.250' in runbook and 'POS-58' in runbook
    assert 'new-test-signing-certificate.ps1' in runbook and 'remove-test-signing-certificate.ps1' in runbook
    assert 'new-test-signing-certificate.ps1' not in build_release[build_release.find('$allowlist'):]
    assert 'bookie-internal-production.cer' in build_release[build_release.find('$allowlist'):]
    assert "Get-SignerIsTest" in install and "SignerCertificate.Subject" in install
    assert "manifestTest" in install and "manifestProduction" in install
    assert "Manifest classification does not match actual signer classification" in install
    assert "signerIsTest" in verify and "manifestTest" in verify and "manifestProduction" in verify
    assert "Manifest classification does not match actual signer classification" in verify
    assert "LocalMachine\\My" in build_release and "thumbCandidates.Count -ne 1" in build_release
    assert "ExportPolicy" in build_release and "KeySize -lt 3072" in build_release
    assert 'RSACertificateExtensions]::GetRSAPrivateKey' in build_release
    assert "$normalizedDangerousPath" in build_release
    assert 'Build failed: $($buildFailure.Exception.Message)' in build_release
    for source, label in ((build_release, "build_release"), (install, "install"), (verify, "verify")):
        assert source.count('$ErrorActionPreference = "Continue"') >= 1, label
        assert source.count("$previousErrorActionPreference = $ErrorActionPreference") >= 1, label
        assert source.count("$ErrorActionPreference = $previousErrorActionPreference") >= 1, label
        assert source.count("$exitCode = $LASTEXITCODE") >= 1, label
        assert "command not found." in source, label
        assert "<no native output>" in source, label
    assert '.PrivateKey' not in build_release[build_release.find("if ($TestOnly)"):build_release.find("return $candidate")]
    assert build_release.index("$thumbCandidates = @()") < build_release.index("$testIdentityCount = 0")
    assert "$internalSubject = \"CN=Bookie Local Gateway BOOKIE INTERNAL PRODUCTION\"" in build_release
    assert "if ($TestOnly)" in build_release and "candidate.Store -ne \"Cert:\\CurrentUser\\My\"" in build_release
    for source in (build_release, install, verify, export):
        assert "PFX" not in source and "pairing secret" not in source.lower()
    assert "PublicCertificatePath" in build_release
    assert "TrustedPublisher" in install and "bookie-internal-production.cer" in install
    assert "internal-production" in build_release + install + verify