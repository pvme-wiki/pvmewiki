"""Check the MediaWiki XML export itself, not just the page files it was built from.

Inputs (read only): wiki-host/corpus/pages.xml and wiki-host/corpus/manifest.json.

Checks that pages.xml holds exactly the manifest's pages, each once, in namespace 0
with a single revision whose text has the manifest's SHA-256 and byte length. This
is the text importDump.php stores, so it catches escaping mistakes that
verify-corpus.mjs, which reads the page files, cannot see.

Output: one summary line on success; an AssertionError naming the page otherwise.
Writes nothing, so it is always safe to rerun.

Usage: python3 wiki-host/tools/verify-xml.py
"""
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

CORPUS = Path(__file__).resolve().parent.parent / "corpus"
NS = {"m": "http://www.mediawiki.org/xml/export-0.11/"}

# Pages in corpus/inputs/titles.json; verify-corpus.mjs checks the per-kind counts.
EXPECTED_PAGES = 381


def check_page(page, expected, seen):
    title = page.findtext("m:title", namespaces=NS)
    assert title in expected and title not in seen, title
    seen.add(title)
    assert page.findtext("m:ns", namespaces=NS) == "0", title
    revisions = page.findall("m:revision", NS)
    assert len(revisions) == 1, title
    content = revisions[0].findtext("m:text", namespaces=NS).encode("utf-8")
    assert hashlib.sha256(content).hexdigest() == expected[title]["sha256"], title
    assert len(content) == expected[title]["bytes"], title


def main():
    manifest = json.loads((CORPUS / "manifest.json").read_text(encoding="utf-8"))
    expected = {page["title"]: page for page in manifest["pages"]}
    pages = ET.parse(CORPUS / "pages.xml").findall("m:page", NS)
    assert len(pages) == len(expected) == EXPECTED_PAGES
    seen = set()
    for page in pages:
        check_page(page, expected, seen)
    print(f"XML:{EXPECTED_PAGES} namespace-0 pages, one revision each; "
          "all imported body hashes match")


main()
