from __future__ import annotations

import importlib.util
import hashlib
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
    assert digest == "8b9d2fba84f68c59d563d2a455c2890767f180ff10b65a1d1374a2cdd2c06e0d"