from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
GENERATOR_PATH = ROOT / "scripts" / "generate_pos_manual_pdf.py"
SPEC = importlib.util.spec_from_file_location("generate_pos_manual_pdf", GENERATOR_PATH)
assert SPEC and SPEC.loader
generator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(generator)


def test_accepts_valid_package_manifest() -> None:
    cleaned, packages = generator.extract_package_manifest(
        "<!-- pos-packages: lite, standard*2 -->\n# Naslov\n## Podnaslov",
        "valid.md",
    )

    assert "pos-packages" not in cleaned
    assert packages == ["lite", "standard", "standard"]


def test_rejects_missing_package_manifest() -> None:
    with pytest.raises(ValueError, match="natanko ena oznaka"):
        generator.extract_package_manifest("# Naslov", "missing.md")


def test_rejects_unknown_package() -> None:
    with pytest.raises(ValueError, match="paket 'premium' ni v osrednjem katalogu"):
        generator.extract_package_manifest(
            "<!-- pos-packages: premium -->\n# Naslov",
            "unknown.md",
        )


def test_rejects_wrong_number_of_package_labels() -> None:
    with pytest.raises(
        ValueError,
        match=r"manifest vsebuje 1 oznak, najdenih pa je 2 naslovov",
    ):
        generator.markdown_to_flowables(
            "<!-- pos-packages: lite -->\n# Naslov\n## Podnaslov",
            styles={},
            content_width=500,
            chapter_number=1,
            source_name="count.md",
        )


def test_renaming_heading_does_not_change_package() -> None:
    before = "<!-- pos-packages: lite, extended -->\n# Stari naslov\n## Stari podnaslov"
    after = "<!-- pos-packages: lite, extended -->\n# Novi naslov\n## Novi podnaslov"

    _, packages_before = generator.extract_package_manifest(before, "before.md")
    _, packages_after = generator.extract_package_manifest(after, "after.md")

    assert packages_before == packages_after == ["lite", "extended"]