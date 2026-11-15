"""Validate the actual MediaWiki XML revision bodies, not just source page files."""
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

corpus = Path(__file__).resolve().parent.parent / "corpus"
manifest = json.loads((corpus / "manifest.json").read_text(encoding="utf-8"))
ns = {"m": "http://www.mediawiki.org/xml/export-0.11/"}
pages = ET.parse(corpus / "pages.xml").findall("m:page", ns)
expected = {page["title"]: page for page in manifest["pages"]}
assert len(pages) == len(expected) == 381
seen = set()
for page in pages:
    title = page.findtext("m:title", namespaces=ns)
    assert title in expected and title not in seen, title
    seen.add(title)
    assert page.findtext("m:ns", namespaces=ns) == "0", title
    revisions = page.findall("m:revision", ns)
    assert len(revisions) == 1, title
    content = revisions[0].findtext("m:text", namespaces=ns).encode("utf-8")
    assert hashlib.sha256(content).hexdigest() == expected[title]["sha256"], title
    assert len(content) == expected[title]["bytes"], title
print("XML:381 namespace-0 pages, one revision each; all imported body hashes match")
