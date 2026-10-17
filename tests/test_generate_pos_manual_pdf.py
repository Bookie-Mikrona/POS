from __future__ import annotations

import importlib.util
import hashlib
import re
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
GENERATOR_PATH = ROOT / "scripts" / "generate_pos_manual_pdf.py"
SPEC = importlib.util.spec_from_file_location("generate_pos_manual_pdf", GENERATOR_PATH)
assert SPEC and SPEC.loader
generator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(generator)


def metadata(identifier: str, package: str = "lite") -> str:
    return f"<!-- pos-heading: id={identifier} package={package} -->"


def test_accepts_valid_metadata_and_removes_technical_comments() -> None:
    cleaned, headings = generator.extract_heading_metadata(
        f"{metadata('intro', 'standard')}\n# Naslov\n\n"
        f"{metadata('details', 'extended')}\n## Podnaslov",
        "valid.md",
    )

    assert headings == [("intro", "standard"), ("details", "extended")]
    assert "pos-heading" not in cleaned
    assert "intro" not in cleaned
    assert "# Naslov" in cleaned


def test_reordering_blocks_preserves_each_heading_assignment() -> None:
    original = (
        f"{metadata('alpha', 'lite')}\n# Alpha\n\n"
        f"{metadata('beta', 'extended')}\n## Beta"
    )
    reordered = (
        f"{metadata('beta', 'extended')}\n## Beta\n\n"
        f"{metadata('alpha', 'lite')}\n# Alpha"
    )

    _, first = generator.extract_heading_metadata(original, "before.md")
    _, second = generator.extract_heading_metadata(reordered, "after.md")

    assert dict(first) == dict(second) == {"alpha": "lite", "beta": "extended"}


def test_rejects_duplicate_ids() -> None:
    with pytest.raises(ValueError, match="podvojen ID 'same'"):
        generator.extract_heading_metadata(
            f"{metadata('same')}\n# Ena\n\n{metadata('same')}\n## Dve",
            "duplicate.md",
        )


def test_rejects_duplicate_ids_across_source_files() -> None:
    seen: set[str] = set()
    generator.extract_heading_metadata(f"{metadata('shared')}\n# Ena", "one.md", seen)

    with pytest.raises(ValueError, match="podvojen ID 'shared'.*drugem viru"):
        generator.extract_heading_metadata(
            f"{metadata('shared')}\n# Dve", "two.md", seen
        )


def test_rejects_missing_metadata() -> None:
    with pytest.raises(ValueError, match="naslov nima metapodatkov"):
        generator.extract_heading_metadata("# Naslov", "missing.md")


def test_rejects_missing_or_malformed_id() -> None:
    with pytest.raises(ValueError, match="naslov nima metapodatkov"):
        generator.extract_heading_metadata(
            "<!-- pos-heading: package=lite -->\n# Naslov",
            "missing-id.md",
        )


def test_rejects_unknown_package() -> None:
    with pytest.raises(ValueError, match="paket 'premium' ni v osrednjem katalogu"):
        generator.extract_heading_metadata(
            f"{metadata('bad', 'premium')}\n# Naslov",
            "unknown.md",
        )


def test_rejects_orphan_or_non_immediate_metadata() -> None:
    with pytest.raises(ValueError, match="niso neposredno"):
        generator.extract_heading_metadata(
            f"{metadata('orphan')}\n\n# Naslov",
            "orphan.md",
        )

    with pytest.raises(ValueError, match="osiroteli"):
        generator.extract_heading_metadata(metadata("end"), "orphan-end.md")


def test_legacy_sequence_manifest_fails_closed() -> None:
    with pytest.raises(ValueError, match="naslov nima metapodatkov"):
        generator.markdown_to_flowables(
            "<!-- pos-packages: lite -->\n# Naslov",
            styles={},
            content_width=500,
            chapter_number=1,
            source_name="legacy.md",
        )


def rendered_heading_labels(source: str) -> list[str]:
    generator.register_fonts()
    flowables = generator.markdown_to_flowables(
        source,
        generator.make_styles(),
        content_width=500,
        chapter_number=1,
        source_name="render.md",
    )
    return [
        flowable._manual_heading_text
        for flowable in flowables
        if hasattr(flowable, "_manual_heading_text")
    ]


