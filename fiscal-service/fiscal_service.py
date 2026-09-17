"""Bookie Local Gateway: a Windows LAN single-writer and fiscal boundary.

This program deliberately has no scanner dependency.  It is packaged as a
separate Windows executable/service and is the sole owner of fiscal sequences.
"""
from __future__ import annotations

import argparse
import base64
import ctypes
import hashlib
import html
import hmac
import json
import os
import platform
import secrets
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable, Literal, Protocol
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from fastapi import Body, FastAPI, HTTPException, Request, Response
from lxml import etree
from pydantic import BaseModel, Field
import sync as sync_engine

VERSION = "1.1.0"
MAX_BODY = 64 * 1024
BASE_URL = "http://127.0.0.1:17831/v1"
DEFAULT_ORIGIN = os.environ.get("BOOKIE_FISCAL_ALLOWED_ORIGIN", "https://pos.bookie.si")
LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 17831
LAN_MODE = False
TLS_CERTFILE: str | None = None
TLS_KEYFILE: str | None = None
APP_DIR = Path(os.environ.get("BOOKIE_FISCAL_DATA_DIR",
                              Path(os.environ.get("PROGRAMDATA", Path.home() / ".local/share")) / "BookieFiscal"))


def canonical_json(value: Any) -> str:
    """Bookie canonical JSON v1 (see checked-in cross-platform vectors)."""
    def validate(item: Any) -> None:
        if isinstance(item, float) and (item != item or item in (float("inf"), float("-inf")) or item == 0 and str(item).startswith("-")):
            raise ValueError("NaN, Infinity and negative zero are forbidden in fiscal canonical JSON")
        if isinstance(item, Decimal):
            raise ValueError("Decimal values must be encoded as strings in canonical payloads")
        if isinstance(item, dict):
            if not all(isinstance(key, str) for key in item):
                raise ValueError("Canonical JSON object keys must be strings")
            for child in item.values():
                validate(child)
        elif isinstance(item, list):
            for child in item:
                validate(child)
        elif isinstance(item, float):
            pass
        elif item is not None and not isinstance(item, (str, int, bool)):
            raise ValueError(f"Unsupported canonical JSON value: {type(item).__name__}")
    validate(value)
    # JSON.stringify emits integral finite numbers without a trailing ".0".
    def js_numbers(item: Any) -> Any:
        if isinstance(item, float) and item.is_integer():
            return int(item)
        if isinstance(item, dict):
            return {key: js_numbers(child) for key, child in item.items()}
        if isinstance(item, list):
            return [js_numbers(child) for child in item]
        return item
    return json.dumps(js_numbers(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def deterministic_finalization_uuid(operation_id: str, name: str) -> str:
    if name not in {"receipt", "issue-reservation", "furs-snapshot"}:
        raise ValueError("Invalid finalization UUID name")
    return str(uuid.uuid5(uuid.UUID(operation_id), name))


def _furs_money(value: Any) -> str:
    return f"{Decimal(str(value)).quantize(Decimal('0.01')):.2f}"


def _furs_timestamp(issued_at: str) -> str:
    return datetime.fromisoformat(issued_at).strftime("%Y-%m-%dT%H:%M:%S")


def _zoi_timestamp(issued_at: str) -> str:
    return datetime.fromisoformat(issued_at).strftime("%d.%m.%Y %H:%M:%S")


def calculate_zoi(plan: dict[str, Any], tax_number: str, private_key: Any) -> tuple[str, str, bytes]:
    receipt = plan["receipt"]
    zoi_input = (
        f"{tax_number}{_zoi_timestamp(receipt['issuedAt'])}{_furs_money(plan['totals']['gross'])}"
        f"{receipt['legalNumber']}{receipt['pp']}{receipt['b']}"
    )
    signature = private_key.sign(zoi_input.encode(), padding.PKCS1v15(), hashes.SHA256())
    return hashlib.md5(signature).hexdigest(), zoi_input, signature


def build_furs_invoice_xml(plan: dict[str, Any], tax_number: str, operator_tax_number: str,
                           message_id: str, invoice_request_id: str, zoi: str) -> str:
    receipt = plan["receipt"]
    totals = plan["totals"]
    tax_rows = "".join(
        f"<fu:VAT><fu:TaxRate>{_furs_money(group['rate'])}</fu:TaxRate>"
        f"<fu:TaxableAmount>{_furs_money(Decimal(str(group['gross'])) - Decimal(str(group['vat'])))}</fu:TaxableAmount>"
        f"<fu:TaxAmount>{_furs_money(group['vat'])}</fu:TaxAmount></fu:VAT>"
        for group in totals["vatGroups"]
    )
    return (
        f"<fu:InvoiceRequest xmlns:fu='{FURS_NS}' Id='{invoice_request_id}'>"
        f"<fu:Header><fu:MessageID>{message_id}</fu:MessageID>"
        f"<fu:DateTime>{_furs_timestamp(receipt['issuedAt'])}</fu:DateTime></fu:Header>"
        f"<fu:Invoice><fu:TaxNumber>{tax_number}</fu:TaxNumber>"
        f"<fu:IssueDateTime>{_furs_timestamp(receipt['issuedAt'])}</fu:IssueDateTime>"
        f"<fu:NumberingStructure>B</fu:NumberingStructure>"
        f"<fu:InvoiceIdentifier><fu:BusinessPremiseID>{receipt['pp']}</fu:BusinessPremiseID>"
        f"<fu:ElectronicDeviceID>{receipt['b']}</fu:ElectronicDeviceID>"
        f"<fu:InvoiceNumber>{receipt['ppBSequence']}</fu:InvoiceNumber></fu:InvoiceIdentifier>"
        f"<fu:InvoiceAmount>{_furs_money(totals['gross'])}</fu:InvoiceAmount>"
        f"<fu:PaymentAmount>{_furs_money(totals['gross'])}</fu:PaymentAmount>"
        f"<fu:TaxesPerSeller>{tax_rows}</fu:TaxesPerSeller>"
        f"<fu:OperatorTaxNumber>{operator_tax_number}</fu:OperatorTaxNumber>"
        f"<fu:ProtectedID>{zoi}</fu:ProtectedID></fu:Invoice></fu:InvoiceRequest>"
    )


def sign_furs_soap(invoice_xml: str, private_key: Any, certificate: x509.Certificate) -> str:
    soap = (
        f'<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" '
        f'xmlns:xd="{DS_NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        f"<soapenv:Header/><soapenv:Body>{invoice_xml}</soapenv:Body></soapenv:Envelope>"
    )
    envelope = etree.fromstring(soap.encode())
    invoice = envelope.find(f".//{{{FURS_NS}}}InvoiceRequest")
    if invoice is None:
        raise ValueError("SOAP document does not contain a FURS InvoiceRequest")
    invoice_request_id = invoice.get("Id")
    if not invoice_request_id:
        raise ValueError("FURS InvoiceRequest Id is required")
    digest = base64.b64encode(hashlib.sha256(
        etree.tostring(invoice, method="c14n", exclusive=False, with_comments=False)
    ).digest()).decode()
    issuer = ",".join(
        attr.rfc4514_string()
        for rdn in reversed(certificate.issuer.rdns)
        for attr in rdn
    )
    cert_der = certificate.public_bytes(serialization.Encoding.DER)
    signed_info = (
        f'<SignedInfo xmlns="{DS_NS}"><CanonicalizationMethod Algorithm="{C14N_URI}"></CanonicalizationMethod>'
        '<SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></SignatureMethod>'
        f'<Reference URI="#{invoice_request_id}"><Transforms>'
        '<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform>'
        f'<Transform Algorithm="{C14N_URI}"></Transform></Transforms>'
        '<DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></DigestMethod>'
        f"<DigestValue>{digest}</DigestValue></Reference></SignedInfo>"
    )
    emitted_signed_info = signed_info.replace(f' xmlns="{DS_NS}"', "", 1)
    for tag in ("CanonicalizationMethod", "SignatureMethod", "Transform", "DigestMethod"):
        emitted_signed_info = emitted_signed_info.replace(f"></{tag}>", "/>")
    unsigned_soap = etree.tostring(envelope, encoding="unicode")
    # xml-crypto creates the transform children namespace-unaware. Its inclusive
    # C14N therefore emits explicit empty default namespaces for these nodes.
    canonical_info = (
        f'<SignedInfo xmlns="{DS_NS}" xmlns:fu="{FURS_NS}" '
        f'xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xd="{DS_NS}" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        f'<CanonicalizationMethod Algorithm="{C14N_URI}"></CanonicalizationMethod>'
        '<SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></SignatureMethod>'
        f'<Reference URI="#{invoice_request_id}"><Transforms><Transform '
        'Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform>'
        f'<Transform Algorithm="{C14N_URI}"></Transform></Transforms>'
        '<DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></DigestMethod>'
        f'<DigestValue>{digest}</DigestValue></Reference></SignedInfo>'
    ).encode()
    signature = base64.b64encode(
        private_key.sign(canonical_info, padding.PKCS1v15(), hashes.SHA256())
    ).decode()
    signature_xml = (
        f'<Signature xmlns="{DS_NS}">{emitted_signed_info}<SignatureValue>{signature}</SignatureValue>'
        f"<KeyInfo><X509Data><X509IssuerSerial><X509IssuerName>{escape(issuer)}</X509IssuerName>"
        f"<X509SerialNumber>{certificate.serial_number}</X509SerialNumber></X509IssuerSerial>"
        f"<X509Certificate>{base64.b64encode(cert_der).decode()}</X509Certificate>"
        "</X509Data></KeyInfo></Signature>"
    )
    # Inserting as text preserves xml-crypto's default ds namespace spelling;
    # lxml would otherwise reuse the SOAP ancestor's equivalent ``xd`` prefix.
    signed_soap = unsigned_soap.replace(
        "</fu:InvoiceRequest>", signature_xml + "</fu:InvoiceRequest>", 1
    )
    return "<?xml version='1.0' encoding='UTF-8'?>" + signed_soap


class CalendarPolicy(Protocol):
    id: str
    def submission_deadline(self, interruption: datetime) -> datetime: ...


class SloveniaBusinessCalendar:
    """Policy seam for statutory holidays supplied by the provisioner."""
    id = "SI-BUSINESS-DAY-V1"
    zone = ZoneInfo("Europe/Ljubljana")

    def __init__(self, holidays: set[str] | None = None):
        self.holidays = holidays or set()

    def submission_deadline(self, interruption: datetime) -> datetime:
        if interruption.tzinfo is None:
            raise ValueError("Interruption timestamp must be timezone-aware")
        result = interruption.astimezone(self.zone)
        consumed = 0
        while consumed < 2:
            result += timedelta(days=1)
            if result.weekday() < 5 and result.date().isoformat() not in self.holidays:
                consumed += 1
        return result


def is_windows_admin() -> bool:
    if platform.system() != "Windows":
        return os.environ.get("BOOKIE_FISCAL_ALLOW_NONWINDOWS_ADMIN") == "1"
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def free_bytes(path: Path) -> int:
    if platform.system() == "Windows":
        available = ctypes.c_ulonglong()
        if not ctypes.windll.kernel32.GetDiskFreeSpaceExW(str(path), ctypes.byref(available), None, None):
            raise OSError("Unable to check free disk space")
        return available.value
    status = os.statvfs(path)
    return status.f_bavail * status.f_frsize


class DPAPI:
    """Protect at rest using Windows DPAPI. Development requires explicit opt-in."""
    @staticmethod
    def protect(value: bytes) -> bytes:
        if platform.system() != "Windows":
            if os.environ.get("BOOKIE_FISCAL_ALLOW_INSECURE_DEV") != "1":
                raise RuntimeError("Windows DPAPI is required")
            return b"DEV-ONLY:" + value
        import win32crypt
        return win32crypt.CryptProtectData(value, "Bookie Fiscal Service", None, None, None, 0)[1]

    @staticmethod
    def unprotect(value: bytes) -> bytes:
        if value.startswith(b"DEV-ONLY:") and os.environ.get("BOOKIE_FISCAL_ALLOW_INSECURE_DEV") == "1":
            return value[9:]
        if platform.system() != "Windows":
            raise RuntimeError("Windows DPAPI is required")
        import win32crypt
        return win32crypt.CryptUnprotectData(value, None, None, None, 0)[1]


class Printer(Protocol):
    def print_receipt(self, text: str) -> str: ...


class MockPrinter:
    def __init__(self): self.attempts: list[str] = []; self.fail = False; self.jobs: list[str] = []
    def print_receipt(self, text: str) -> str:
        self.attempts.append(text)
        if self.fail: raise OSError("mock printer unavailable")
        job_id = f"mock-{len(self.attempts)}"
        self.jobs.append(job_id)
        return job_id
    def allocate_and_print(self, text: str, on_allocated: Callable[[str], None]) -> str:
        if self.fail:
            self.attempts.append(text)
            raise OSError("mock printer unavailable")
        job_id = f"mock-{len(self.attempts) + 1}"
        on_allocated(job_id)
        return self.print_receipt(text)


class WindowsPrinter:
    """Raw spooler adapter; works with ESC/POS printers installed in Windows."""
    def __init__(self, name: str): self.name = name
    def print_receipt(self, text: str) -> str:
        return self._print(text, lambda _job_id: None)
    def allocate_and_print(self, text: str, on_allocated: Callable[[str], None]) -> str:
        return self._print(text, on_allocated)
    def spool_job_proven(self, job_id: str) -> bool | None:
        if platform.system() != "Windows":
            return None
        # pywin32 exposes the spooler job identifier but not a stable
        # cross-driver completion state; absence is therefore unknown.
        return None
    def _print(self, text: str, on_allocated: Callable[[str], None]) -> str:
        if platform.system() != "Windows": raise OSError("Windows printer adapter requires Windows")
        import win32print
        data = b"\x1b@" + text.encode("cp852", "replace") + b"\n\n\n\x1dV\x00"
        h = win32print.OpenPrinter(self.name)
        try:
            spool_job_id = str(win32print.StartDocPrinter(h, 1, ("Bookie fiscal receipt", None, "RAW")))
            on_allocated(spool_job_id)
            win32print.StartPagePrinter(h); win32print.WritePrinter(h, data); win32print.EndPagePrinter(h)
            win32print.EndDocPrinter(h)
        finally: win32print.ClosePrinter(h)
        return hashlib.sha256(data).hexdigest()


class CashIssueIn(BaseModel):
    operationId: str
    authorityBundle: dict[str, Any]
    orderEventSnapshot: dict[str, Any]
    finalizationPlanTemplate: dict[str, Any]
    legalTimestamp: datetime
    interruptionStartedAt: datetime


class PairIn(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")
    clientName: str = Field(min_length=1, max_length=100)


class ProvisioningProofIn(BaseModel):
    challengeId: str
    challenge: str = Field(min_length=32, max_length=256)


class ProvisioningBundleIn(BaseModel):
    schemaName: str = Field(alias="schema")
    bundleId: str
    version: int
    device: dict[str, Any]
    authority: dict[str, Any]
    furs: dict[str, Any]
    pos: dict[str, Any]
    sync: dict[str, Any]
    contract: dict[str, Any]
    authentication: dict[str, Any]
    revocation: dict[str, Any]
    validity: dict[str, Any]
    payloadSha256: str
    signatureBase64: str


class StrictModel(BaseModel):
    """Boundary models for the LAN gateway; silently ignored fields are unsafe."""
    model_config = {"extra": "forbid"}


class GatewayCommandIn(StrictModel):
    operationId: str = Field(min_length=1, max_length=128)
    expectedVersion: int = Field(ge=0)
    payload: dict[str, Any] = Field(default_factory=dict)
    # v1 accepted integer cloud identifiers.  v2 uses gateway-owned UUIDs,
    # while cloud IDs remain optional references in the snapshot.
    orderId: int | str | None = None
    tableId: int | str | None = None
    status: str | None = Field(default=None, min_length=1, max_length=40)
    ownerClientId: str | None = Field(default=None, max_length=128)
    forceTransfer: bool = False
    leaseSeconds: int = Field(default=120, ge=10, le=3600)
    kind: str | None = Field(default=None, max_length=80)
    jobId: str | None = Field(default=None, max_length=128)
    lineId: int | None = Field(default=None, ge=1)
    reason: str | None = Field(default=None, max_length=500)
    companyId: str | None = Field(default=None, min_length=1, max_length=128)
    enotaId: int | str | None = None
    leaseId: str | None = Field(default=None, min_length=1, max_length=128)
    fencingVersion: int | None = Field(default=None, ge=0)
    snapshot: dict[str, Any] | None = None
    commandId: str | None = Field(default=None, min_length=1, max_length=128)


class GatewayAckIn(StrictModel):
    operationId: str = Field(min_length=1, max_length=128)
    jobId: str = Field(min_length=1, max_length=128)
    expectedVersion: int = Field(ge=0)
    detail: str | None = Field(default=None, max_length=500)
    companyId: str | None = Field(default=None, min_length=1, max_length=128)
    enotaId: int | str | None = None
    fencingVersion: int | None = Field(default=None, ge=0)
    commandId: str | None = Field(default=None, min_length=1, max_length=128)


class GatewayScopeIn(StrictModel):
    companyId: str = Field(min_length=1, max_length=128)
    enotaId: int | str


class GatewayLeaseIn(StrictModel):
    commandId: str = Field(min_length=1, max_length=128)
    orderId: int | str
    expectedVersion: int = Field(ge=0)
    leaseId: str | None = Field(default=None, max_length=128)
    leaseSeconds: int = Field(default=120, ge=10, le=3600)
    companyId: str | None = Field(default=None, max_length=128)
    enotaId: int | str | None = None
    forceTransfer: bool = False
    approvalCode: str | None = Field(default=None, min_length=8, max_length=128)


class GatewayTransferApprovalIn(StrictModel):
    orderId: int | str
    targetClientId: str = Field(min_length=1, max_length=128)
    currentFencingVersion: int = Field(ge=0)


class GatewaySnapshotIn(StrictModel):
    commandId: str = Field(min_length=1, max_length=128)
    orderId: int | str
    expectedVersion: int = Field(ge=0)
    leaseId: str = Field(min_length=1, max_length=128)
    fencingVersion: int = Field(ge=1)
    snapshot: dict[str, Any]
    companyId: str
    enotaId: int | str


class GatewayPrimeIn(StrictModel):
    commandId: str = Field(min_length=1, max_length=128)
    companyId: str
    enotaId: int | str
    tables: list[dict[str, Any]] = Field(default_factory=list)
    orders: list[dict[str, Any]] = Field(default_factory=list)
    managerConfirmed: bool = False


class GatewayClientRevokeIn(StrictModel):
    revoked: bool = True
    reason: str | None = Field(default=None, max_length=500)


class GatewayClientRoleIn(StrictModel):
    role: Literal["viewer", "operator", "manager"]


class CertificateImportIn(BaseModel):
    pkcs12Base64: str = Field(max_length=13_981_016)
    password: str = Field(min_length=1, max_length=1024)


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        self.db.execute("PRAGMA journal_mode=WAL"); self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("PRAGMA foreign_keys=ON"); self.db.execute("PRAGMA busy_timeout=10000")
        self.db.executescript("""CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS sequences(premise TEXT NOT NULL, device TEXT NOT NULL, value INTEGER NOT NULL,
 PRIMARY KEY(premise,device));
CREATE TABLE IF NOT EXISTS receipts(operation_id TEXT PRIMARY KEY, premise TEXT NOT NULL, device TEXT NOT NULL,
 number INTEGER NOT NULL, issued_at TEXT NOT NULL, canonical TEXT NOT NULL, payload_hash TEXT NOT NULL,
 zoi TEXT NOT NULL, xml TEXT NOT NULL, xml_hash TEXT NOT NULL, signature_b64 TEXT NOT NULL,
 state TEXT NOT NULL, previous_hash TEXT NOT NULL, chain_hash TEXT NOT NULL, server_response TEXT,
 UNIQUE(premise,device,number));
CREATE TABLE IF NOT EXISTS print_attempts(id INTEGER PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES receipts,
 at TEXT NOT NULL, success INTEGER NOT NULL, detail TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, attempts INTEGER NOT NULL,
 next_attempt TEXT NOT NULL, deadline TEXT NOT NULL, state TEXT NOT NULL, last_error TEXT);
 CREATE TABLE IF NOT EXISTS auth_nonces(nonce TEXT PRIMARY KEY, seen_at INTEGER NOT NULL,
  client_id TEXT);
 CREATE TABLE IF NOT EXISTS clients(
  client_id TEXT PRIMARY KEY, name TEXT NOT NULL, secret_blob BLOB NOT NULL,
   active INTEGER NOT NULL DEFAULT 1, role TEXT NOT NULL DEFAULT 'operator',
   created_at TEXT NOT NULL, revoked_at TEXT, revoke_reason TEXT);
 CREATE TABLE IF NOT EXISTS gateway_events(
  seq INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL, event_type TEXT NOT NULL, payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS entity_versions(
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, version INTEGER NOT NULL,
  PRIMARY KEY(entity_type, entity_id));
 CREATE TABLE IF NOT EXISTS order_projections(
  order_id INTEGER PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL,
  projection_json TEXT NOT NULL, owner_client_id TEXT, lease_until TEXT,
  local_id TEXT, company_id TEXT, enota_id TEXT, lease_id TEXT, fencing_version INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS table_projections(
  table_id INTEGER PRIMARY KEY, version INTEGER NOT NULL, status TEXT NOT NULL,
  projection_json TEXT NOT NULL, company_id TEXT, enota_id TEXT);
 CREATE TABLE IF NOT EXISTS kds_jobs(
  job_id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL,
  payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  company_id TEXT, enota_id TEXT, order_id TEXT, line_id TEXT, idempotency_key TEXT);
 CREATE TABLE IF NOT EXISTS print_jobs(
  job_id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL,
  payload_json TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sync_state(
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);""")
        columns = {row[1] for row in self.db.execute("PRAGMA table_info(receipts)")}
        if "envelope_json" not in columns:
            self.db.execute("ALTER TABLE receipts ADD COLUMN envelope_json TEXT")
        # Existing installations had a global pairing secret.  It is retained
        # for compatible /v1 clients; new pairings are stored per client.
        client_columns = {row[1] for row in self.db.execute("PRAGMA table_info(clients)")}
        if "revoke_reason" not in client_columns:
            self.db.execute("ALTER TABLE clients ADD COLUMN revoke_reason TEXT")
        if "role" not in client_columns:
            self.db.execute("ALTER TABLE clients ADD COLUMN role TEXT NOT NULL DEFAULT 'operator'")
        if "company_id" not in client_columns:
            self.db.execute("ALTER TABLE clients ADD COLUMN company_id TEXT")
        if "enota_id" not in client_columns:
            self.db.execute("ALTER TABLE clients ADD COLUMN enota_id TEXT")
        print_columns = {row[1] for row in self.db.execute("PRAGMA table_info(print_jobs)")}
        if "lease_until" not in print_columns:
            self.db.execute("ALTER TABLE print_jobs ADD COLUMN lease_until TEXT")
        if "spool_job_id" not in print_columns:
            self.db.execute("ALTER TABLE print_jobs ADD COLUMN spool_job_id TEXT")
        nonce_columns = {row[1] for row in self.db.execute("PRAGMA table_info(auth_nonces)")}
        if "client_id" not in nonce_columns:
            self.db.execute("ALTER TABLE auth_nonces ADD COLUMN client_id TEXT")
        # v2 gateway columns are additive so an installed MVP database remains
        # readable and its receipt/fiscal history is never rewritten.
        for table, columns_to_add in {
            "order_projections": {
                "local_id": "TEXT", "company_id": "TEXT", "enota_id": "TEXT",
                "lease_id": "TEXT", "fencing_version": "INTEGER NOT NULL DEFAULT 0",
            },
            "table_projections": {"company_id": "TEXT", "enota_id": "TEXT"},
            "kds_jobs": {
                "company_id": "TEXT", "enota_id": "TEXT", "order_id": "TEXT",
                "line_id": "TEXT", "idempotency_key": "TEXT",
            },
        }.items():
            present = {row[1] for row in self.db.execute(f"PRAGMA table_info({table})")}
            for name, definition in columns_to_add.items():
                if name not in present:
                    self.db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
        self.db.execute("""CREATE TABLE IF NOT EXISTS order_leases(
            lease_id TEXT PRIMARY KEY, order_id TEXT NOT NULL, client_id TEXT NOT NULL,
            fencing_version INTEGER NOT NULL, lease_until TEXT NOT NULL,
            company_id TEXT NOT NULL, enota_id TEXT NOT NULL)""")
        # v2 POS projections deliberately do not reuse the MVP integer-key
        # tables above.  Existing installations may contain legacy integer
        # rows; UUID gateway orders must never be coerced into those keys.
        self.db.execute("""CREATE TABLE IF NOT EXISTS gateway_v2_orders(
            order_id TEXT NOT NULL, version INTEGER NOT NULL, state TEXT NOT NULL,
            projection_json TEXT NOT NULL, owner_client_id TEXT, lease_until TEXT,
            local_id TEXT, company_id TEXT NOT NULL, enota_id TEXT NOT NULL,
            lease_id TEXT, fencing_version INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(company_id, enota_id, order_id))""")
        self.db.execute("""CREATE TABLE IF NOT EXISTS gateway_v2_tables(
            table_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
            projection_json TEXT NOT NULL, company_id TEXT NOT NULL, enota_id TEXT NOT NULL,
            PRIMARY KEY(company_id, enota_id, table_id))""")
        self.db.execute("""CREATE TABLE IF NOT EXISTS gateway_transfer_approvals(
            approval_hash TEXT PRIMARY KEY, order_id TEXT NOT NULL,
            target_client_id TEXT NOT NULL, fencing_version INTEGER NOT NULL,
            expires_at TEXT NOT NULL, created_at TEXT NOT NULL)""")

    def get(self, k: str) -> bytes | None:
        row = self.db.execute("SELECT v FROM settings WHERE k=?", (k,)).fetchone()
        return row["v"] if row else None
    def put(self, k: str, v: bytes) -> None: self.db.execute("INSERT OR REPLACE INTO settings VALUES(?,?)", (k,v))


class Fiscal:
    def __init__(self, store: Store, printer: Printer, calendar: CalendarPolicy | None = None):
        self.s, self.printer = store, printer
        self.calendar = calendar or SloveniaBusinessCalendar()

    def _cert(self):
        blob, password = self.s.get("certificate"), self.s.get("certificate_password")
        if not blob or not password: raise HTTPException(409, "Device has not been provisioned")
        return pkcs12.load_key_and_certificates(DPAPI.unprotect(blob), DPAPI.unprotect(password))

    def certificate_status(self) -> dict[str, Any]:
        try:
            _, cert, _ = self._cert()
        except Exception:
            return {"installed": False, "fingerprint": None, "validFrom": None, "validUntil": None,
                    "matchesProvisioningBundle": False}
        fingerprint = "sha256:" + cert.fingerprint(hashes.SHA256()).hex()
        bundle_blob = self.s.get("provisioning_bundle")
        expected = json.loads(bundle_blob)["furs"]["expectedCertificateFingerprint"] if bundle_blob else None
        return {
            "installed": True, "fingerprint": fingerprint,
            "validFrom": cert.not_valid_before_utc.isoformat().replace("+00:00", "Z"),
            "validUntil": cert.not_valid_after_utc.isoformat().replace("+00:00", "Z"),
            "matchesProvisioningBundle": fingerprint == expected,
        }

    def import_certificate(self, request: CertificateImportIn) -> dict[str, Any]:
        bundle_blob = self.s.get("provisioning_bundle")
        if not bundle_blob:
            raise HTTPException(409, "PROVISIONING_BUNDLE_NOT_INSTALLED")
        try:
            raw = base64.b64decode(request.pkcs12Base64, validate=True)
            key, cert, _ = pkcs12.load_key_and_certificates(raw, request.password.encode())
        except Exception:
            raise HTTPException(422, "PKCS12_INVALID")
        if not key or not cert:
            raise HTTPException(422, "PKCS12_KEY_AND_CERTIFICATE_REQUIRED")
        fingerprint = "sha256:" + cert.fingerprint(hashes.SHA256()).hex()
        expected = json.loads(bundle_blob)["furs"]["expectedCertificateFingerprint"]
        if fingerprint != expected:
            raise HTTPException(409, "FURS_CERTIFICATE_FINGERPRINT_MISMATCH")
        with self.s.lock:
            self.s.db.execute("BEGIN IMMEDIATE")
            try:
                self.s.put("certificate", DPAPI.protect(raw))
                self.s.put("certificate_password", DPAPI.protect(request.password.encode()))
                metadata = json.loads(self.s.get("metadata") or b"{}")
                metadata["fursCertificateFingerprint"] = fingerprint
                self.s.put("metadata", canonical_json(metadata).encode())
                self.s.db.execute("COMMIT")
            except Exception:
                self.s.db.execute("ROLLBACK")
                raise
        return self.certificate_status()

    def apply_provisioning_bundle(self, request: ProvisioningBundleIn,
                                  at: datetime | None = None) -> bool:
        bundle = request.model_dump(by_alias=True)
        if bundle["schema"] != "bookie-offline-provisioning-v1":
            raise HTTPException(422, "PROVISIONING_BUNDLE_SCHEMA_INVALID")
        unsigned = {k: v for k, v in bundle.items() if k not in {"payloadSha256", "signatureBase64"}}
        raw = canonical_json(unsigned).encode()
        if hashlib.sha256(raw).hexdigest() != bundle["payloadSha256"]:
            raise HTTPException(422, "PROVISIONING_BUNDLE_HASH_MISMATCH")
        pinned_pem = os.environ.get("BOOKIE_OFFLINE_AUTHORITY_PUBLIC_KEY_PEM", "").replace("\\n", "\n")
        if not pinned_pem:
            raise HTTPException(503, "PROVISIONING_TRUST_ANCHOR_NOT_CONFIGURED")
        authority_pem = str(bundle["authority"].get("publicKeyPem", "")).replace("\r\n", "\n")
        if authority_pem != pinned_pem.replace("\r\n", "\n"):
            raise HTTPException(422, "PROVISIONING_AUTHORITY_NOT_TRUSTED")
        try:
            serialization.load_pem_public_key(pinned_pem.encode()).verify(
                base64.b64decode(bundle["signatureBase64"], validate=True),
                raw, padding.PKCS1v15(), hashes.SHA256(),
            )
        except Exception:
            raise HTTPException(422, "PROVISIONING_BUNDLE_SIGNATURE_INVALID")
        now = at or datetime.now(timezone.utc)
        try:
            valid_from = datetime.fromisoformat(bundle["validity"]["validFrom"].replace("Z", "+00:00"))
            valid_until = datetime.fromisoformat(bundle["validity"]["validUntil"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            raise HTTPException(422, "PROVISIONING_BUNDLE_VALIDITY_INVALID")
        if not valid_from <= now <= valid_until:
            raise HTTPException(422, "PROVISIONING_BUNDLE_EXPIRED")
        origins = bundle["pos"].get("allowedHttpsOrigins")
        if not isinstance(origins, list) or not origins or any(
                not isinstance(origin, str) or not origin.startswith("https://") or
                origin.rstrip("/") != origin for origin in origins):
            raise HTTPException(422, "PROVISIONING_ORIGINS_INVALID")
        sync = bundle["sync"]
        if not str(sync.get("httpsBaseUrl", "")).startswith("https://") or \
                sync.get("ingestPath") != "/api/offline-fiscal/sync/receipts/ingest" or \
                 sync.get("statusPathTemplate") != "/api/offline-fiscal/sync/receipts/status/{operationId}" or \
                 sync.get("gatewayIngestPath", "/api/offline-fiscal/sync/gateway-events/ingest") != \
                     "/api/offline-fiscal/sync/gateway-events/ingest" or \
                 sync.get("gatewayStatusPath", "/api/offline-fiscal/sync/gateway-events/status") != \
                     "/api/offline-fiscal/sync/gateway-events/status":
            raise HTTPException(422, "PROVISIONING_SYNC_CONFIG_INVALID")
        if bundle["contract"].get("version") != "furs-v2" or \
                bundle["contract"].get("goldenAttestationSha256") != \
                json.loads((Path(__file__).parent / "contract/golden-vectors-furs-v2.json")
                           .read_text())["goldenAttestation"]["goldenAttestationSha256"]:
            raise HTTPException(422, "PROVISIONING_CONTRACT_INVALID")
        protected_key = self.s.get("device_rsa_private_key")
        if not protected_key:
            raise HTTPException(409, "DEVICE_KEY_NOT_GENERATED")
        local_key = serialization.load_pem_private_key(DPAPI.unprotect(protected_key), password=None)
        if local_key.key_size != 3072:
            raise HTTPException(409, "DEVICE_KEY_SIZE_INVALID")
        local_public = local_key.public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        if bundle["device"].get("publicKeyFingerprintSha256") != hashlib.sha256(local_public).hexdigest():
            raise HTTPException(409, "PROVISIONING_DEVICE_KEY_MISMATCH")
        certificate_blob = self.s.get("certificate")
        if certificate_blob:
            _, certificate, _ = self._cert()
            if "sha256:" + certificate.fingerprint(hashes.SHA256()).hex() != \
                    bundle["furs"]["expectedCertificateFingerprint"]:
                raise HTTPException(409, "PROVISIONING_FURS_CERTIFICATE_MISMATCH")
        existing = self.s.get("provisioning_bundle")
        if existing:
            old = json.loads(existing)
            if bundle["bundleId"] == old["bundleId"]:
                if canonical_json(bundle) == canonical_json(old):
                    return False
                raise HTTPException(409, "PROVISIONING_BUNDLE_ID_CONFLICT")
            immutable = ("id", "companyId", "enotaId", "poslovniProstorId",
                         "poslovniProstorOznaka", "bIdentifier", "publicKeyFingerprintSha256")
            if any(bundle["device"].get(k) != old["device"].get(k) for k in immutable):
                raise HTTPException(409, "PROVISIONING_DEVICE_IDENTITY_CONFLICT")
            if bundle["version"] <= old["version"]:
                raise HTTPException(409, "PROVISIONING_BUNDLE_ROLLBACK")
            if bundle["authority"]["version"] < old["authority"]["version"] or \
                    bundle["revocation"]["deviceVersion"] < old["revocation"]["deviceVersion"] or \
                    bundle["version"] < old["revocation"]["minimumAcceptedVersion"]:
                raise HTTPException(409, "PROVISIONING_VERSION_ROLLBACK")
        if bundle["version"] < bundle["revocation"]["minimumAcceptedVersion"]:
            raise HTTPException(409, "PROVISIONING_MINIMUM_VERSION_REJECTED")
        metadata = {
            "companyId": bundle["device"]["companyId"], "enotaId": bundle["device"]["enotaId"],
            "deviceId": bundle["device"]["id"], "poslovniProstorId": bundle["device"]["poslovniProstorId"],
            "poslovniProstorOznaka": bundle["device"]["poslovniProstorOznaka"],
            "bIdentifier": bundle["device"]["bIdentifier"],
            "authorityKeyId": bundle["authority"]["keyId"],
            "authorityPublicKeyPem": authority_pem, "authorityVersion": bundle["authority"]["version"],
            "goldenAttestationSha256": bundle["contract"]["goldenAttestationSha256"],
            "expectedFursCertFingerprint": bundle["furs"]["expectedCertificateFingerprint"],
            "syncHttpsBaseUrl": sync["httpsBaseUrl"], "syncIngestPath": sync["ingestPath"],
            "syncStatusPathTemplate": sync["statusPathTemplate"], "allowedHttpsOrigins": origins,
            "publicKeyFingerprintSha256": bundle["device"]["publicKeyFingerprintSha256"],
        }
        with self.s.lock:
            self.s.db.execute("BEGIN IMMEDIATE")
            try:
                self.s.put("provisioning_bundle", canonical_json(bundle).encode())
                self.s.put("metadata", canonical_json(metadata).encode())
                self.s.db.execute("COMMIT")
            except Exception:
                self.s.db.execute("ROLLBACK")
                raise
        return True

    def verify_authority_bundle(self, bundle: dict[str, Any], issued_at: datetime) -> dict[str, Any]:
        expected_keys = {
            "schema", "bundleId", "server", "scope", "contract", "validity", "operator",
            "catalog", "modifiers", "policies", "authority", "bundleSha256", "signatureBase64",
        }
        if set(bundle) != expected_keys or bundle.get("schema") != "bookie-offline-authority-v1":
            raise HTTPException(422, "AUTHORITY_BUNDLE_SHAPE_INVALID")
        metadata_blob = self.s.get("metadata")
        if not metadata_blob:
            raise HTTPException(409, "Device has not been provisioned")
        meta = json.loads(metadata_blob)
        if (bundle.get("server") != {"companyId": meta.get("companyId"), "enotaId": meta.get("enotaId")} or
            bundle.get("scope") != {"deviceId": meta.get("deviceId"), "premiseId": meta.get("poslovniProstorId"),
                                    "bIdentifier": meta.get("bIdentifier")}):
            raise HTTPException(422, "AUTHORITY_BUNDLE_SCOPE_MISMATCH")
        contract_data = bundle.get("contract", {})
        authority = bundle.get("authority", {})
        if (contract_data.get("version") != "furs-v2" or
            contract_data.get("authorityVersion") != meta.get("authorityVersion") or
            contract_data.get("goldenAttestationSha256") != meta.get("goldenAttestationSha256") or
            authority.get("keyId") != meta.get("authorityKeyId") or
            authority.get("publicKeyPem", "").replace("\r\n", "\n") !=
                (meta.get("authorityPublicKeyPem") or "").replace("\r\n", "\n")):
            raise HTTPException(422, "AUTHORITY_BUNDLE_TRUST_MISMATCH")
        try:
            valid_from = datetime.fromisoformat(bundle["validity"]["validFrom"].replace("Z", "+00:00"))
            valid_until = datetime.fromisoformat(bundle["validity"]["validUntil"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            raise HTTPException(422, "AUTHORITY_BUNDLE_VALIDITY_INVALID")
        if issued_at.tzinfo is None or not valid_from <= issued_at.astimezone(timezone.utc) <= valid_until:
            raise HTTPException(422, "AUTHORITY_BUNDLE_EXPIRED")
        unsigned = {key: value for key, value in bundle.items() if key not in {"bundleSha256", "signatureBase64"}}
        canonical = canonical_json(unsigned).encode("utf-8")
        digest = hashlib.sha256(canonical).hexdigest()
        if digest != bundle["bundleSha256"]:
            raise HTTPException(422, "AUTHORITY_BUNDLE_HASH_MISMATCH")
        try:
            public_key = serialization.load_pem_public_key(meta["authorityPublicKeyPem"].encode("ascii"))
            public_key.verify(base64.b64decode(bundle["signatureBase64"], validate=True), canonical,
                              padding.PKCS1v15(), hashes.SHA256())
        except Exception:
            raise HTTPException(422, "AUTHORITY_BUNDLE_SIGNATURE_INVALID")
        return meta

    def derive_finalization_plan(self, request: CashIssueIn, sequence: int, issued_at: datetime) -> dict[str, Any]:
        template = request.finalizationPlanTemplate
        if template.get("version") != 2 or template.get("source") != "offline" or \
                template.get("sourceOperationId") != request.operationId:
            raise HTTPException(422, "FINALIZATION_PLAN_TEMPLATE_INVALID")
        context = template.get("receiptContext", {})
        bundle = request.authorityBundle
        context_ref = str(context.get("sourceOrderRef", context.get("orderId", "")))
        snapshot_ref = str(request.orderEventSnapshot.get(
            "sourceOrderRef", request.orderEventSnapshot.get("orderId", "")))
        context_cloud_id = context.get("cloudOrderId", context.get("orderId"))
        snapshot_cloud_id = request.orderEventSnapshot.get(
            "cloudOrderId", request.orderEventSnapshot.get("orderId"))
        if (context.get("companyId") != bundle["server"]["companyId"] or
            context.get("enotaId") != bundle["server"]["enotaId"] or
            context_cloud_id != snapshot_cloud_id or
            not context_ref or context_ref != snapshot_ref):
            raise HTTPException(422, "FINALIZATION_PLAN_TEMPLATE_SCOPE_MISMATCH")
        operation = uuid.UUID(request.operationId)
        pp, b = bundle["scope"]["premiseId"], bundle["scope"]["bIdentifier"]
        # The legal PP is the provisioned label; premiseId remains the server routing id.
        meta = json.loads(self.s.get("metadata"))
        pp_label = meta["poslovniProstorOznaka"]
        legal_number = f"{pp_label}-{b}-{sequence}"
        plan = {key: value for key, value in template.items() if key != "receiptContext"}
        plan["receipt"] = {
            "localReceiptId": deterministic_finalization_uuid(request.operationId, "receipt"),
            "companyId": context["companyId"],
            "enotaId": context["enotaId"], "orderId": context.get("orderId"),
            "cloudOrderId": context.get("cloudOrderId", context.get("orderId")),
            "sourceOrderRef": context_ref,
            "legalNumber": legal_number,
            "pp": pp_label, "b": b, "ppBSequence": sequence, "issuedAt": issued_at.isoformat(),
            "isPartial": context["isPartial"],
        }
        plan["reservations"] = {"issueReservationId": deterministic_finalization_uuid(request.operationId, "issue-reservation")}
        plan["print"] = {**plan["print"], "receiptNumber": legal_number, "issuedAt": issued_at.isoformat()}
        plan["furs"] = {
            "snapshotId": deterministic_finalization_uuid(request.operationId, "furs-snapshot"),
            "requestHash": "", "canonicalArtifactLink": "offline:" + request.operationId,
        }
        return plan

    @staticmethod
    def has_complete_furs_golden_vector() -> bool:
        try:
            contract_dir = Path(__file__).parent / "contract"
            vector = json.loads((contract_dir / "golden-vectors-furs-v2.json").read_text(encoding="utf-8"))
            contract = json.loads((contract_dir / "bookie-fiscal-service-v1.json").read_text(encoding="utf-8"))
            core = vector["legalCore"]
            return (core["envelopeVersion"] == "furs-v2" and
                    hashlib.sha256(canonical_json(core).encode()).hexdigest() ==
                    vector["goldenAttestation"]["aggregationInputUtf8"].split("\n")[0].split("=")[1] and
                    vector["goldenAttestation"]["goldenAttestationSha256"])
        except Exception:
            return False

    def issue_furs_v2(self, request: CashIssueIn, actor: str | None = None) -> dict[str, Any]:
        with self.s.lock:
            meta = self.verify_authority_bundle(request.authorityBundle, request.legalTimestamp)
            furs_key, furs_cert, _ = self._cert()
            device_blob = self.s.get("device_rsa_private_key")
            if not device_blob:
                raise HTTPException(409, "DEVICE_KEY_NOT_GENERATED")
            device_key = serialization.load_pem_private_key(DPAPI.unprotect(device_blob), password=None)
        if not self.has_complete_furs_golden_vector():
            raise HTTPException(503, "FURS_V2_LEGAL_CORE_GOLDEN_VECTOR_MISSING")
        request_json = canonical_json(request.model_dump(mode="json"))
        request_hash = hashlib.sha256(request_json.encode()).hexdigest()
        issued_at = request.legalTimestamp.astimezone(ZoneInfo("Europe/Ljubljana"))
        issued_text = issued_at.isoformat(timespec="seconds")
        if request.legalTimestamp.utcoffset() != issued_at.utcoffset():
            raise HTTPException(422, "LEGAL_TIMESTAMP_NOT_LJUBLJANA")
        pp, b = meta["poslovniProstorOznaka"], meta["bIdentifier"]
        with self.s.lock:
            self.s.db.execute("BEGIN IMMEDIATE")
            try:
                old = self.s.db.execute(
                    "SELECT canonical,envelope_json FROM receipts WHERE operation_id=?", (request.operationId,)
                ).fetchone()
                if old:
                    if hashlib.sha256(old["canonical"].encode()).hexdigest() != request_hash:
                        raise HTTPException(409, "OPERATION_PAYLOAD_MISMATCH")
                    self.s.db.execute("COMMIT")
                    return json.loads(old["envelope_json"])
                seq_row = self.s.db.execute(
                    "SELECT value FROM sequences WHERE premise=? AND device=?", (pp, b)
                ).fetchone()
                sequence = (seq_row["value"] if seq_row else 0) + 1
                self.s.db.execute(
                    "INSERT INTO sequences VALUES(?,?,?) ON CONFLICT(premise,device) "
                    "DO UPDATE SET value=excluded.value", (pp, b, sequence),
                )
                plan = self.derive_finalization_plan(request, sequence, issued_at)
                local_id = plan["receipt"]["localReceiptId"]
                zoi, zoi_input, zoi_signature = calculate_zoi(plan, meta["taxNumber"], furs_key)
                plan_hash = hashlib.sha256(canonical_json(plan).encode()).hexdigest()
                cert_fingerprint = "sha256:" + furs_cert.fingerprint(hashes.SHA256()).hex()
                legal_invoice = {
                    "taxNumber": meta["taxNumber"], "issueDateTime": _furs_timestamp(issued_text),
                    "invoiceNumber": sequence, "businessPremiseId": pp, "electronicDeviceId": b,
                    "invoiceAmount": _furs_money(plan["totals"]["gross"]),
                    "paymentAmount": _furs_money(plan["totals"]["gross"]), "numberingStructure": "B",
                    "operatorTaxNumber": plan["operator"]["taxNumber"],
                    "taxesPerSeller": [{"taxRate": _furs_money(g["rate"]),
                        "taxableAmount": _furs_money(Decimal(str(g["gross"])) - Decimal(str(g["vat"]))),
                        "taxAmount": _furs_money(g["vat"])} for g in plan["totals"]["vatGroups"]],
                    "zoiInput": zoi_input, "zoi": zoi,
                    "certificateFingerprint": cert_fingerprint,
                }
                public_der = device_key.public_key().public_bytes(
                    serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
                device_fingerprint = hashlib.sha256(public_der).hexdigest()
                core = {
                    "envelopeVersion": "furs-v2", "operationId": request.operationId, "localReceiptId": local_id,
                    "authorityBundle": request.authorityBundle, "finalizationPlan": plan,
                    "finalizationPlanSha256": plan_hash, "legalInvoice": legal_invoice,
                    "zoiSignatureBase64": base64.b64encode(zoi_signature).decode(),
                    "certificateFingerprint": cert_fingerprint,
                    "deviceKeyFingerprintSha256": device_fingerprint,
                }
                canonical_core = canonical_json(core).encode()
                payload_hash = hashlib.sha256(canonical_core).hexdigest()
                device_signature = base64.b64encode(device_key.sign(
                    canonical_core, padding.PKCS1v15(), hashes.SHA256()
                )).decode()
                core["deviceSignatureBase64"] = device_signature
                # The signature covers the unsigned core, while the outer
                # boundary hash identifies the complete immutable signed core.
                payload_hash = hashlib.sha256(canonical_json(core).encode()).hexdigest()
                routing = {
                    "operationId": request.operationId, "deviceId": meta["deviceId"],
                    "poslovniProstorId": meta["poslovniProstorId"], "poslovniProstorOznaka": pp,
                    "bIdentifier": b, "sequence": sequence, "payloadSha256": payload_hash,
                    "issuedAt": issued_text, "interruptionStartedAt": request.interruptionStartedAt.isoformat(),
                    "operatorReference": request.authorityBundle["operator"].get("taxNumber"),
                    "orderId": plan["receipt"]["orderId"],
                    "cloudOrderId": plan["receipt"].get("cloudOrderId"),
                    "sourceOrderRef": plan["receipt"].get("sourceOrderRef"),
                    "paymentReference": None, "paymentMethod": "cash",
                }
                envelope = {
                    **{k: routing[k] for k in routing if k != "payloadSha256"},
                    "canonicalPayload": core, "payloadSha256": payload_hash,
                    "deviceSignature": device_signature,
                    "signingPublicKeyFingerprintSha256": device_fingerprint,
                }
                envelope_json = canonical_json(envelope)
                previous = self.s.db.execute(
                    "SELECT chain_hash FROM receipts ORDER BY rowid DESC LIMIT 1"
                ).fetchone()
                previous_hash = previous["chain_hash"] if previous else "0" * 64
                chain_hash = hashlib.sha256(
                    (previous_hash + request_hash + payload_hash + zoi).encode()
                ).hexdigest()
                deadline = self.calendar.submission_deadline(issued_at)
                self.s.db.execute(
                    """INSERT INTO receipts(operation_id,premise,device,number,issued_at,canonical,payload_hash,
                       zoi,xml,xml_hash,signature_b64,state,previous_hash,chain_hash,server_response,envelope_json)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                     (request.operationId, pp, b, sequence, issued_text, request_json, payload_hash, zoi, "",
                      payload_hash, base64.b64encode(zoi_signature).decode(), "PENDING", previous_hash, chain_hash,
                     None, envelope_json),
                )
                self.s.db.execute(
                    "INSERT INTO jobs VALUES(?,?,?,?,?,?,?)",
                    (str(uuid.uuid4()), request.operationId, 0, datetime.now(timezone.utc).isoformat(),
                     deadline.isoformat(), "PENDING", None),
                )
                # Receipt finalisation and its collaborative gateway event are
                # one SQLite transaction.  A print outage therefore cannot
                # create a second fiscal receipt or lose the order transition.
                order_id_value = plan["receipt"]["orderId"]
                source_order_ref = str(plan["receipt"].get("sourceOrderRef", order_id_value))
                order_id = (
                    int(order_id_value)
                    if order_id_value is not None and str(order_id_value).lstrip("-").isdigit()
                    else source_order_ref
                )
                v2_order_scope = {
                    "companyId": str(request.authorityBundle.get("server", {}).get("companyId", "")),
                    "enotaId": str(request.authorityBundle.get("server", {}).get("enotaId", "")),
                }
                is_v2_order = isinstance(order_id, str) and bool(v2_order_scope["companyId"] and v2_order_scope["enotaId"])
                snapshot_version = int(request.orderEventSnapshot.get("orderVersion", 0))
                order_row = self.s.db.execute(
                    ("SELECT * FROM gateway_v2_orders WHERE order_id=? AND company_id=? AND enota_id=?"
                     if is_v2_order else "SELECT * FROM order_projections WHERE order_id=?"),
                    ((order_id, v2_order_scope["companyId"], v2_order_scope["enotaId"])
                     if is_v2_order else (order_id,)),
                ).fetchone()
                current_version = int(order_row["version"]) if order_row else snapshot_version
                if actor is not None and order_row and current_version != snapshot_version:
                    raise HTTPException(409, detail=json.dumps({
                        "code": "VERSION_CONFLICT", "currentVersion": current_version,
                        "currentProjection": json.loads(order_row["projection_json"])}))
                if actor is not None and order_row and order_row["owner_client_id"] and actor and \
                        order_row["owner_client_id"] != actor and order_row["lease_until"] and \
                        datetime.fromisoformat(order_row["lease_until"].replace("Z", "+00:00")) > datetime.now(timezone.utc):
                    raise HTTPException(409, "ORDER_LEASE_CONFLICT")
                next_version = current_version + 1
                projection = dict(json.loads(order_row["projection_json"]) if order_row else {})
                projection.update({"orderId": order_id,
                                   "state": "OPEN" if not plan["closure"].get("closeOrder") else "CLOSED",
                                   "status": "zakljuceno" if plan["closure"].get("closeOrder") else projection.get("status", "odprto"),
                                   "lastReceiptOperationId": request.operationId})
                closed = bool(plan["closure"].get("closeOrder"))
                lease_until = None if closed else (order_row["lease_until"] if order_row else None)
                owner = None if closed else (actor or (order_row["owner_client_id"] if order_row else None))
                if is_v2_order:
                    self.s.db.execute(
                        "UPDATE gateway_v2_orders SET version=?,state=?,projection_json=?,"
                        "owner_client_id=?,lease_until=? WHERE order_id=? AND company_id=? AND enota_id=?",
                        (next_version, projection["state"], canonical_json(projection), owner, lease_until,
                         order_id, v2_order_scope["companyId"], v2_order_scope["enotaId"]),
                    )
                    table_id = (projection.get("tableId") or projection.get("mizaId")) if closed else None
                    if table_id is not None:
                        table_row = self.s.db.execute(
                            "SELECT * FROM gateway_v2_tables WHERE table_id=? AND company_id=? AND enota_id=?",
                            (str(table_id), v2_order_scope["companyId"], v2_order_scope["enotaId"]),
                        ).fetchone()
                        if table_row:
                            table_projection = json.loads(table_row["projection_json"])
                            active_ids = [
                                str(value) for value in table_projection.get("activeOrderIds", [])
                                if str(value) != str(order_id)
                            ]
                            table_projection["activeOrderIds"] = active_ids
                            table_projection["status"] = "occupied" if active_ids else "available"
                            self.s.db.execute(
                                "UPDATE gateway_v2_tables SET version=?,status=?,projection_json=? "
                                "WHERE table_id=? AND company_id=? AND enota_id=?",
                                (int(table_row["version"]) + 1, table_projection["status"],
                                 canonical_json(table_projection), str(table_id),
                                 v2_order_scope["companyId"], v2_order_scope["enotaId"]),
                            )
                    if closed:
                        kds_rows = self.s.db.execute(
                            "SELECT job_id,version,state,payload_json FROM kds_jobs "
                            "WHERE (order_id=? OR json_extract(payload_json, '$.orderId')=?) "
                            "AND state NOT IN ('COMPLETED','CANCELLED')",
                            (str(order_id), str(order_id)),
                        ).fetchall()
                        for kds_row in kds_rows:
                            self.s.db.execute(
                                "UPDATE kds_jobs SET version=?,state='CANCELLED',updated_at=? WHERE job_id=?",
                                (int(kds_row["version"]) + 1, _gateway_now(), kds_row["job_id"]),
                            )
                            cancel_op = f"{request.operationId}:kds-cancel:{kds_row['job_id']}"
                            append_internal_event(
                                self.s, cancel_op, "kds-cancelled",
                                {"orderId": order_id, "jobId": kds_row["job_id"],
                                 "previousState": kds_row["state"]},
                                {"jobId": kds_row["job_id"], "state": "CANCELLED"},
                            )
                else:
                    self.s.db.execute(
                        "INSERT INTO order_projections(order_id,version,state,projection_json,owner_client_id,lease_until)"
                        " VALUES(?,?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET version=excluded.version,"
                        "state=excluded.state,projection_json=excluded.projection_json,owner_client_id=excluded.owner_client_id,"
                        "lease_until=excluded.lease_until",
                        (order_id, next_version, projection["state"], canonical_json(projection), owner, lease_until))
                self.s.db.execute(
                    "INSERT INTO entity_versions(entity_type,entity_id,version) VALUES('order',?,?) "
                    "ON CONFLICT(entity_type,entity_id) DO UPDATE SET version=excluded.version",
                    (str(order_id), next_version))
                effect_time = _gateway_now()
                for effect_index, effect in enumerate(plan.get("kds", {}).get("effects", [])):
                    kds_id = f"{request.operationId}:kds:{effect_index}"
                    self.s.db.execute(
                        "INSERT OR IGNORE INTO kds_jobs(job_id,version,state,payload_json,created_at,updated_at)"
                        " VALUES(?,?,?,?,?,?)",
                        (kds_id, 1, "QUEUED", canonical_json({
                            "operationId": request.operationId, "orderId": order_id, "effect": effect}), effect_time, effect_time))
                print_id = f"{request.operationId}:print"
                self.s.db.execute(
                    "INSERT OR IGNORE INTO print_jobs(job_id,version,state,payload_json,attempts,created_at,updated_at)"
                    " VALUES(?,?,?,?,?,?,?)",
                    (print_id, 1, "QUEUED", canonical_json({
                        "operationId": request.operationId, "receiptNumber": plan["receipt"]["legalNumber"]}),
                     0, effect_time, effect_time))
                gateway_payload = {
                    "operationId": request.operationId, "orderId": order_id,
                    "expectedVersion": snapshot_version, "newVersion": next_version,
                    "payloadHash": request_hash, "envelope": envelope,
                }
                append_internal_event(
                    self.s, request.operationId, "receipt-issued", gateway_payload,
                    {"operationId": request.operationId, "receiptIssued": True,
                     "orderVersion": next_version})
                self.s.db.execute("COMMIT")
            except Exception:
                self.s.db.execute("ROLLBACK")
                raise
        return envelope

    def render_legal_receipt(self, envelope: dict[str, Any], reprint: bool = False) -> str:
        payload = envelope["canonicalPayload"]
        plan, legal_invoice = payload["finalizationPlan"], payload["legalInvoice"]
        receipt, totals = plan["receipt"], plan["totals"]
        meta = json.loads(self.s.get("metadata") or b"{}")
        lines = ([("*** PONOVNI IZPIS ***" if reprint else "DAVCNO POTRJEN RACUN"),
                  meta.get("businessName", ""), f"Davcna: {meta.get('taxNumber', '')}",
                  f"Racun: {receipt['legalNumber']}", f"Datum: {receipt['issuedAt']}"] +
                 [f"{line['name']}  {line['quantity']} x {line['unitGross']:.2f}  {line['gross']:.2f}"
                  for line in plan["soldLines"]] +
                 [f"SKUPAJ EUR: {totals['gross']:.2f}", "Placilo: GOTOVINA",
                  f"Operater: {plan['operator'].get('name') or ''} ({plan['operator'].get('taxNumber') or ''})"] +
                 [f"DDV {group['rate']:.2f}%: {group['vat']:.2f}" for group in totals["vatGroups"]] +
                  [f"ZOI: {legal_invoice['zoi']}", "EOR: NI DODELJEN - naknadna predlozitev"])
        return "\n".join(line for line in lines if line)

    def process_print_jobs(self, max_attempts: int = 3) -> int:
        """Single-worker durable spool processing; never issue a second receipt."""
        processed = 0
        rows = self.s.db.execute(
            "SELECT * FROM print_jobs WHERE (state IN ('QUEUED','RETRY') AND attempts<?) OR "
            "(state='PROCESSING' AND lease_until<?) ORDER BY created_at LIMIT 20",
            (max_attempts, _gateway_now())).fetchall()
        for row in rows:
            with self.s.lock:
                current = self.s.db.execute(
                    "SELECT * FROM print_jobs WHERE job_id=? AND version=?",
                    (row["job_id"], row["version"])).fetchone()
                if not current:
                    continue
                if current["state"] == "PROCESSING" and current["spool_job_id"]:
                    # The Windows spooler can only be queried authoritatively by
                    # the platform adapter. Unknown outcome is never replayed.
                    self.s.db.execute(
                        "UPDATE print_jobs SET state='NEEDS_REVIEW',version=version+1,updated_at=?,lease_until=NULL WHERE job_id=?",
                        (_gateway_now(), row["job_id"]))
                    continue
                self.s.db.execute(
                    "UPDATE print_jobs SET state='PROCESSING',version=version+1,lease_until=?,updated_at=? WHERE job_id=?",
                    ((_gateway_now()), _gateway_now(), row["job_id"]))
            receipt = self.s.db.execute(
                "SELECT envelope_json FROM receipts WHERE operation_id=?",
                (json.loads(row["payload_json"])["operationId"],)).fetchone()
            allocated = False
            def allocated_job(job_id: str) -> None:
                nonlocal allocated
                allocated = True
                with self.s.lock:
                    self.s.db.execute(
                        "UPDATE print_jobs SET spool_job_id=?,updated_at=? WHERE job_id=? AND state='PROCESSING'",
                        (job_id, _gateway_now(), row["job_id"]))
            try:
                if not receipt:
                    raise RuntimeError("SEALED_RECEIPT_MISSING")
                text = self.render_legal_receipt(
                    json.loads(receipt["envelope_json"]),
                    reprint=bool(json.loads(row["payload_json"]).get("reprint")),
                )
                if hasattr(self.printer, "allocate_and_print"):
                    self.printer.allocate_and_print(text, allocated_job)  # type: ignore[attr-defined]
                else:
                    self.printer.print_receipt(text)
                state, detail = "ACKED", None
            except Exception as error:
                attempts = int(row["attempts"]) + 1
                state = "NEEDS_REVIEW" if allocated or attempts >= max_attempts else "RETRY"
                detail = str(error)[:500]
            with self.s.lock:
                attempts = int(row["attempts"]) + (0 if state == "ACKED" else 1)
                operation_id = json.loads(row["payload_json"])["operationId"]
                self.s.db.execute(
                    "INSERT INTO print_attempts(operation_id,at,success,detail) VALUES(?,?,?,?)",
                    (operation_id, _gateway_now(), 1 if state == "ACKED" else 0,
                     detail or "spool acknowledged"))
                self.s.db.execute(
                    "UPDATE print_jobs SET state=?,version=version+1,attempts=?,lease_until=NULL,updated_at=? "
                    "WHERE job_id=? AND state='PROCESSING'",
                    (state, attempts, _gateway_now(), row["job_id"]))
            processed += 1
        return processed


def _gateway_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _diagnostic_time(value: datetime | None = None) -> str:
    """Human-facing diagnostics use the Slovenian date format."""
    return (value or datetime.now()).astimezone(ZoneInfo("Europe/Ljubljana")).strftime("%d.%m.%Y %H:%M")


def append_internal_event(store: Store, operation_id: str, event_type: str,
                          payload: dict[str, Any], response: dict[str, Any] | None = None) -> dict[str, Any]:
    """Append an internally generated event with its canonical payload hash."""
    payload_hash = hashlib.sha256(canonical_json(payload).encode()).hexdigest()
    return Gateway(store)._event(operation_id, payload_hash, event_type, payload, response or {})


class Gateway:
    """SQLite-backed LAN single-writer projections.

    This deliberately shares Store and its WAL/FULL connection with fiscal
    issuance.  Gateway events are append-only; projections are disposable and
    can be rebuilt from them during a future migration.
    """
    def __init__(self, store: Store):
        self.s = store

    def _event(self, operation_id: str, payload_hash: str, event_type: str,
               payload: dict[str, Any], response: dict[str, Any]) -> dict[str, Any]:
        payload_hash = hashlib.sha256(canonical_json(payload).encode()).hexdigest()
        existing = self.s.db.execute(
            "SELECT payload_hash,payload_json FROM gateway_events WHERE operation_id=?",
            (operation_id,)).fetchone()
        if existing:
            if existing["payload_hash"] != payload_hash:
                raise HTTPException(409, "OPERATION_PAYLOAD_MISMATCH")
            return json.loads(existing["payload_json"])["response"]
        envelope = {"payload": payload, "response": response}
        self.s.db.execute(
            "INSERT INTO gateway_events(operation_id,payload_hash,event_type,payload_json,created_at)"
            " VALUES(?,?,?,?,?)",
            (operation_id, payload_hash, event_type, canonical_json(envelope), _gateway_now()),
        )
        return response

    def _version(self, entity_type: str, entity_id: int) -> int:
        row = self.s.db.execute(
            "SELECT version FROM entity_versions WHERE entity_type=? AND entity_id=?",
            (entity_type, str(entity_id))).fetchone()
        return int(row["version"]) if row else 0

    def _set_version(self, entity_type: str, entity_id: int, version: int) -> None:
        self.s.db.execute(
            "INSERT INTO entity_versions(entity_type,entity_id,version) VALUES(?,?,?) "
            "ON CONFLICT(entity_type,entity_id) DO UPDATE SET version=excluded.version",
            (entity_type, str(entity_id), version))

    def command(self, cmd: GatewayCommandIn, actor: str | None, event_type: str) -> dict[str, Any]:
        raw = cmd.model_dump(mode="json")
        payload_hash = hashlib.sha256(canonical_json(raw).encode()).hexdigest()
        with self.s.lock:
            self.s.db.execute("BEGIN IMMEDIATE")
            try:
                if cmd.forceTransfer:
                    role = self.s.db.execute("SELECT role FROM clients WHERE client_id=? AND active=1",
                                             (actor,)).fetchone() if actor else None
                    if not role or role["role"] != "manager":
                        raise HTTPException(403, "MANAGER_REQUIRED")
                old = self.s.db.execute(
                    "SELECT payload_hash,payload_json FROM gateway_events WHERE operation_id=?",
                    (cmd.operationId,)).fetchone()
                if old:
                    if old["payload_hash"] != payload_hash:
                        raise HTTPException(409, "OPERATION_PAYLOAD_MISMATCH")
                    self.s.db.execute("COMMIT")
                    return json.loads(old["payload_json"])["response"]
                order_id = cmd.orderId
                # The legacy MVP table is INTEGER-keyed.  Never let a v2
                # UUID reach this path; v2 callers use gateway_v2_orders.
                if order_id is not None and (
                        not isinstance(order_id, int) or isinstance(order_id, bool)):
                    raise HTTPException(422, "V2_UUID_REQUIRES_SCOPED_GATEWAY")
                if order_id is not None:
                    current = self._version("order", order_id)
                    row = self.s.db.execute(
                        "SELECT * FROM order_projections WHERE order_id=?", (order_id,)).fetchone()
                    if cmd.expectedVersion != current:
                        projection = json.loads(row["projection_json"]) if row else {}
                        raise HTTPException(409, detail=json.dumps({
                            "code": "VERSION_CONFLICT", "currentVersion": current,
                            "currentProjection": projection}))
                    now = datetime.now(timezone.utc)
                    if row and row["owner_client_id"] and row["owner_client_id"] != actor and \
                            row["lease_until"] and datetime.fromisoformat(row["lease_until"].replace("Z", "+00:00")) > now \
                            and not cmd.forceTransfer:
                        raise HTTPException(409, detail=json.dumps({
                            "code": "ORDER_LEASE_CONFLICT", "currentVersion": current,
                            "ownerClientId": row["owner_client_id"],
                            "leaseUntil": row["lease_until"]}))
                    version = current + 1
                    projection = dict(json.loads(row["projection_json"]) if row else {})
                    projection.update(cmd.payload)
                    projection.update({"orderId": order_id, "state": cmd.status or
                                       projection.get("state", "OPEN")})
                    owner = actor or (row["owner_client_id"] if row else None)
                    lease_until = (datetime.now(timezone.utc) + timedelta(seconds=cmd.leaseSeconds)
                                   ).isoformat().replace("+00:00", "Z") if owner else None
                    self.s.db.execute(
                        "INSERT INTO order_projections(order_id,version,state,projection_json,owner_client_id,lease_until)"
                        " VALUES(?,?,?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET version=excluded.version,"
                        "state=excluded.state,projection_json=excluded.projection_json,owner_client_id=excluded.owner_client_id,"
                        "lease_until=excluded.lease_until",
                        (order_id, version, projection["state"], canonical_json(projection), owner, lease_until))
                    self._set_version("order", order_id, version)
                    response = {"orderId": order_id, "version": version, "projection": projection,
                                "ownerClientId": owner, "leaseUntil": lease_until}
                    if cmd.forceTransfer:
                        event_type = "manager-force-transfer"
                elif cmd.tableId is not None:
                    current = self._version("table", cmd.tableId)
                    if cmd.expectedVersion != current:
                        row = self.s.db.execute(
                            "SELECT projection_json FROM table_projections WHERE table_id=?",
                            (cmd.tableId,)).fetchone()
                        raise HTTPException(409, detail=json.dumps({
                            "code": "VERSION_CONFLICT", "currentVersion": current,
                            "currentProjection": json.loads(row["projection_json"]) if row else {}}))
                    version = current + 1
                    projection = dict(cmd.payload)
                    projection.update({"tableId": cmd.tableId, "status": cmd.status or "available"})
                    self.s.db.execute(
                        "INSERT INTO table_projections(table_id,version,status,projection_json) VALUES(?,?,?,?)"
                        " ON CONFLICT(table_id) DO UPDATE SET version=excluded.version,status=excluded.status,"
                        "projection_json=excluded.projection_json",
                        (cmd.tableId, version, projection["status"], canonical_json(projection)))
                    self._set_version("table", cmd.tableId, version)
                    response = {"tableId": cmd.tableId, "version": version, "projection": projection}
                else:
                    response = {"operationId": cmd.operationId, "accepted": True}
                result = self._event(cmd.operationId, payload_hash, event_type, raw, response)
                self.s.db.execute("COMMIT")
                return result
            except Exception:
                self.s.db.execute("ROLLBACK")
                raise
    def append_job(self, cmd: GatewayCommandIn, actor: str | None, kind: str) -> dict[str, Any]:
        raw = cmd.model_dump(mode="json")
        payload_hash = hashlib.sha256(canonical_json(raw).encode()).hexdigest()
        job_id = cmd.jobId or str(uuid.uuid4())
        with self.s.lock:
            self.s.db.execute("BEGIN IMMEDIATE")
            try:
                old = self.s.db.execute(
                    "SELECT payload_hash,payload_json FROM gateway_events WHERE operation_id=?",
                    (cmd.operationId,)).fetchone()
                if old:
                    if old["payload_hash"] != payload_hash:
                        raise HTTPException(409, "OPERATION_PAYLOAD_MISMATCH")
                    self.s.db.execute("COMMIT")
                    return json.loads(old["payload_json"])["response"]
                now = _gateway_now()
                table = "kds_jobs" if kind == "kds" else "print_jobs"
                self.s.db.execute(
                    f"INSERT OR IGNORE INTO {table}(job_id,version,state,payload_json,created_at,updated_at)"
                    " VALUES(?,?,?,?,?,?)",
                    (job_id, 1, "QUEUED", canonical_json({
                        "operationId": cmd.operationId, "payload": cmd.payload}), now, now))
                response = {"jobId": job_id, "version": 1, "state": "QUEUED", "kind": kind}
                self._event(cmd.operationId, payload_hash, f"{kind}-enqueue", raw, response)
                self.s.db.execute("COMMIT")
                return response
            except Exception:
                self.s.db.execute("ROLLBACK")
                raise

    def ack_job(self, cmd: GatewayAckIn, kind: str, state: str, actor: str | None = None) -> dict[str, Any]:
        raw = cmd.model_dump(mode="json")
        payload_hash = hashlib.sha256(canonical_json(raw).encode()).hexdigest()
        table = "kds_jobs" if kind == "kds" else "print_jobs"
        with self.s.lock:
            self.s.db.execute("BEGIN IMMEDIATE")
            try:
                old = self.s.db.execute(
                    "SELECT payload_hash,payload_json FROM gateway_events WHERE operation_id=?",
                    (cmd.operationId,)).fetchone()
                if old:
                    if old["payload_hash"] != payload_hash:
                        raise HTTPException(409, "OPERATION_PAYLOAD_MISMATCH")
                    self.s.db.execute("COMMIT")
                    return json.loads(old["payload_json"])["response"]
                row = self.s.db.execute(f"SELECT * FROM {table} WHERE job_id=?", (cmd.jobId,)).fetchone()
                if not row:
                    raise HTTPException(404, "JOB_NOT_FOUND")
                if state == "RETRY":
                    role = self.s.db.execute("SELECT role FROM clients WHERE client_id=? AND active=1",
                                             (actor,)).fetchone() if actor else None
                    if not role or role["role"] != "manager":
                        raise HTTPException(403, "MANAGER_REQUIRED")
                if cmd.expectedVersion != int(row["version"]):
                    raise HTTPException(409, "JOB_VERSION_CONFLICT")
                allowed = {
                    "QUEUED": {"PROCESSING", "RETRY", "NEEDS_REVIEW", "BUMPED"},
                    "PROCESSING": {"ACKED", "RETRY", "NEEDS_REVIEW", "BUMPED"},
                    "RETRY": {"PROCESSING", "NEEDS_REVIEW"},
                    "ACKED": set(), "NEEDS_REVIEW": set(), "BUMPED": {"PROCESSING", "ACKED"},
                }
                if state not in allowed.get(row["state"], set()):
                    raise HTTPException(409, "INVALID_JOB_STATE")
                version = int(row["version"]) + 1
                self.s.db.execute(
                    f"UPDATE {table} SET version=?,state=?,updated_at=? WHERE job_id=?",
                    (version, state, _gateway_now(), cmd.jobId))
                response = {"jobId": cmd.jobId, "version": version, "state": state}
                self._event(cmd.operationId, payload_hash, f"{kind}-{state.lower()}", raw, response)
                self.s.db.execute("COMMIT")
                return response
            except Exception:
                self.s.db.execute("ROLLBACK")
                raise

    def snapshot(self) -> dict[str, Any]:
        with self.s.lock:
            orders = [dict(row) for row in self.s.db.execute(
                "SELECT order_id AS orderId,version,state,projection_json,owner_client_id AS ownerClientId,lease_until AS leaseUntil,"
                "local_id AS localId,company_id AS companyId,enota_id AS enotaId,lease_id AS leaseId,"
                "fencing_version AS fencingVersion "
                "FROM order_projections ORDER BY order_id")]
            for item in orders: item["projection"] = json.loads(item.pop("projection_json"))
            tables = [dict(row) for row in self.s.db.execute(
                "SELECT table_id AS tableId,version,status,projection_json,company_id AS companyId,"
                "enota_id AS enotaId FROM table_projections ORDER BY table_id")]
            for item in tables: item["projection"] = json.loads(item.pop("projection_json"))
            return {"orders": orders, "tables": tables,
                    "kdsJobs": [dict(r) for r in self.s.db.execute("SELECT * FROM kds_jobs ORDER BY created_at")],
                    "printJobs": [dict(r) for r in self.s.db.execute("SELECT * FROM print_jobs ORDER BY created_at")],
                    "lastEventSeq": self.s.db.execute("SELECT COALESCE(MAX(seq),0) FROM gateway_events").fetchone()[0]}


class GatewayV2(Gateway):
    """Strict, explicitly scoped POS collaboration boundary.

    The legacy ``Gateway`` methods above remain available for already paired
    fiscal clients.  POS collaboration uses this class exclusively: scope is
    taken from the signed provisioning bundle, leases fence writers, and a
    complete order snapshot is the only editing primitive.
    """

    def scope(self, supplied_company: str | None, supplied_unit: int | str | None) -> dict[str, str]:
        metadata = json.loads(self.s.get("metadata") or b"{}")
        bundle = json.loads(self.s.get("provisioning_bundle") or b"{}")
        device = bundle.get("device", {}) if isinstance(bundle, dict) else {}
        company = str(device.get("companyId") or metadata.get("companyId") or "")
        unit = str(device.get("enotaId") or metadata.get("enotaId") or "")
        if not bundle or not company or not unit:
            raise HTTPException(503, "PROVISIONING_SCOPE_MISSING")
        if supplied_company is not None and str(supplied_company) != company:
            raise HTTPException(409, "CROSS_SCOPE_COMMAND")
        if supplied_unit is not None and str(supplied_unit) != unit:
            raise HTTPException(409, "CROSS_SCOPE_COMMAND")
        return {"companyId": company, "enotaId": unit}

    def snapshot(self, scope: dict[str, str]) -> dict[str, Any]:
        """Read only v2 tables; legacy integer projections are never exposed."""
        with self.s.lock:
            orders = [dict(row) for row in self.s.db.execute(
                "SELECT order_id AS orderId,version,state,projection_json,"
                "owner_client_id AS ownerClientId,lease_until AS leaseUntil,"
                "local_id AS localId,company_id AS companyId,enota_id AS enotaId,"
                "lease_id AS leaseId,fencing_version AS fencingVersion "
                "FROM gateway_v2_orders WHERE company_id=? AND enota_id=? ORDER BY order_id",
                (scope["companyId"], scope["enotaId"]),
            )]
            for item in orders:
                item["projection"] = json.loads(item.pop("projection_json"))
            tables = [dict(row) for row in self.s.db.execute(
                "SELECT table_id AS tableId,version,status,projection_json,"
                "company_id AS companyId,enota_id AS enotaId "
                "FROM gateway_v2_tables WHERE company_id=? AND enota_id=? ORDER BY table_id",
                (scope["companyId"], scope["enotaId"]),
            )]
            for item in tables:
                item["projection"] = json.loads(item.pop("projection_json"))
            return {
                "orders": orders, "tables": tables, "kdsJobs": self.list_kds(scope),
                "printJobs": [], "lastEventSeq": self.s.db.execute(
                    "SELECT COALESCE(MAX(seq),0) FROM gateway_events").fetchone()[0],
            }

    @staticmethod
    def _uuid(value: Any, label: str) -> str:
        try:
            return str(uuid.UUID(str(value)))
        except (ValueError, AttributeError, TypeError) as exc:
            raise HTTPException(422, f"{label}_MUST_BE_UUID") from exc

    @staticmethod
    def _validate_money(value: Any, key: str) -> None:
        if isinstance(value, bool) or not isinstance(value, (str, int, float)):
            raise HTTPException(422, f"INVALID_MONEY:{key}")
        try:
            decimal = Decimal(str(value))
            if not decimal.is_finite():
                raise ValueError
        except (ValueError, ArithmeticError):
            raise HTTPException(422, f"INVALID_MONEY:{key}")

    def validate_snapshot(self, snapshot: dict[str, Any], order_id: str,
                          scope: dict[str, str]) -> dict[str, Any]:
        if not isinstance(snapshot, dict):
            raise HTTPException(422, "ORDER_SNAPSHOT_REQUIRED")
        immutable = snapshot.get("orderId", order_id)
        if str(immutable) != str(order_id):
            raise HTTPException(422, "ORDER_ID_IMMUTABLE")
        if str(snapshot.get("companyId", scope["companyId"])) != scope["companyId"] or \
                str(snapshot.get("enotaId", scope["enotaId"])) != scope["enotaId"]:
            raise HTTPException(409, "CROSS_SCOPE_COMMAND")
        status = snapshot.get("status", snapshot.get("state", "open"))
        if status not in {"open", "OPEN", "closed", "CLOSED", "cancelled", "CANCELLED"}:
            raise HTTPException(422, "ORDER_STATUS_INVALID")
        for key, value in snapshot.items():
            if key.lower() in {"total", "skupaj", "price", "cena", "unitprice", "cenakos",
                               "tax", "ddv", "vat", "discount", "popust"}:
                self._validate_money(value, key)
        lines = snapshot.get("lines", snapshot.get("postavke", []))
        if not isinstance(lines, list):
            raise HTTPException(422, "ORDER_LINES_INVALID")
        seen: set[str] = set()
        for line in lines:
            if not isinstance(line, dict):
                raise HTTPException(422, "ORDER_LINE_INVALID")
            line_id = line.get("lineId", line.get("id"))
            if line_id is None:
                raise HTTPException(422, "ORDER_LINE_ID_REQUIRED")
            line_key = str(line_id)
            if line_key in seen:
                raise HTTPException(422, "ORDER_LINE_ID_DUPLICATE")
            seen.add(line_key)
            stations = line.get("postajaIds")
            if stations is not None and (not isinstance(stations, list)
                    or any(not isinstance(station, int) or station < 1 for station in stations)
                    or len(set(stations)) != len(stations)):
                raise HTTPException(422, "ORDER_LINE_STATIONS_INVALID")
            if "postajaId" in line and (not isinstance(line["postajaId"], int) or line["postajaId"] < 1):
                raise HTTPException(422, "ORDER_LINE_STATION_INVALID")
            for key, value in line.items():
                if key.lower() in {"total", "skupaj", "price", "cena", "unitprice", "cenakos",
                                   "tax", "ddv", "vat", "quantity", "kolicina"}:
                    self._validate_money(value, key)
        return snapshot

    @staticmethod
    def _canonicalize_prime_order(order: dict[str, Any]) -> dict[str, Any]:
        """Store one gateway line representation, including cloud row identity."""
        result = dict(order)
        order_id = str(order.get("orderId"))
        nested = order.get("projection")
        base = dict(nested) if isinstance(nested, dict) else result
        source = base.get("lines")
        if not isinstance(source, list):
            source = base.get("postavke", [])
        lines: list[dict[str, Any]] = []
        seen: set[str] = set()
        for raw in source if isinstance(source, list) else []:
            if not isinstance(raw, dict):
                raise HTTPException(422, "ORDER_LINE_INVALID")
            cloud_line_id = raw.get("cloudLineId", raw.get("id"))
            if not isinstance(cloud_line_id, int) or cloud_line_id < 1:
                cloud_line_id = None
            line_id = str(raw.get("lineId") or (
                f"cloud:{order_id}:{cloud_line_id}" if cloud_line_id is not None else uuid.uuid4()
            ))
            if line_id in seen:
                raise HTTPException(422, "ORDER_LINE_ID_DUPLICATE")
            seen.add(line_id)
            line = dict(raw)
            line["lineId"] = line_id
            line["cloudLineId"] = cloud_line_id
            lines.append(line)
        base["lines"] = lines
        base.pop("postavke", None)
        if isinstance(nested, dict):
            result["projection"] = base
        result["lines"] = lines
        result.pop("postavke", None)
        return result

    def _lease(self, row: sqlite3.Row | None, order_id: str, actor: str | None,
               lease_id: str | None, fencing: int | None) -> None:
        now = datetime.now(timezone.utc)
        if not actor:
            raise HTTPException(401, "CLIENT_REQUIRED")
        if not row:
            raise HTTPException(409, "ORDER_NOT_FOUND")
        until = row["lease_until"]
        current_lease = row["lease_id"]
        current_fencing = int(row["fencing_version"] or 0)
        if not current_lease or not until or datetime.fromisoformat(until.replace("Z", "+00:00")) <= now:
            raise HTTPException(409, detail=json.dumps({
                "code": "LEASE_EXPIRED", "ownerClientId": row["owner_client_id"],
                "leaseUntil": until, "currentVersion": row["version"],
            }))
        if current_lease != lease_id or row["owner_client_id"] != actor or \
                fencing is None or int(fencing) != current_fencing:
            raise HTTPException(409, detail=json.dumps({
                "code": "ORDER_LEASE_CONFLICT", "ownerClientId": row["owner_client_id"],
                "leaseUntil": until, "fencingVersion": current_fencing,
                "currentVersion": row["version"],
            }))

    def _table_projection(self, table_id: str, scope: dict[str, str]) -> sqlite3.Row | None:
        return self.s.db.execute(
            "SELECT * FROM gateway_v2_tables WHERE table_id=? AND company_id=? AND enota_id=?",
            (str(table_id), scope["companyId"], scope["enotaId"]),
        ).fetchone()

    def _update_tables(self, old_table: Any, new_table: Any, order_id: str,
                       status: str, scope: dict[str, str]) -> None:
        tables = [str(value) for value in {old_table, new_table} if value is not None]
        for table in tables:
            key = table
            row = self.s.db.execute(
                "SELECT * FROM gateway_v2_tables WHERE table_id=? AND company_id=? AND enota_id=?",
                (key, scope["companyId"], scope["enotaId"]),
            ).fetchone()
            projection = json.loads(row["projection_json"]) if row else {}
            active = [str(item) for item in projection.get("activeOrderIds", []) if str(item) != order_id]
            if table == str(new_table) and status.lower() not in {"closed", "cancelled"}:
                active.append(order_id)
            projection.update({"tableId": table, "activeOrderIds": active, "status": "occupied" if active else "available"})
            version = int(row["version"]) + 1 if row else 1
            self.s.db.execute(
                "INSERT INTO gateway_v2_tables(table_id,version,status,projection_json,company_id,enota_id) "
                "VALUES(?,?,?,?,?,?) ON CONFLICT(company_id,enota_id,table_id) DO UPDATE SET version=excluded.version,"
                "status=excluded.status,projection_json=excluded.projection_json,"
                "company_id=excluded.company_id,enota_id=excluded.enota_id",
                (key, version, projection["status"], canonical_json(projection),
                 scope["companyId"], scope["enotaId"]))

    def _upsert_table_projection(self, table_id: str, status: str,
                                 active_order_ids: list[str], scope: dict[str, str]) -> None:
        """Prime a table directly; table bootstrap must not fake an order ID."""
        row = self._table_projection(table_id, scope)
        projection = json.loads(row["projection_json"]) if row else {}
        active = [str(value) for value in active_order_ids]
        projection.update({
            "tableId": str(table_id), "activeOrderIds": active,
            "status": "occupied" if active else ("available" if status.lower() in {"free", "available", "prosta"} else status),
        })
        version = int(row["version"]) + 1 if row else 1
        self.s.db.execute(
            "INSERT INTO gateway_v2_tables(table_id,version,status,projection_json,company_id,enota_id) "
            "VALUES(?,?,?,?,?,?) ON CONFLICT(company_id,enota_id,table_id) DO UPDATE SET "
            "version=excluded.version,status=excluded.status,projection_json=excluded.projection_json",
            (str(table_id), version, projection["status"], canonical_json(projection),
             scope["companyId"], scope["enotaId"]),
        )

    def consume_transfer_approval(self, code: str, order_id: str,
                                  target_client_id: str, fencing_version: int) -> None:
        digest = hashlib.sha256(code.encode()).hexdigest()
        row = self.s.db.execute(
            "SELECT * FROM gateway_transfer_approvals WHERE approval_hash=?", (digest,)
        ).fetchone()
        if not row or row["order_id"] != order_id or row["target_client_id"] != target_client_id \
                or int(row["fencing_version"]) != int(fencing_version) \
                or row["expires_at"] <= _gateway_now():
            raise HTTPException(403, "TRANSFER_APPROVAL_INVALID_OR_EXPIRED")
        self.s.db.execute("DELETE FROM gateway_transfer_approvals WHERE approval_hash=?", (digest,))

    def acquire_lease(self, req: GatewayLeaseIn, actor: str | None, scope: dict[str, str],
                      force: bool = False) -> dict[str, Any]:
        order = str(req.orderId)
        command_hash = hashlib.sha256(canonical_json(req.model_dump(mode="json")).encode()).hexdigest()
        with self.s.lock:
            self.s.db.execute("BEGIN IMMEDIATE")
            try:
                prior = self.s.db.execute(
                    "SELECT payload_hash,payload_json FROM gateway_events WHERE operation_id=?",
                    (req.commandId,)).fetchone()
                if prior:
                    if prior["payload_hash"] != command_hash:
                        raise HTTPException(409, "OPERATION_PAYLOAD_MISMATCH")
                    self.s.db.execute("COMMIT")
                    return json.loads(prior["payload_json"])["response"]
                row = self.s.db.execute(
                    "SELECT * FROM gateway_v2_orders WHERE order_id=? AND company_id=? AND enota_id=?",
                    (order, scope["companyId"], scope["enotaId"]),
                ).fetchone()
                current = int(row["version"]) if row else 0
                if force:
                    if not req.approvalCode:
                        raise HTTPException(403, "TRANSFER_APPROVAL_REQUIRED")
                    self.consume_transfer_approval(req.approvalCode, order, str(actor), int(row["fencing_version"]) if row else 0)
                if req.expectedVersion != current:
                    raise HTTPException(409, "VERSION_CONFLICT")
                now = datetime.now(timezone.utc)
                active = row and row["lease_until"] and datetime.fromisoformat(
                    row["lease_until"].replace("Z", "+00:00")) > now
                if active and row["owner_client_id"] != actor and not force:
                    raise HTTPException(409, detail=json.dumps({
                        "code": "ORDER_LEASE_CONFLICT", "ownerClientId": row["owner_client_id"],
                        "leaseUntil": row["lease_until"], "currentVersion": current,
                    }))
                fencing = (int(row["fencing_version"] or 0) + 1) if row else 1
                lease_id = str(uuid.uuid4())
                until = (now + timedelta(seconds=req.leaseSeconds)).isoformat().replace("+00:00", "Z")
                if row:
                    self.s.db.execute(
                        "UPDATE gateway_v2_orders SET owner_client_id=?,lease_until=?,"
                        "lease_id=?,fencing_version=? WHERE order_id=? AND company_id=? AND enota_id=?",
                        (actor, until, lease_id, fencing, order,
                         scope["companyId"], scope["enotaId"]),
                    )
                else:
                    self.s.db.execute(
                        "INSERT INTO gateway_v2_orders(order_id,version,state,projection_json,owner_client_id,"
                        "lease_until,local_id,company_id,enota_id,lease_id,fencing_version) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                        (order, 0, "OPEN", canonical_json({"orderId": order}), actor, until,
                         order, scope["companyId"], scope["enotaId"], lease_id, fencing))
                response = {"orderId": order, "version": current, "leaseId": lease_id,
                            "fencingVersion": fencing, "leaseUntil": until, "ownerClientId": actor}
                self._event(req.commandId, command_hash,
                            "manager-force-transfer" if force else "order-lease-acquired",
                            {**req.model_dump(mode="json"), "scope": scope}, response)
                self.s.db.execute("COMMIT")
                return response
            except Exception:
                self.s.db.execute("ROLLBACK")
                raise

    def renew_lease(self, req: GatewayLeaseIn, actor: str | None,
                    scope: dict[str, str]) -> dict[str, Any]:
        order = str(req.orderId)
        with self.s.lock:
            row = self.s.db.execute(
                "SELECT * FROM gateway_v2_orders WHERE order_id=? AND company_id=? AND enota_id=?",
                (order, scope["companyId"], scope["enotaId"]),
            ).fetchone()
            self._lease(row, str(req.orderId), actor, req.leaseId, None if row is None else row["fencing_version"])
            if req.expectedVersion != int(row["version"]):
                raise HTTPException(409, "VERSION_CONFLICT")
            until = (datetime.now(timezone.utc) + timedelta(seconds=req.leaseSeconds)
                     ).isoformat().replace("+00:00", "Z")
            self.s.db.execute(
                "UPDATE gateway_v2_orders SET lease_until=? WHERE order_id=? AND company_id=? AND enota_id=?",
                (until, order, scope["companyId"], scope["enotaId"]),
            )
            return {"orderId": str(req.orderId), "version": row["version"],
                    "leaseId": row["lease_id"], "fencingVersion": row["fencing_version"],
                    "leaseUntil": until, "ownerClientId": actor}

    def release_lease(self, req: GatewayLeaseIn, actor: str | None,
                      scope: dict[str, str]) -> dict[str, Any]:
        order = str(req.orderId)
        with self.s.lock:
            row = self.s.db.execute(
                "SELECT * FROM gateway_v2_orders WHERE order_id=? AND company_id=? AND enota_id=?",
                (order, scope["companyId"], scope["enotaId"]),
            ).fetchone()
            self._lease(row, str(req.orderId), actor, req.leaseId, None if row is None else row["fencing_version"])
            self.s.db.execute(
                "UPDATE gateway_v2_orders SET lease_until=NULL,lease_id=NULL "
                "WHERE order_id=? AND company_id=? AND enota_id=?",
                (order, scope["companyId"], scope["enotaId"]),
            )
            return {"orderId": str(req.orderId), "version": row["version"], "released": True}

    def replace_snapshot(self, req: GatewaySnapshotIn, actor: str | None,
                         scope: dict[str, str], status: str = "OPEN") -> dict[str, Any]:
        order = str(req.orderId)
        snapshot = self.validate_snapshot(req.snapshot, order, scope)
        payload = req.model_dump(mode="json")
        event_payload = {**payload, "scope": scope}
        payload_hash = hashlib.sha256(canonical_json(event_payload).encode()).hexdigest()
        with self.s.lock:
            self.s.db.execute("BEGIN IMMEDIATE")
            try:
                old_event = self.s.db.execute("SELECT payload_hash,payload_json FROM gateway_events WHERE operation_id=?",
                                              (req.commandId,)).fetchone()
                if old_event:
                    if old_event["payload_hash"] != payload_hash:
                        raise HTTPException(409, "OPERATION_PAYLOAD_MISMATCH")
                    self.s.db.execute("COMMIT")
                    return json.loads(old_event["payload_json"])["response"]
                row = self.s.db.execute(
                    "SELECT * FROM gateway_v2_orders WHERE order_id=? AND company_id=? AND enota_id=?",
                    (order, scope["companyId"], scope["enotaId"]),
                ).fetchone()
                current = int(row["version"]) if row else 0
                self._lease(row, order, actor, req.leaseId, req.fencingVersion)
                if req.expectedVersion != current:
                    raise HTTPException(409, "VERSION_CONFLICT")
                previous = json.loads(row["projection_json"]) if row else {}
                next_version = current + 1
                state = str(snapshot.get("status", status)).upper()
                self.s.db.execute("UPDATE gateway_v2_orders SET version=?,state=?,projection_json=? "
                                  "WHERE order_id=? AND company_id=? AND enota_id=?",
                                  (next_version, state, canonical_json(snapshot), order,
                                   scope["companyId"], scope["enotaId"]))
                self._update_tables(previous.get("tableId"), snapshot.get("tableId"), order, state, scope)
                response = {"orderId": order, "version": next_version, "projection": snapshot,
                            "leaseId": req.leaseId, "fencingVersion": req.fencingVersion}
                self._event(req.commandId, payload_hash, "order-snapshot-replaced",
                            event_payload, response)
                self._enqueue_snapshot_kds(order, snapshot, scope, req.commandId)
                self.s.db.execute("COMMIT")
                return response
            except Exception:
                self.s.db.execute("ROLLBACK")
                raise

    def _enqueue_snapshot_kds(self, order: str, snapshot: dict[str, Any],
                              scope: dict[str, str], command_id: str) -> None:
        lines = snapshot.get("lines", snapshot.get("postavke", []))
        desired: dict[tuple[str, int, str], dict[str, Any]] = {}
        for line in lines:
            line_id = str(line.get("lineId", line.get("id")))
            configured = line.get("postajaIds")
            station_ids = sorted({int(value) for value in configured
                                  if isinstance(value, int) and value > 0}) if isinstance(configured, list) else []
            if not station_ids and isinstance(line.get("postajaId"), int) and line["postajaId"] > 0:
                station_ids = [line["postajaId"]]
            if not station_ids:
                append_internal_event(
                    self.s, f"{command_id}:kds-routing:{line_id}", "kds-routing-missing",
                    {"orderId": order, "lineId": line_id, "scope": scope}, {"held": True})
                continue
            course = line.get("courseNumber", "")
            for postaja_id in station_ids:
                desired[(line_id, postaja_id, str(course))] = {**line, "postajaId": postaja_id,
                                                               "postajaIds": station_ids}
        existing = self.s.db.execute(
            "SELECT job_id,version,state,payload_json,line_id FROM kds_jobs WHERE order_id=?",
            (order,)).fetchall()
        for old in existing:
            if old["state"] in ("COMPLETED", "CANCELLED"):
                continue
            old_line = json.loads(old["payload_json"]).get("line", {})
            identity = (str(old["line_id"]), old_line.get("postajaId"),
                        str(old_line.get("courseNumber", "")))
            if identity not in desired:
                self.s.db.execute(
                    "UPDATE kds_jobs SET version=version+1,state='CANCELLED',updated_at=? WHERE job_id=?",
                    (_gateway_now(), old["job_id"]))
                append_internal_event(
                    self.s, f"{command_id}:kds-cancel:{old['job_id']}", "kds-cancelled",
                    {"orderId": order, "jobId": old["job_id"], "identity": list(identity)},
                    {"jobId": old["job_id"], "state": "CANCELLED"})
        terminal = str(snapshot.get("status", snapshot.get("state", ""))).upper() in {
            "CLOSED", "CANCELLED", "ZAKLJUCENO", "PREKLICANO",
        }
        if terminal:
            return
        for (line_id, postaja_id, course), line in desired.items():
            idem = f"{scope['companyId']}:{scope['enotaId']}:{order}:{line_id}:{postaja_id}:{course}"
            job_id = str(uuid.uuid5(uuid.NAMESPACE_URL, "bookie-kds:" + idem))
            payload = {"orderId": order, "line": line, "scope": scope}
            old = self.s.db.execute("SELECT * FROM kds_jobs WHERE idempotency_key=?", (idem,)).fetchone()
            if old:
                if old["payload_json"] == canonical_json(payload):
                    continue
                self.s.db.execute("UPDATE kds_jobs SET version=version+1,payload_json=?,updated_at=? WHERE job_id=?",
                                  (canonical_json(payload), _gateway_now(), old["job_id"]))
                continue
            now = _gateway_now()
            # Ordinary lines and the first course are immediately actionable.
            # Future multicourse lines remain held until an explicit fire
            # command releases them; preserve an explicit release marker from
            # the authoritative order projection.
            course_number = line.get("courseNumber")
            explicitly_held = bool(line.get("held") or line.get("zadrzano") or line.get("courseHeld"))
            explicitly_released = bool(line.get("courseReleased") or line.get("released") or line.get("sprosceno"))
            initial_state = "QUEUED" if explicitly_held or (
                course_number is not None and str(course_number) not in {"", "1"} and not explicitly_released
            ) else "STARTED"
            self.s.db.execute(
                "INSERT INTO kds_jobs(job_id,version,state,payload_json,created_at,updated_at,company_id,enota_id,order_id,line_id,idempotency_key)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (job_id, 1, initial_state, canonical_json(payload), now, now,
                 scope["companyId"], scope["enotaId"], order, line_id, idem))

    def list_kds(self, scope: dict[str, str], state: str | None = None) -> list[dict[str, Any]]:
        query = "SELECT * FROM kds_jobs WHERE company_id=? AND enota_id=?"
        args: list[Any] = [scope["companyId"], scope["enotaId"]]
        if state:
            query += " AND state=?"; args.append(state.upper())
        query += " ORDER BY created_at"
        result = []
        for row in self.s.db.execute(query, args):
            raw = dict(row)
            item = {
                "jobId": raw["job_id"],
                "version": raw["version"],
                "state": raw["state"],
                "payload": json.loads(raw["payload_json"]),
                "createdAt": raw["created_at"],
                "updatedAt": raw["updated_at"],
                "companyId": raw.get("company_id"),
                "enotaId": raw.get("enota_id"),
                "orderId": raw.get("order_id"),
                "lineId": raw.get("line_id"),
            }
            result.append(item)
        return result

    def transition_kds(self, job_id: str, req: GatewayAckIn, state: str,
                       actor: str | None, scope: dict[str, str]) -> dict[str, Any]:
        payload = req.model_dump(mode="json")
        payload_hash = hashlib.sha256(canonical_json(payload).encode()).hexdigest()
        with self.s.lock:
            self.s.db.execute("BEGIN IMMEDIATE")
            try:
                old = self.s.db.execute("SELECT payload_hash,payload_json FROM gateway_events WHERE operation_id=?",
                                        (req.commandId or req.operationId,)).fetchone()
                if old:
                    if old["payload_hash"] != payload_hash:
                        raise HTTPException(409, "OPERATION_PAYLOAD_MISMATCH")
                    self.s.db.execute("COMMIT")
                    return json.loads(old["payload_json"])["response"]
                row = self.s.db.execute("SELECT * FROM kds_jobs WHERE job_id=? AND company_id=? AND enota_id=?",
                                        (job_id, scope["companyId"], scope["enotaId"])).fetchone()
                if not row:
                    raise HTTPException(404, "JOB_NOT_FOUND")
                if int(req.expectedVersion) != int(row["version"]):
                    raise HTTPException(409, detail=json.dumps({
                        "code": "JOB_VERSION_CONFLICT", "currentVersion": row["version"],
                        "jobId": job_id, "state": row["state"],
                    }))
                if req.fencingVersion is not None and int(req.fencingVersion) < 1:
                    raise HTTPException(409, "INVALID_FENCING_VERSION")
                allowed = {
                    "QUEUED": {"CLAIMED", "STARTED", "CANCELLED"},
                    "CLAIMED": {"STARTED", "CANCELLED"},
                    "STARTED": {"READY", "COMPLETED", "CANCELLED"},
                    "READY": {"COMPLETED", "CANCELLED"},
                    "COMPLETED": set(), "CANCELLED": set(),
                }
                target = state.upper()
                if target not in allowed.get(str(row["state"]).upper(), set()):
                    raise HTTPException(409, "INVALID_JOB_STATE")
                version = int(row["version"]) + 1
                self.s.db.execute("UPDATE kds_jobs SET version=?,state=?,updated_at=? WHERE job_id=?",
                                  (version, target, _gateway_now(), job_id))
                response = {"jobId": job_id, "version": version, "state": target}
                op = req.commandId or req.operationId
                self._event(op, payload_hash, f"kds-{target.lower()}",
                            {**payload, "scope": scope, "actor": actor}, response)
                self.s.db.execute("COMMIT")
                return response
            except Exception:
                self.s.db.execute("ROLLBACK")
                raise

    def prime(self, req: GatewayPrimeIn, actor: str | None,
              scope: dict[str, str], manager: bool) -> dict[str, Any]:
        pending_row = self.s.db.execute(
            "SELECT COUNT(*) AS n FROM gateway_events WHERE seq > COALESCE("
            "(SELECT CAST(value AS INTEGER) FROM sync_state WHERE key='gateway_seq'),0)"
        ).fetchone()
        pending = int(pending_row["n"])
        if pending and not (manager and req.managerConfirmed):
            raise HTTPException(409, detail=json.dumps({
                "code": "UNSYNCED_LOCAL_EDITS", "pendingEventCount": pending,
                "managerConfirmationRequired": True,
            }))
        payload = req.model_dump(mode="json")
        payload_hash = hashlib.sha256(canonical_json(payload).encode()).hexdigest()
        with self.s.lock:
            self.s.db.execute("BEGIN IMMEDIATE")
            try:
                old = self.s.db.execute("SELECT payload_hash,payload_json FROM gateway_events WHERE operation_id=?",
                                        (req.commandId,)).fetchone()
                if old:
                    if old["payload_hash"] != payload_hash:
                        raise HTTPException(409, "OPERATION_PAYLOAD_MISMATCH")
                    self.s.db.execute("COMMIT")
                    return json.loads(old["payload_json"])["response"]
                # Prime is intentionally bounded to POS-visible fields. It
                # cannot install arbitrary backend entities or fiscal state.
                for order in req.orders:
                    if order.get("orderId") is None:
                        raise HTTPException(422, "ORDER_ID_REQUIRED")
                    order_id = str(order["orderId"])
                    canonical_order = self._canonicalize_prime_order(order)
                    validated = self.validate_snapshot(canonical_order, order_id, scope)
                    current = self.s.db.execute(
                        "SELECT version FROM gateway_v2_orders WHERE order_id=? AND company_id=? AND enota_id=?",
                        (order_id, scope["companyId"], scope["enotaId"]),
                    ).fetchone()
                    version = int(current["version"]) if current else 0
                    self.s.db.execute(
                        "INSERT INTO gateway_v2_orders(order_id,version,state,projection_json,local_id,company_id,enota_id,fencing_version)"
                        " VALUES(?,?,?,?,?,?,?,0) ON CONFLICT(company_id,enota_id,order_id) DO UPDATE SET "
                        "projection_json=excluded.projection_json,state=excluded.state",
                        (order_id, version, str(validated.get("status", "open")).upper(),
                         canonical_json(validated), order_id, scope["companyId"], scope["enotaId"]))
                for table in req.tables:
                    table_id = str(table.get("tableId", table.get("id", "")))
                    if not table_id:
                        raise HTTPException(422, "TABLE_ID_REQUIRED")
                    self._upsert_table_projection(
                        table_id, str(table.get("status", "available")),
                        [str(value) for value in table.get("activeOrderIds", [])],
                        scope,
                    )
                response = {"accepted": True, "scope": scope, "orders": len(req.orders),
                            "tables": len(req.tables), "pendingEventCount": pending}
                self._event(req.commandId, payload_hash, "gateway-prime",
                            {**payload, "scope": scope}, response)
                self.s.db.execute("COMMIT")
                return response
            except Exception:
                self.s.db.execute("ROLLBACK")
                raise


def authenticate_gateway_request(
    store: Store, method: str, path: str, timestamp: str, nonce: str,
    raw_body: bytes, client_id: str, supplied_pairing: str, supplied_signature: str,
) -> str:
    """Verify one LAN client request and consume its nonce atomically."""
    row = store.db.execute(
        "SELECT * FROM clients WHERE client_id=? AND active=1", (client_id,)).fetchone() if client_id else None
    has_clients = bool(store.db.execute("SELECT 1 FROM clients LIMIT 1").fetchone())
    secret_blob = row["secret_blob"] if row else (store.get("pair_secret") if not has_clients else None)
    try:
        stamp = int(timestamp)
    except ValueError:
        try:
            stamp = int(datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp())
        except ValueError as error:
            raise HTTPException(401, "INVALID_TIMESTAMP") from error
    if abs(int(time.time()) - stamp) > 300 or len(nonce) < 22:
        raise HTTPException(401, "TIMESTAMP_OR_NONCE_INVALID")
    if not secret_blob or (client_id and not row):
        raise HTTPException(401, "CLIENT_REVOKED_OR_UNKNOWN")
    secret = DPAPI.unprotect(secret_blob)
    expected_pairing = base64.urlsafe_b64encode(secret).decode()
    body_hash = hashlib.sha256(raw_body).hexdigest()
    signed = f"{method.upper()}\n{path}\n{timestamp}\n{nonce}\n{body_hash}".encode()
    expected = hmac.new(secret, signed, hashlib.sha256).hexdigest()
    # Per-client LAN authentication is headerless: the secret is never sent
    # over the wire. The legacy global pairing header remains loopback-only.
    if (not row and (LAN_MODE or not hmac.compare_digest(supplied_pairing, expected_pairing))) or \
            not hmac.compare_digest(supplied_signature, expected):
        raise HTTPException(401, "SIGNATURE_INVALID")
    with store.lock:
        store.db.execute("BEGIN IMMEDIATE")
        try:
            store.db.execute("DELETE FROM auth_nonces WHERE seen_at<?", (int(time.time()) - 300,))
            store.db.execute(
                "INSERT INTO auth_nonces(nonce,seen_at,client_id) VALUES(?,?,?)",
                (nonce, int(time.time()), client_id or "legacy"))
            store.db.execute("COMMIT")
        except sqlite3.IntegrityError as error:
            store.db.execute("ROLLBACK")
            raise HTTPException(409, "REPLAY_DETECTED") from error
        except Exception:
            store.db.execute("ROLLBACK")
            raise
    return client_id or "legacy"


class BackgroundSync:
    """Periodic durable sync with explicit startup/API/reconnect wakeups."""
    def __init__(self, store: Store, interval_seconds: float = 5.0):
        self.store = store
        self.interval_seconds = interval_seconds
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="bookie-fiscal-sync", daemon=True)
        self._thread.start()
        self.wake("startup")

    def wake(self, reason: str = "requested") -> None:
        with self.store.lock:
            self.store.put("sync_wakeup_requested", canonical_json({
                "at": datetime.now(timezone.utc).isoformat(), "reason": reason,
            }).encode())
        self._wake.set()

    def _run(self) -> None:
        while not self._stop.is_set():
            self._wake.wait(self.interval_seconds)
            self._wake.clear()
            if self._stop.is_set():
                break
            try:
                service.process_print_jobs()
                sync_engine.sync_once(self.store, DPAPI.unprotect)
                with self.store.lock:
                    self.store.put("sync_last_run", datetime.now(timezone.utc).isoformat().encode())
                    self.store.db.execute("DELETE FROM settings WHERE k='sync_wakeup_requested'")
            except Exception as error:
                with self.store.lock:
                    self.store.put("sync_last_error", str(error)[:500].encode())

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=10)


store = Store(APP_DIR / "fiscal.sqlite3")
ADMIN_TOKEN_PATH = Path(os.environ.get("BOOKIE_ADMIN_TOKEN_PATH", str(APP_DIR / "admin-token.txt")))
if not store.get("admin_token"):
    token = secrets.token_urlsafe(32)
    store.put("admin_token", DPAPI.protect(token.encode()))
    try:
        ADMIN_TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
        ADMIN_TOKEN_PATH.write_text(token, encoding="ascii")
        if platform.system() == "Windows":
            subprocess.run(["icacls", str(ADMIN_TOKEN_PATH), "/inheritance:r",
                            "/grant:r", "SYSTEM:F", "Administrators:F"],
                           check=False, capture_output=True)
    except OSError:
        pass
elif not ADMIN_TOKEN_PATH.exists():
    try:
        ADMIN_TOKEN_PATH.write_text(DPAPI.unprotect(store.get("admin_token")).decode(), encoding="ascii")
    except OSError:
        pass
service = Fiscal(store, MockPrinter() if os.environ.get("BOOKIE_FISCAL_MOCK_PRINTER") == "1" else WindowsPrinter(os.environ.get("BOOKIE_FISCAL_PRINTER","")))
sync_worker = BackgroundSync(store)
gateway = Gateway(store)
gateway_v2 = GatewayV2(store)


@asynccontextmanager
async def service_lifespan(_: FastAPI):
    sync_worker.start()
    try:
        yield
    finally:
        sync_worker.stop()


app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=service_lifespan)

@app.middleware("http")
async def security(request: Request, call_next):
    origin = request.headers.get("origin")
    metadata = store.get("metadata")
    configured_origins = (json.loads(metadata).get("allowedHttpsOrigins", [])
                          if metadata else [])
    if origin and origin not in configured_origins: return Response(status_code=403)
    if request.method == "OPTIONS":
        auth_headers = "Content-Type,X-Bookie-Client-Id,X-Bookie-Timestamp,X-Bookie-Nonce,X-Bookie-Body-SHA256,X-Bookie-Signature"
        if not LAN_MODE:
            auth_headers = "Content-Type,X-Bookie-Pairing," + auth_headers.removeprefix("Content-Type,")
        return Response(status_code=204, headers={
            "Access-Control-Allow-Origin": origin or "", "Access-Control-Allow-Methods": "GET,POST",
            "Access-Control-Allow-Headers": auth_headers,
        })
    body = await request.body()
    body_limit = 10 * 1024 * 1024 if request.url.path == "/v1/admin/certificate" else MAX_BODY
    if len(body) > body_limit: return Response(status_code=413)
    public = request.url.path in {"/v1/capabilities", "/v1/pair", "/v1/admin/certificate",
                                  "/v1/gateway/health", "/v1/gateway/capabilities"}
    public = public or request.url.path == "/v1/provisioning/proof"
    # Client administration is intentionally never LAN-authenticated.  The
    # route itself performs the loopback and Windows-admin checks.
    public = public or request.url.path.startswith("/v1/gateway/admin/")
    if not public:
        if origin and origin not in configured_origins: return Response(status_code=403)
        client_id = request.headers.get("x-bookie-client-id", "")
        try:
            request.state.client_id = authenticate_gateway_request(
                store, request.method,
                request.url.path + (("?" + request.url.query) if request.url.query else ""),
                request.headers.get("x-bookie-timestamp", ""),
                request.headers.get("x-bookie-nonce", ""), body, client_id,
                request.headers.get("x-bookie-pairing", ""),
                request.headers.get("x-bookie-signature", ""))
            role_row = store.db.execute("SELECT role FROM clients WHERE client_id=? AND active=1",
                                        (request.state.client_id,)).fetchone()
            request.state.client_role = role_row["role"] if role_row else None
        except HTTPException as error:
            return Response(status_code=error.status_code, content=str(error.detail))
    response = await call_next(request)
    if origin in configured_origins: response.headers["Access-Control-Allow-Origin"] = origin
    if LAN_MODE and request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000"
    return response

def require_role(request: Request, *roles: str) -> None:
    if getattr(request.state, "client_role", None) not in roles:
        raise HTTPException(403, "ROLE_REQUIRED")

@app.get("/v1/capabilities")
def capabilities():
    problems: list[str] = []
    metadata = store.get("metadata")
    meta = json.loads(metadata) if metadata else {}
    if not metadata:
        problems.append("not_provisioned")
    else:
        required = ("companyId", "enotaId", "deviceId", "poslovniProstorId", "poslovniProstorOznaka",
                    "bIdentifier", "authorityKeyId", "authorityPublicKeyPem", "authorityVersion",
                     "goldenAttestationSha256", "expectedFursCertFingerprint", "syncHttpsBaseUrl",
                     "syncIngestPath", "syncStatusPathTemplate", "allowedHttpsOrigins")
        if any(meta.get(key) in (None, "") for key in required): problems.append("provisioning_incomplete")
        if not store.get("device_rsa_private_key"): problems.append("device_key_missing")
        if not store.get("provisioning_bundle"): problems.append("signed_provisioning_bundle_missing")
        if not store.get("certificate"): problems.append("furs_certificate_missing")
        if meta.get("fursCertificateFingerprint") != meta.get("expectedFursCertFingerprint"):
            problems.append("furs_certificate_fingerprint_mismatch")
        if not meta.get("printerName") and os.environ.get("BOOKIE_FISCAL_MOCK_PRINTER") != "1":
            problems.append("printer_not_configured")
    if free_bytes(APP_DIR) < 20 * 1024 * 1024: problems.append("disk_low")
    if not Fiscal.has_complete_furs_golden_vector(): problems.append("furs_v2_legal_core_golden_vector_missing")
    return {"service":"Bookie Local Gateway","legacyService":"Bookie Fiscal Service",
            "protocolVersion":"1.0","baseUrl":BASE_URL,
            "ready":not problems,"readinessProblems":problems,"envelopeFormat":"furs-v2",
            "paymentMethods":["cash"],"maxBodyBytes":MAX_BODY,"calendarPolicy":"SI-BUSINESS-DAY-V1",
            **({"identity": {"deviceId": meta.get("deviceId"), "unitId": meta.get("enotaId"),
                              "premiseId": meta.get("poslovniProstorId"),
                              "premiseLabel": meta.get("poslovniProstorOznaka"),
                              "bIdentifier": meta.get("bIdentifier")}} if metadata else {})}
@app.post("/v1/pair")
def pair(req: PairIn, request: Request):
    metadata = store.get("metadata")
    allowed = json.loads(metadata).get("allowedHttpsOrigins", []) if metadata else []
    client_host = request.client.host if request.client else ""
    if request.headers.get("origin") not in allowed or not (
            client_host in {"127.0.0.1", "::1"} or LAN_MODE):
        raise HTTPException(403, "Pairing requires the configured POS origin")
    secret, expected, expires = store.get("pair_secret"), store.get("pair_code_hash"), store.get("pair_code_expires")
    if not secret: raise HTTPException(409,"Device has not been provisioned")
    if not expected or not expires or int(expires) < int(time.time()) or not hmac.compare_digest(expected, hashlib.sha256(req.code.encode("ascii")).digest()):
        raise HTTPException(401,"PAIR_CODE_INVALID")
    client_id = str(uuid.uuid4())
    client_secret = secrets.token_bytes(32)
    now = _gateway_now()
    with store.lock:
        store.db.execute("BEGIN IMMEDIATE")
        try:
            store.db.execute(
                "INSERT INTO clients(client_id,name,secret_blob,active,created_at,company_id,enota_id) VALUES(?,?,?,?,?,?,?)",
                (client_id, req.clientName, DPAPI.protect(client_secret), 1, now,
                 json.loads(metadata).get("companyId"), str(json.loads(metadata).get("enotaId"))))
            # Preserve the legacy one-time global secret only for clients that
            # have not upgraded their stored pairing metadata.
            store.put("pair_code_hash", b"consumed")
            store.put("pair_code_expires", b"0")
            store.db.execute("COMMIT")
        except Exception:
            store.db.execute("ROLLBACK")
            raise
    return {"pairingSecret": base64.urlsafe_b64encode(client_secret).decode(),
            "clientId": client_id, "contract": "v1"}
@app.post("/v1/provisioning/proof")
def provisioning_proof(req: ProvisioningProofIn, request: Request):
    _loopback_admin(request)
    try:
        uuid.UUID(req.challengeId)
        base64.urlsafe_b64decode(req.challenge + "=" * (-len(req.challenge) % 4))
    except Exception:
        raise HTTPException(422, "PROVISIONING_CHALLENGE_INVALID")
    with store.lock:
        protected = store.get("device_rsa_private_key")
        if protected:
            private_key = serialization.load_pem_private_key(DPAPI.unprotect(protected), password=None)
        else:
            private_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
            private_pem = private_key.private_bytes(
                serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
            store.put("device_rsa_private_key", DPAPI.protect(private_pem))
    public_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    public_der = private_key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    fingerprint = hashlib.sha256(public_der).hexdigest()
    proof_input = f"bookie-device-registration-v1\n{req.challengeId}\n{req.challenge}\n{fingerprint}".encode()
    proof = private_key.sign(proof_input, padding.PKCS1v15(), hashes.SHA256())
    return {"challengeId": req.challengeId, "publicKeyPem": public_pem.decode(),
            "proofSignatureBase64": base64.b64encode(proof).decode(), "keyFingerprintSha256": fingerprint}
@app.post("/v1/provisioning/install")
def provisioning_install(req: ProvisioningBundleIn, request: Request):
    _loopback_admin(request)
    installed = service.apply_provisioning_bundle(req)
    sync_worker.wake("provisioning")
    response = {
        "status": "installed" if installed else "already-installed",
        "bundleId": req.bundleId, "version": req.version,
        "authorityVersion": req.authority["version"],
        "deviceVersion": req.revocation["deviceVersion"],
        "minimumAcceptedVersion": req.revocation["minimumAcceptedVersion"],
        "validUntil": req.validity["validUntil"],
    }
    return response
@app.get("/v1/admin/certificate")
def certificate_admin(request: Request):
    _loopback_admin(request)
    if "text/html" not in request.headers.get("accept", ""):
        return service.certificate_status()
    session, confirmation = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
    pairing_code = f"{secrets.randbelow(1_000_000):06d}"
    with store.lock:
        if not store.get("pair_secret"):
            store.put("pair_secret", DPAPI.protect(secrets.token_bytes(32)))
        store.put("pair_code_hash", hashlib.sha256(pairing_code.encode()).digest())
        store.put("pair_code_expires", str(int(time.time()) + 600).encode())
        store.put("certificate_admin_session", hashlib.sha256(session.encode()).digest())
        store.put("certificate_admin_confirmation", hashlib.sha256(confirmation.encode()).digest())
        store.put("certificate_admin_expires", str(int(time.time()) + 300).encode())
    html = f"""<!doctype html><meta charset="utf-8"><title>Bookie FURS certificate</title>
<h1>Local FURS certificate import</h1>
<p>This page sends the PKCS#12 and password only to the loopback fiscal service.</p>
<p>One-time POS pairing code (10 minutes): <strong>{pairing_code}</strong></p>
<p>Read the administrator token from {html.escape(str(ADMIN_TOKEN_PATH))}; it is never returned by this page.</p>
<input id="token" type="password" placeholder="Administrator token"><input id="p12" type="file" accept=".p12,.pfx"><input id="pw" type="password" placeholder="PKCS#12 password">
<button id="go">Import certificate</button><pre id="out"></pre>
<script>
const confirmation={json.dumps(confirmation)};
go.onclick=async()=>{{const f=p12.files[0];if(!f)return;const b=new Uint8Array(await f.arrayBuffer());
let s='';for(const x of b)s+=String.fromCharCode(x);
const r=await fetch('/v1/admin/certificate',{{method:'POST',credentials:'same-origin',
headers:{{'Content-Type':'application/json','X-Bookie-Local-Confirmation':confirmation,'X-Bookie-Admin-Token':token.value}},
body:JSON.stringify({{pkcs12Base64:btoa(s),password:pw.value}})}});
out.textContent=r.ok?JSON.stringify(await r.json(),null,2):await r.text();pw.value='';}};
</script>"""
    response = Response(html, media_type="text/html")
    response.set_cookie("bookie_cert_admin", session, httponly=True, secure=False,
                        samesite="strict", max_age=300, path="/v1/admin/certificate")
    return response
@app.post("/v1/admin/certificate")
def certificate_import(req: CertificateImportIn, request: Request):
    origin = request.headers.get("origin")
    metadata = store.get("metadata")
    allowed = json.loads(metadata).get("allowedHttpsOrigins", []) if metadata else []
    admin_token = request.headers.get("X-Bookie-Admin-Token", "")
    protected_admin = store.get("admin_token")
    if request.client.host not in {"127.0.0.1", "::1"} or not is_windows_admin() or \
            not protected_admin or not hmac.compare_digest(DPAPI.unprotect(protected_admin), admin_token.encode()) or \
            origin not in (None, "null") and origin not in allowed:
        raise HTTPException(403, "LOCAL_ADMIN_REQUIRED")
    session = request.cookies.get("bookie_cert_admin", "")
    confirmation = request.headers.get("x-bookie-local-confirmation", "")
    with store.lock:
        expected_session = store.get("certificate_admin_session")
        expected_confirmation = store.get("certificate_admin_confirmation")
        expires = store.get("certificate_admin_expires")
        valid = bool(expected_session and expected_confirmation and expires and
                     int(expires) >= int(time.time()) and
                     hmac.compare_digest(hashlib.sha256(session.encode()).digest(), expected_session) and
                     hmac.compare_digest(hashlib.sha256(confirmation.encode()).digest(), expected_confirmation))
        if not valid:
            raise HTTPException(403, "LOCAL_CONFIRMATION_INVALID")
        store.put("certificate_admin_session", b"consumed")
        store.put("certificate_admin_confirmation", b"consumed")
        store.put("certificate_admin_expires", b"0")
    return service.import_certificate(req)
@app.post("/v1/receipts/cash")
def cash(req: CashIssueIn, request: Request):
    require_role(request, "operator", "manager")
    envelope = service.issue_furs_v2(req, getattr(request.state, "client_id", None))
    sync_worker.wake("receipt")
    return envelope
@app.get("/v1/receipts/{operation_id}")
def receipt(operation_id: str):
    row=store.db.execute("SELECT * FROM receipts WHERE operation_id=?",(operation_id,)).fetchone()
    if not row: raise HTTPException(404,"Receipt not found")
    return json.loads(row["envelope_json"])

_DELIVERY_STATES = {
    "PENDING": "pending", "RECEIVED": "received", "FINALIZING": "finalizing",
    "BOOKIE_DELIVERED": "confirmed", "CONFIRMED": "confirmed", "FAILED": "failed",
    "UNKNOWN": "unknown", "NEEDS_REVIEW": "needs_review",
}
_SERVER_PROJECTION_FIELDS = (
    "id", "localReceiptId", "operationId", "number", "zoi", "printState",
    "submissionDeadlineAt", "overdue", "receivedAt",
)

def local_receipt_projection(row) -> dict[str, Any]:
    """Project durable state to the shared Android/POS boundary, never raw Bookie JSON."""
    try:
        raw = json.loads(row["server_response"]) if row["server_response"] else {}
    except (TypeError, json.JSONDecodeError):
        raw = {}
    if not isinstance(raw, dict):
        raw = {}
    furs_state = raw.get("fursState")
    if furs_state not in {
        None, "received_pending_review", "pending", "sending", "confirmed",
        "failed", "unknown", "quarantined", "needs_review",
    }:
        furs_state = None
    eor = raw.get("eor")
    attempts = raw.get("attemptCount", 0)
    last_error = raw.get("lastError")
    server_projection = {
        "fursState": furs_state,
        "eor": eor if isinstance(eor, str) else None,
        "attemptCount": attempts if isinstance(attempts, int) and not isinstance(attempts, bool) and attempts >= 0 else 0,
        "lastError": last_error if isinstance(last_error, str) else None,
    }
    server_projection.update({key: raw[key] for key in _SERVER_PROJECTION_FIELDS if key in raw})
    state = _DELIVERY_STATES.get(row["state"])
    if state is None:
        raise ValueError(f"Unsupported durable delivery state: {row['state']}")
    return {
        "envelope": json.loads(row["envelope_json"]),
        "bookieDeliveryState": state,
        "serverFursProjection": server_projection,
        "printState": "printed" if row["printed"] == 1 else "failed" if row["printed"] == 0 else "not_printed",
        "submissionDeadlineAt": row["deadline"],
    }

@app.get("/v1/queue")
def queue():
    rows = store.db.execute(
        """SELECT j.*,r.envelope_json,r.server_response,
           (SELECT success FROM print_attempts p WHERE p.operation_id=r.operation_id ORDER BY p.id DESC LIMIT 1) printed
           FROM jobs j JOIN receipts r ON r.operation_id=j.operation_id ORDER BY j.next_attempt"""
    )
    return {"items": [local_receipt_projection(row) for row in rows]}
@app.post("/v1/receipts/{operation_id}/reprint")
def reprint(operation_id: str, request: Request):
    require_role(request, "manager")
    row = store.db.execute("SELECT envelope_json FROM receipts WHERE operation_id=?", (operation_id,)).fetchone()
    if not row: raise HTTPException(404, "Receipt not found")
    job_id = f"{operation_id}:reprint:{uuid.uuid4()}"
    now = _gateway_now()
    store.db.execute(
        "INSERT INTO print_jobs(job_id,version,state,payload_json,attempts,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        (job_id, 1, "QUEUED", canonical_json({"operationId": operation_id, "reprint": True}),
         0, now, now))
    sync_worker.wake("reprint")
    return {"operationId": operation_id, "jobId": job_id, "printState": "queued", "reprint": True}
@app.post("/v1/sync", status_code=202)
def request_sync(request: Request):
    require_role(request, "operator", "manager")
    sync_worker.wake("api")
    return {"status": "accepted", "mode": "bookie_delivery"}


def _loopback_admin(request: Request) -> None:
    host = request.client.host if request.client else ""
    admin_token = request.headers.get("X-Bookie-Admin-Token", "")
    protected = store.get("admin_token")
    if host not in {"127.0.0.1", "::1"} or not is_windows_admin() or not protected or \
            not hmac.compare_digest(DPAPI.unprotect(protected), admin_token.encode()):
        raise HTTPException(403, "LOCAL_ADMIN_REQUIRED")


def _gateway_cert_fingerprint() -> str | None:
    if not TLS_CERTFILE:
        return None
    try:
        cert = x509.load_pem_x509_certificate(Path(TLS_CERTFILE).read_bytes())
        return hashlib.sha256(cert.public_bytes(serialization.Encoding.DER)).hexdigest()
    except Exception:
        return None


def _protect_gateway_tls_key() -> None:
    if not TLS_KEYFILE:
        return
    try:
        raw = Path(TLS_KEYFILE).read_bytes()
        if raw:
            store.put("gateway_tls_private_key", DPAPI.protect(raw))
    except OSError:
        pass


def _authority_status(company_id: str, enota_id: str) -> dict[str, Any]:
    pending_events = store.db.execute(
        "SELECT COUNT(*) FROM gateway_events WHERE seq > COALESCE("
        "(SELECT CAST(value AS INTEGER) FROM sync_state WHERE key='gateway_seq'),0)"
    ).fetchone()[0]
    open_orders = store.db.execute(
        "SELECT COUNT(*) FROM gateway_v2_orders WHERE state='OPEN'",
    ).fetchone()[0]
    unresolved_reviews = store.db.execute(
        "SELECT COUNT(*) FROM sync_state WHERE key IN ('gateway_blocked_review','gateway_unresolved_review') "
        "AND value IS NOT NULL AND value <> ''", ()
    ).fetchone()[0]
    leased_jobs = store.db.execute(
        "SELECT COUNT(*) FROM order_leases WHERE lease_until > ?",
        (_gateway_now(),),
    ).fetchone()[0]
    in_flight = store.db.execute(
        "SELECT COUNT(*) FROM jobs WHERE state NOT IN ('DONE','FAILED','CANCELLED')"
    ).fetchone()[0] + store.db.execute(
        "SELECT COUNT(*) FROM print_jobs WHERE state NOT IN ('DONE','FAILED','CANCELLED')"
    ).fetchone()[0]
    fiscal_in_flight = store.db.execute(
        "SELECT COUNT(*) FROM receipts WHERE state IN ('received_pending_review','pending','sending')"
    ).fetchone()[0]
    prior = store.db.execute("SELECT value FROM sync_state WHERE key='release_generation'").fetchone()
    generation = int(prior["value"]) if prior else 0
    prior_mode = store.db.execute("SELECT value FROM sync_state WHERE key='authority_mode'").fetchone()
    mode = "GATEWAY" if (prior_mode and prior_mode["value"] == "GATEWAY") or \
        open_orders or pending_events or unresolved_reviews or leased_jobs or in_flight or fiscal_in_flight else "CLOUD"
    return {
        "companyId": company_id, "enotaId": enota_id,
        "authorityMode": mode, "releaseGeneration": generation,
        "openLocalOrders": int(open_orders), "pendingEvents": int(pending_events),
        "unresolvedReviews": int(unresolved_reviews), "leasedJobs": int(leased_jobs),
        "inFlightFiscalJobs": int(in_flight + fiscal_in_flight),
    }


def _configured_gateway_scope() -> tuple[str, str]:
    metadata = json.loads(store.get("metadata") or b"{}")
    company_id, enota_id = metadata.get("companyId"), metadata.get("enotaId")
    if company_id in (None, "") or enota_id in (None, ""):
        raise HTTPException(409, "GATEWAY_SCOPE_NOT_PROVISIONED")
    return str(company_id), str(enota_id)


def _require_gateway_scope(request: Request, company_id: str, enota_id: str) -> tuple[str, str]:
    configured_company, configured_unit = _configured_gateway_scope()
    client_id = getattr(request.state, "client_id", None)
    row = store.db.execute(
        "SELECT company_id,enota_id FROM clients WHERE client_id=? AND active=1", (client_id,)
    ).fetchone()
    if (company_id, enota_id) != (configured_company, configured_unit) or not row or \
            str(row["company_id"] or "") != configured_company or str(row["enota_id"] or "") != configured_unit:
        raise HTTPException(403, "GATEWAY_SCOPE_MISMATCH")
    return configured_company, configured_unit


@app.post("/v1/gateway/authority/release")
def release_gateway_authority(request: Request, payload: dict[str, Any] = Body(default={})):
    # Authenticated gatewayFetch provides the client identity; scope is a
    # guard, not an authority claim.  SQLite's write lock makes the check and
    # transition one atomic operation.
    company_id, enota_id = str(payload.get("companyId", "")), str(payload.get("enotaId", ""))
    if not company_id or not enota_id:
        raise HTTPException(422, "SCOPE_REQUIRED")
    require_role(request, "manager", "admin")
    company_id, enota_id = _require_gateway_scope(request, company_id, enota_id)
    with store.lock:
        store.db.execute("BEGIN IMMEDIATE")
        try:
            status = _authority_status(company_id, enota_id)
            if any(status[key] != 0 for key in
                   ("openLocalOrders", "pendingEvents", "unresolvedReviews", "leasedJobs", "inFlightFiscalJobs")):
                store.db.execute("ROLLBACK")
                raise HTTPException(409, "GATEWAY_AUTHORITY_NOT_SAFE_TO_RELEASE")
            if status["authorityMode"] == "CLOUD":
                store.db.execute("COMMIT")
                return status
            generation = status["releaseGeneration"] + 1
            store.db.execute(
                "INSERT INTO sync_state(key,value,updated_at) VALUES('authority_mode','CLOUD',?) "
                "ON CONFLICT(key) DO UPDATE SET value='CLOUD',updated_at=excluded.updated_at", (_gateway_now(),))
            store.db.execute(
                "INSERT INTO sync_state(key,value,updated_at) VALUES('release_generation',?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
                (str(generation), _gateway_now()),
            )
            store.db.execute("COMMIT")
            return {**status, "authorityMode": "CLOUD", "releaseGeneration": generation}
        except HTTPException:
            raise
        except Exception:
            store.db.execute("ROLLBACK")
            raise


@app.get("/v1/gateway/authority/status")
def gateway_authority_status(request: Request, companyId: str = "", enotaId: str = ""):
    if not companyId or not enotaId:
        raise HTTPException(422, "SCOPE_REQUIRED")
    companyId, enotaId = _require_gateway_scope(request, companyId, enotaId)
    with store.lock:
        return _authority_status(companyId, enotaId)


@app.get("/v1/gateway/health")
def gateway_health():
    metadata = json.loads(store.get("metadata") or b"{}")
    pending = store.db.execute(
        "SELECT COUNT(*) FROM gateway_events WHERE seq > COALESCE("
        "(SELECT CAST(value AS INTEGER) FROM sync_state WHERE key='gateway_seq'),0)").fetchone()[0]
    open_local = store.db.execute(
        "SELECT COUNT(*) FROM gateway_v2_orders WHERE state='OPEN'").fetchone()[0]
    prior_mode = store.db.execute("SELECT value FROM sync_state WHERE key='authority_mode'").fetchone()
    prior_epoch = store.db.execute("SELECT value FROM sync_state WHERE key='authority_epoch'").fetchone()
    # Gateway authority is sticky while work exists, then clears only after
    # every local order is terminal and all gateway events are acknowledged.
    mode = "GATEWAY" if open_local or pending else "CLOUD"
    epoch = int(prior_epoch["value"]) if prior_epoch else 0
    if mode == "GATEWAY" and (not prior_mode or prior_mode["value"] != "GATEWAY"):
        epoch += 1
    store.db.execute(
        "INSERT INTO sync_state(key,value,updated_at) VALUES('authority_mode',?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        (mode, _gateway_now()))
    store.db.execute(
        "INSERT INTO sync_state(key,value,updated_at) VALUES('authority_epoch',?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        (str(epoch), _gateway_now()))
    return {
        "service": "Bookie Local Gateway", "status": "ok", "lan": LAN_MODE,
        "bind": LISTEN_HOST, "port": LISTEN_PORT,
        "pendingEventCount": pending, "pendingLocalEvents": pending,
        "hasOpenLocalOrders": bool(open_local), "authorityMode": mode,
        "authorityEpoch": epoch, "checkedAt": _gateway_now(),
        "diagnosticTime": _diagnostic_time(),
        "deviceId": metadata.get("deviceId"), "tls": {
            "required": LAN_MODE, "fingerprintSha256": _gateway_cert_fingerprint(),
        },
    }


@app.get("/v1/gateway/capabilities")
def gateway_capabilities():
    return {
        "service": "Bookie Local Gateway", "protocolVersion": "2.0",
        "baseUrl": f"{'https' if LAN_MODE else 'http'}://{LISTEN_HOST}:{LISTEN_PORT}/v1",
        "tlsFingerprintSha256": _gateway_cert_fingerprint(),
        "legacyFiscalPaths": True, "singleWriter": True,
        "supportedOffline": ["cash", "durable_receipt_print", "event_audit", "event_sync",
                             "health", "tables", "orders", "kds"],
        "unsupportedOffline": ["card", "qr", "cloud_configuration", "automatic_failover"],
        "gatewayContract": {
            "version": "gateway-v2", "scope": ["companyId", "enotaId"],
            "orderMutation": "full_snapshot_replace",
            "requires": ["leaseId", "fencingVersion", "expectedVersion"],
            "ids": "gateway-generated UUIDs; cloud IDs optional",
        },
        "limits": {"maxBodyBytes": MAX_BODY, "maxEvents": 200},
    }


@app.get("/v1/gateway/snapshot")
def gateway_snapshot():
    return gateway.snapshot()


@app.get("/v1/gateway/events")
def gateway_events(after: int = 0, limit: int = 100):
    if after < 0 or limit < 1 or limit > 200:
        raise HTTPException(422, "INVALID_EVENT_CURSOR")
    first = store.db.execute("SELECT MIN(seq) AS seq FROM gateway_events").fetchone()["seq"]
    last = store.db.execute("SELECT MAX(seq) AS seq FROM gateway_events").fetchone()["seq"] or 0
    gap = bool(first is not None and after < int(first) - 1)
    rows = store.db.execute(
        "SELECT seq,operation_id AS operationId,event_type AS eventType,payload_hash AS payloadHash,"
        "payload_json AS payload,created_at AS createdAt FROM gateway_events WHERE seq>? ORDER BY seq LIMIT ?",
        (after, limit)).fetchall()
    result = []
    for row in rows:
        item = dict(row)
        envelope = json.loads(item["payload"])
        item["payload"] = envelope.get("payload", envelope)
        item["response"] = envelope.get("response")
        result.append(item)
    return {"events": result, "after": after, "next": result[-1]["seq"] if result else after,
            "watermark": last, "gap": gap, "recoverWithSnapshot": gap}


def _v2_scope(request: Request, company_id: str | None = None,
              enota_id: int | str | None = None) -> dict[str, str]:
    return gateway_v2.scope(company_id, enota_id)


@app.get("/v1/gateway/v2/snapshot")
def gateway_v2_snapshot(request: Request, companyId: str | None = None,
                        enotaId: str | None = None):
    scope = _v2_scope(request, companyId, enotaId)
    result = gateway_v2.snapshot(scope)
    result["scope"] = scope
    # Never leak another provisioned unit's projections if an old database was
    # upgraded in place before scope columns existed.
    return result


@app.post("/v1/gateway/v2/orders/open")
def gateway_v2_order_open(req: GatewayCommandIn, request: Request):
    require_role(request, "operator", "manager")
    scope = _v2_scope(request, req.companyId, req.enotaId)
    order_id = str(req.orderId or uuid.uuid4())
    try:
        uuid.UUID(order_id)
    except ValueError as exc:
        raise HTTPException(422, "ORDER_ID_MUST_BE_UUID") from exc
    lease = GatewayLeaseIn(commandId=req.commandId or req.operationId, orderId=order_id,
                           expectedVersion=0, leaseSeconds=req.leaseSeconds,
                           companyId=scope["companyId"], enotaId=scope["enotaId"],
                           forceTransfer=req.forceTransfer)
    result = gateway_v2.acquire_lease(lease, getattr(request.state, "client_id", None), scope,
                                      force=req.forceTransfer)
    projection = {**(req.payload or {}), "orderId": order_id,
                  "companyId": scope["companyId"], "enotaId": scope["enotaId"],
                  "status": "open", "lines": list((req.payload or {}).get("lines") or [])}
    with store.lock:
        store.db.execute(
            "UPDATE gateway_v2_orders SET projection_json=?,state=? "
            "WHERE order_id=? AND company_id=? AND enota_id=?",
            (canonical_json(projection), "OPEN", order_id, scope["companyId"], scope["enotaId"]),
        )
    result["projection"] = projection
    return result


@app.post("/v1/gateway/v2/orders/{order_id}/lease/acquire")
def gateway_v2_lease_acquire(order_id: str, req: GatewayLeaseIn, request: Request):
    require_role(request, "operator", "manager")
    if str(req.orderId) != order_id:
        raise HTTPException(409, "CROSS_SCOPE_COMMAND")
    scope = _v2_scope(request, req.companyId, req.enotaId)
    if req.forceTransfer and not req.approvalCode:
        require_role(request, "manager")
    return gateway_v2.acquire_lease(req, getattr(request.state, "client_id", None), scope, req.forceTransfer)


@app.post("/v1/gateway/v2/orders/{order_id}/lease/renew")
def gateway_v2_lease_renew(order_id: str, req: GatewayLeaseIn, request: Request):
    require_role(request, "operator", "manager")
    if str(req.orderId) != order_id:
        raise HTTPException(409, "CROSS_SCOPE_COMMAND")
    scope = _v2_scope(request, req.companyId, req.enotaId)
    return gateway_v2.renew_lease(req, getattr(request.state, "client_id", None), scope)


@app.post("/v1/gateway/v2/orders/{order_id}/lease/release")
def gateway_v2_lease_release(order_id: str, req: GatewayLeaseIn, request: Request):
    require_role(request, "operator", "manager")
    if str(req.orderId) != order_id:
        raise HTTPException(409, "CROSS_SCOPE_COMMAND")
    scope = _v2_scope(request, req.companyId, req.enotaId)
    return gateway_v2.release_lease(req, getattr(request.state, "client_id", None), scope)


@app.post("/v1/gateway/v2/orders/{order_id}/snapshot")
def gateway_v2_order_snapshot(order_id: str, req: GatewaySnapshotIn, request: Request):
    require_role(request, "operator", "manager")
    if str(req.orderId) != order_id:
        raise HTTPException(409, "CROSS_SCOPE_COMMAND")
    scope = _v2_scope(request, req.companyId, req.enotaId)
    return gateway_v2.replace_snapshot(req, getattr(request.state, "client_id", None), scope)


@app.post("/v1/gateway/v2/prime")
def gateway_v2_prime(req: GatewayPrimeIn, request: Request):
    require_role(request, "operator", "manager")
    scope = _v2_scope(request, req.companyId, req.enotaId)
    manager = getattr(request.state, "client_role", None) == "manager"
    return gateway_v2.prime(req, getattr(request.state, "client_id", None), scope, manager)


@app.get("/v1/gateway/v2/kds")
def gateway_v2_kds(request: Request, companyId: str | None = None,
                   enotaId: str | None = None, state: str | None = None,
                   postajaId: int | None = None):
    jobs = gateway_v2.list_kds(_v2_scope(request, companyId, enotaId), state)
    if postajaId is not None:
        jobs = [job for job in jobs
                if str((job.get("payload") or {}).get("line", {}).get("postajaId", "")) == str(postajaId)]
    return {"jobs": jobs}


def _gateway_v2_kds_transition(job_id: str, state: str, req: GatewayAckIn,
                               request: Request):
    require_role(request, "operator", "manager")
    scope = _v2_scope(request, req.companyId, req.enotaId)
    return gateway_v2.transition_kds(job_id, req, state,
                                     getattr(request.state, "client_id", None), scope)


@app.post("/v1/gateway/v2/kds/{job_id}/claim")
def gateway_v2_kds_claim(job_id: str, req: GatewayAckIn, request: Request):
    return _gateway_v2_kds_transition(job_id, "CLAIMED", req, request)


@app.post("/v1/gateway/v2/kds/{job_id}/start")
def gateway_v2_kds_start(job_id: str, req: GatewayAckIn, request: Request):
    return _gateway_v2_kds_transition(job_id, "STARTED", req, request)


@app.post("/v1/gateway/v2/kds/{job_id}/ready")
def gateway_v2_kds_ready(job_id: str, req: GatewayAckIn, request: Request):
    return _gateway_v2_kds_transition(job_id, "READY", req, request)


@app.post("/v1/gateway/v2/kds/{job_id}/complete")
def gateway_v2_kds_complete(job_id: str, req: GatewayAckIn, request: Request):
    return _gateway_v2_kds_transition(job_id, "COMPLETED", req, request)


@app.post("/v1/gateway/v2/kds/{job_id}/cancel")
def gateway_v2_kds_cancel(job_id: str, req: GatewayAckIn, request: Request):
    return _gateway_v2_kds_transition(job_id, "CANCELLED", req, request)


@app.get("/v1/gateway/admin/clients")
def gateway_clients(request: Request):
    _loopback_admin(request)
    return {"clients": [dict(row) for row in store.db.execute(
        "SELECT client_id AS clientId,name,role,active,created_at AS createdAt,revoked_at AS revokedAt,"
        "revoke_reason AS revokeReason FROM clients ORDER BY created_at")]}


@app.post("/v1/gateway/admin/clients/{client_id}/revoke")
def gateway_revoke_client(client_id: str, request: Request, req: GatewayClientRevokeIn):
    _loopback_admin(request)
    with store.lock:
        store.db.execute("BEGIN IMMEDIATE")
        try:
            row = store.db.execute("SELECT client_id FROM clients WHERE client_id=?", (client_id,)).fetchone()
            if not row:
                raise HTTPException(404, "CLIENT_NOT_FOUND")
            store.db.execute(
                "UPDATE clients SET active=?,revoked_at=?,revoke_reason=? WHERE client_id=?",
                (0 if req.revoked else 1, _gateway_now() if req.revoked else None,
                 req.reason, client_id))
            store.db.execute("COMMIT")
        except Exception:
            store.db.execute("ROLLBACK")
            raise
    return {"clientId": client_id, "active": not req.revoked}


@app.post("/v1/gateway/admin/clients/{client_id}/role")
def gateway_set_client_role(client_id: str, req: GatewayClientRoleIn, request: Request):
    _loopback_admin(request)
    with store.lock:
        updated = store.db.execute("UPDATE clients SET role=? WHERE client_id=?",
                                   (req.role, client_id)).rowcount
        if not updated:
            raise HTTPException(404, "CLIENT_NOT_FOUND")
    return {"clientId": client_id, "role": req.role}


@app.post("/v1/gateway/admin/transfer-approval")
def gateway_transfer_approval(req: GatewayTransferApprovalIn, request: Request):
    """Loopback-brokered one-use manager approval; plaintext is never stored."""
    _loopback_admin(request)
    code = secrets.token_urlsafe(18)
    digest = hashlib.sha256(code.encode()).hexdigest()
    now = datetime.now(timezone.utc)
    expires = (now + timedelta(minutes=2)).isoformat().replace("+00:00", "Z")
    with store.lock:
        store.db.execute(
            "INSERT INTO gateway_transfer_approvals(approval_hash,order_id,target_client_id,"
            "fencing_version,expires_at,created_at) VALUES(?,?,?,?,?,?)",
            (digest, str(req.orderId), req.targetClientId, req.currentFencingVersion,
             expires, now.isoformat().replace("+00:00", "Z")),
        )
    return {"approvalCode": code, "expiresAt": expires, "orderId": str(req.orderId),
            "targetClientId": req.targetClientId, "fencingVersion": req.currentFencingVersion}


@app.post("/v1/gateway/orders/open")
def gateway_order_open(req: GatewayCommandIn, request: Request):
    require_role(request, "operator", "manager")
    if req.orderId is None:
        raise HTTPException(422, "ORDER_ID_REQUIRED")
    return gateway.command(req, getattr(request.state, "client_id", None), "order-open")


@app.post("/v1/gateway/orders/{order_id}/update")
def gateway_order_update(order_id: int, req: GatewayCommandIn, request: Request):
    require_role(request, "operator", "manager")
    req.orderId = order_id
    return gateway.command(req, getattr(request.state, "client_id", None), "order-update")


@app.post("/v1/gateway/orders/{order_id}/close")
def gateway_order_close(order_id: int, req: GatewayCommandIn, request: Request):
    require_role(request, "operator", "manager")
    req.orderId, req.status = order_id, "CLOSED"
    return gateway.command(req, getattr(request.state, "client_id", None), "order-close")


@app.post("/v1/gateway/tables/{table_id}/status")
def gateway_table_status(table_id: int, req: GatewayCommandIn, request: Request):
    require_role(request, "operator", "manager")
    req.tableId = table_id
    return gateway.command(req, getattr(request.state, "client_id", None), "table-status")


@app.post("/v1/gateway/kds/enqueue")
def gateway_kds_enqueue(req: GatewayCommandIn, request: Request):
    require_role(request, "operator", "manager")
    return gateway.append_job(req, getattr(request.state, "client_id", None), "kds")


@app.post("/v1/gateway/kds/{job_id}/bump")
def gateway_kds_bump(job_id: str, req: GatewayAckIn, request: Request):
    require_role(request, "operator", "manager")
    req.jobId = job_id
    return gateway.ack_job(req, "kds", "BUMPED", getattr(request.state, "client_id", None))


@app.post("/v1/gateway/kds/{job_id}/ack")
def gateway_kds_ack(job_id: str, req: GatewayAckIn, request: Request):
    require_role(request, "operator", "manager")
    req.jobId = job_id
    return gateway.ack_job(req, "kds", "ACKED", getattr(request.state, "client_id", None))


@app.post("/v1/gateway/print/enqueue")
def gateway_print_enqueue(req: GatewayCommandIn, request: Request):
    require_role(request, "operator", "manager")
    return gateway.append_job(req, getattr(request.state, "client_id", None), "print")


@app.post("/v1/gateway/print/{job_id}/ack")
def gateway_print_ack(job_id: str, req: GatewayAckIn, request: Request):
    require_role(request, "operator", "manager")
    req.jobId = job_id
    return gateway.ack_job(req, "print", "ACKED", getattr(request.state, "client_id", None))


@app.post("/v1/gateway/print/{job_id}/retry")
def gateway_print_retry(job_id: str, req: GatewayAckIn, request: Request):
    require_role(request, "manager")
    req.jobId = job_id
    return gateway.ack_job(req, "print", "RETRY", getattr(request.state, "client_id", None))


@app.get("/v1/export/{operation_id}")
def export(operation_id: str):
    r=store.db.execute("SELECT operation_id,canonical,xml,xml_hash,payload_hash,zoi,chain_hash FROM receipts WHERE operation_id=?",(operation_id,)).fetchone()
    if not r: raise HTTPException(404,"Receipt not found")
    return dict(r)

def main():
    import uvicorn
    global LISTEN_HOST, LISTEN_PORT, LAN_MODE, TLS_CERTFILE, TLS_KEYFILE
    if platform.system() == "Windows" and "--service" in sys.argv:
        import servicemanager
        import win32event
        import win32service
        import win32serviceutil

        class BookieFiscalWindowsService(win32serviceutil.ServiceFramework):
            _svc_name_ = "BookieFiscalService"
            _svc_display_name_ = "Bookie Local Gateway"

            def __init__(self, args):
                super().__init__(args)
                self.stop_event = win32event.CreateEvent(None, 0, 0, None)
                self.server = None

            def SvcStop(self):
                self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
                if self.server:
                    self.server.should_exit = True
                win32event.SetEvent(self.stop_event)

            def SvcDoRun(self):
                global LISTEN_HOST, LISTEN_PORT, LAN_MODE, TLS_CERTFILE, TLS_KEYFILE
                LAN_MODE = "--lan" in sys.argv
                LISTEN_HOST = "0.0.0.0" if LAN_MODE else "127.0.0.1"
                try:
                    LISTEN_PORT = int(sys.argv[sys.argv.index("--port") + 1])
                except (ValueError, IndexError):
                    LISTEN_PORT = 17831
                def arg(name: str) -> str | None:
                    try: return sys.argv[sys.argv.index(name) + 1]
                    except (ValueError, IndexError): return None
                TLS_CERTFILE, TLS_KEYFILE = arg("--ssl-cert"), arg("--ssl-key")
                if LAN_MODE and (not TLS_CERTFILE or not TLS_KEYFILE or
                                  not Path(TLS_CERTFILE).is_file() or not Path(TLS_KEYFILE).is_file()):
                    raise RuntimeError("LAN mode requires --ssl-cert and --ssl-key")
                _protect_gateway_tls_key()
                self.server = uvicorn.Server(uvicorn.Config(
                    app, host=LISTEN_HOST, port=LISTEN_PORT, log_level="warning",
                    ssl_certfile=TLS_CERTFILE, ssl_keyfile=TLS_KEYFILE))
                self.server.run()

        servicemanager.Initialize()
        servicemanager.PrepareToHostSingle(BookieFiscalWindowsService)
        servicemanager.StartServiceCtrlDispatcher()
        return
    parser=argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=17831)
    parser.add_argument("--lan", action="store_true",
                        help="explicitly bind the LAN interface (0.0.0.0)")
    parser.add_argument("--ssl-cert", help="PEM gateway certificate (required with --lan)")
    parser.add_argument("--ssl-key", help="PEM gateway private key (required with --lan)")
    args=parser.parse_args()
    if not args.lan and args.host != "127.0.0.1":
        raise SystemExit("LAN binding requires the explicit --lan opt-in")
    if args.lan and (not args.ssl_cert or not args.ssl_key or
                     not Path(args.ssl_cert).is_file() or not Path(args.ssl_key).is_file()):
        raise SystemExit("LAN binding requires existing --ssl-cert and --ssl-key files")
    if not 1024 <= args.port <= 65535:
        raise SystemExit("A fixed TCP port between 1024 and 65535 is required")
    LAN_MODE, LISTEN_PORT = args.lan, args.port
    LISTEN_HOST = "0.0.0.0" if args.lan else "127.0.0.1"
    TLS_CERTFILE, TLS_KEYFILE = args.ssl_cert, args.ssl_key
    _protect_gateway_tls_key()
    uvicorn.run(app, host=LISTEN_HOST, port=LISTEN_PORT, log_level="warning",
                ssl_certfile=TLS_CERTFILE, ssl_keyfile=TLS_KEYFILE)
if __name__ == "__main__": main()