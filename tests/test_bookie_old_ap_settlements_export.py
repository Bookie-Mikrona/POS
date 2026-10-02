import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/bookie_old_ap_settlements_export.py"
SPEC = importlib.util.spec_from_file_location("bookie_old_ap_export", SCRIPT)
EXPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXPORTER)


def glavna(source_id, *, year="2024", number="000001", account="2200000",
           debit="", credit="12.34", balance="0", doc_type="30"):
    return {
        "Stevec": str(source_id), "Zavezanec": "000001", "Leto": year,
        "Vrsta": doc_type, "Stevilka": number, "Konto": account,
        "S_KONTO": "K2", "Debet": debit, "Kredit": credit,
        "Ostanek": balance,
    }


def close(closing_id, source_id, other_id, amount, date="1/2/2025"):
    return {
        "Stevec": str(closing_id), "Stevec1": str(source_id),
        "Stevec2": str(other_id), "E_Znesek": amount,
        "Datum": date, "Zavezanec": "000001",
    }


class OldApSettlementExportTests(unittest.TestCase):
    def test_exports_matched_closing_and_counterpart_reference(self):
        data = EXPORTER.export(
            [{
                "reference": "BOOKIE-OLD/K2/2024/30/000001",
                "sourceLineId": "10", "historicalGross": "12.34", "nativeCredit": "12.34",
            }],
            [glavna(10, balance="2.34"), glavna(20, number="000002")],
            [close(100, 10, 20, "10.00"), close(101, 20, 10, "10.00")],
        )
        settlement = data["settlements"][0]
        self.assertEqual(settlement["closed"], "10.00")
        self.assertEqual(settlement["remaining"], "2.34")
        self.assertEqual(settlement["evidence"][0]["recordedDate"], "2025-01-02")
        self.assertEqual(settlement["evidence"][0]["counterpartReference"], "BOOKIE-OLD/K2/2024/30/000002")

    def test_cent_rounding_reconciles_source_float_artifacts(self):
        data = EXPORTER.export(
            [{
                "reference": "BOOKIE-OLD/K2/2024/30/000001",
                "sourceLineId": "10", "historicalGross": "12.34", "nativeCredit": "12.34",
            }],
            [glavna(10, credit="12.3400000001", balance="2.3400000001")],
            [close(100, 10, 20, "10.0000000001"), close(101, 20, 10, "10.0000000001")],
        )
        self.assertEqual(data["settlements"][0]["remaining"], "2.34")

    def test_rejects_wrong_invoice_gross_or_missing_reciprocal(self):
        items = [{
            "reference": "BOOKIE-OLD/K2/2024/30/000001",
            "sourceLineId": "10", "historicalGross": "12.33", "nativeCredit": "12.34",
        }]
        with self.assertRaisesRegex(ValueError, "amount mismatch"):
            EXPORTER.export(items, [glavna(10, balance="2.34")], [])
        items[0]["historicalGross"] = "12.34"
        with self.assertRaisesRegex(ValueError, "reciprocal"):
            EXPORTER.export(items, [glavna(10, balance="2.34")], [close(100, 10, 20, "10.00")])

    def test_rejects_wrong_source_reference_and_date(self):
        item = {
            "reference": "BOOKIE-OLD/K2/2023/30/000001",
            "sourceLineId": "10", "historicalGross": "12.34", "nativeCredit": "12.34",
        }
        with self.assertRaisesRegex(ValueError, "reference mismatch"):
            EXPORTER.export([item], [glavna(10, balance="2.34")], [])
        item["reference"] = "BOOKIE-OLD/K2/2024/30/000001"
        with self.assertRaisesRegex(ValueError, "Invalid source date"):
            EXPORTER.export([item], [glavna(10, balance="2.34")],
                            [close(100, 10, 20, "10.00", "not-a-date"),
                             close(101, 20, 10, "10.00")])


if __name__ == "__main__":
    unittest.main()