def test_filtered_heading_keeps_following_heading_package_and_renders_badges() -> None:
    source = (
        f"{metadata('chapter', 'lite')}\n# Poglavje\n\n"
        f"{metadata('exercise', 'extended')}\n## Vaja za utrjevanje\n\n"
        "Ta odsek se v priročniku ne prikaže.\n\n"
        f"{metadata('procedure', 'standard')}\n## Postopek"
    )

    labels = rendered_heading_labels(source)

    assert labels == ["1. Poglavje [POS Lite]", "1. Postopek [POS Standard]"]


def test_reordering_rendered_blocks_preserves_visible_package_labels() -> None:
    first = (
        f"{metadata('chapter', 'lite')}\n# Poglavje\n\n"
        f"{metadata('alpha', 'standard')}\n## Alpha\n\n"
        f"{metadata('beta', 'extended')}\n## Beta"
    )
    second = (
        f"{metadata('chapter', 'lite')}\n# Poglavje\n\n"
        f"{metadata('beta', 'extended')}\n## Beta\n\n"
        f"{metadata('alpha', 'standard')}\n## Alpha"
    )

    assert rendered_heading_labels(first) == [
        "1. Poglavje [POS Lite]",
        "1. Alpha [POS Standard]",
        "2. Beta [POS Extended]",
    ]
    assert rendered_heading_labels(second) == [
        "1. Poglavje [POS Lite]",
        "1. Beta [POS Extended]",
        "2. Alpha [POS Standard]",
    ]


def test_all_manual_sources_have_unique_metadata_for_every_heading() -> None:
    seen_ids: set[str] = set()

    for _, _, filename in generator.SOURCE_FILES:
        source = (generator.SOURCE_DIR / filename).read_text(encoding="utf-8")
        cleaned, headings = generator.extract_heading_metadata(
            source,
            filename,
            seen_ids,
        )

        assert len(headings) == sum(
            line.lstrip().startswith(("# ", "## ", "### ", "#### "))
            for line in cleaned.splitlines()
        )
        assert "pos-heading:" not in cleaned


def test_manual_heading_package_assignments_match_migration_snapshot() -> None:
    assignments: list[str] = []
    seen_ids: set[str] = set()

    for _, _, filename in generator.SOURCE_FILES:
        source = (generator.SOURCE_DIR / filename).read_text(encoding="utf-8")
        _, headings = generator.extract_heading_metadata(source, filename, seen_ids)
        assignments.extend(
            f"{filename}:{identifier}:{package}"
            for identifier, package in headings
        )

    digest = hashlib.sha256("\n".join(assignments).encode()).hexdigest()
    assert digest == "fc5180139c5872cd1fe1c2117f5f1b6d424924fc8c3897ce4e097e7664cec33d"


def test_pdf_chapter_titles_match_pos_manual_navigation() -> None:
    catalog = (ROOT / "artifacts/pos/src/manual/data/chapters.ts").read_text(
        encoding="utf-8"
    )
    titles = re.findall(r'title: "([^"]+)"', catalog)
    assert len(titles) == len(generator.SOURCE_FILES)
    assert titles == [title for _, title, _ in generator.SOURCE_FILES]


def test_published_manual_matches_versioned_pdf() -> None:
    assert generator.MANUAL_VERSION == "8.15"
    assert generator.MANUAL_RELEASE_DATE.strftime("%d.%m.%Y") == "17.10.2026"
    assert generator.OUTPUT.exists()
    assert generator.PUBLIC_OUTPUT.read_bytes() == generator.OUTPUT.read_bytes()


def test_cash_movement_instructions_cover_close_and_actual_bank_withdrawal() -> None:
    source = (generator.SOURCE_DIR / "06-izmene-porocila-nastavitve.md").read_text(encoding="utf-8")
    for phrase in (
        "pred Z-poročilom", "OSNUTEK", "POTRJEN", "PP001-B001",
        "D 220 / K 100", "D 100 / K 109", "D 109 / K 110",
        "D 109 / K 100", "D 110 / K 109",
        "250,00 EUR in 200,00 EUR", "50,00 EUR nastavljenega menjalnega denarja",
        "pripravljavec svojega premika ne more potrditi sam",
    ):
        assert phrase in source
    detailed = (generator.SOURCE_DIR / "08-nastavitve-po-sklopih.md").read_text(encoding="utf-8")
    assert "`DVIG_GOTOVINE` je **dvig z bančnega TRR**, ne odvzem iz predala." in detailed
    assert "`DVIG_GOTOVINE` je dvig gotovine iz blagajne." not in detailed


def test_current_manual_covers_all_recent_pos_change_groups() -> None:
    expected = {
        "04-zaloge-dokumenti.md": [
            "pos-current-article-actions", "pos-current-automatic-drink-normatives",
            "pos-current-prepared-base-unit", "pos-current-pizza-modifier-kds-routing",
            "pos-baked-desserts-tray-recipe", "pos-baked-desserts-tray-example",
            "pos-baked-desserts-preparation-sale",
        ],
        "05-pripravljena-hrana-qr-telefon.md": [
            "pos-current-kds-status-notifications", "pos-current-kds-prepared-availability",
        ],
        "06-izmene-porocila-nastavitve.md": [
            "pos-02-monthly-contract-invoices", "pos-02-monthly-contract-eslog-bizbox",
            "pos-monthly-contract-delivery-states", "pos-monthly-contract-handover-checklist",
            "pos-current-togo-print-projection",
        ],
        "07-zacetek-dela-dostop.md": [
            "pos-current-prepared-quantities-costing", "pos-current-import-vat-fx-review",
            "pos-current-import-fixed-asset-review",
        ],
        "09-postopki-po-vlogah.md": ["pos-current-platform-unit-context"],
    }
    for filename, identifiers in expected.items():
        source = (generator.SOURCE_DIR / filename).read_text(encoding="utf-8")
        for identifier in identifiers:
            assert f"id={identifier} " in source
    shift = (generator.SOURCE_DIR / "02-placila-racuni-furs-tisk.md").read_text(encoding="utf-8")
    assert "pos-02-monthly-contract-invoices" not in shift


def test_short_break_instructions_do_not_deny_existing_controls() -> None:
    source = (generator.SOURCE_DIR / "08-nastavitve-po-sklopih.md").read_text(encoding="utf-8")
    short = source.split("### 12.1 Odmor", 1)[1].split("### 12.2", 1)[0]
    assert "ni potrjenega gumba" not in source
    for phrase in ("Plačan odmor", "Neplačan odmor", "Zaključi odmor",
                   "izmene ni mogoče zaključiti", "Obračun ur"):
        assert phrase in short
    assert "Tipični primeri so polog menjalnega denarja, dvig gotovine v sef" not in source


def test_catalog_import_instructions_match_selective_ui_not_old_dialog() -> None:
    chapter = (generator.SOURCE_DIR / "04-zaloge-dokumenti.md").read_text(encoding="utf-8")
    section = chapter.split("### 4.2 Nov nabavni artikel", 1)[1].split("### 4.3", 1)[0]
    assert "Uvozi označene" in section
    assert "Začetni izbor je prazen" in section
    assert "ne odpre več starega pogovornega okna" in section
    summary = (generator.SOURCE_DIR / "12-spremembe-in-dopolnitve.md").read_text(encoding="utf-8")
    assert "»Naloži v šifrant«" not in summary


def test_current_review_includes_function_policy_email_and_bridge() -> None:
    source = (generator.SOURCE_DIR / "09-postopki-po-vlogah.md").read_text(encoding="utf-8")
    for identifier in ("pos-current-unit-function-policy", "pos-current-permanent-temporary-units",
                       "pos-current-mail-business-identity", "pos-current-viva-bridge-installation"):
        assert f"id={identifier} " in source
    assert "Prva enota podjetja se ustvari kot stalna" in source
    assert "Vrsta gostinskega obrata je predloga" in source
    assert "Isti plačilni poskus" in source or "istega poskusa" in source