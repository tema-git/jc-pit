#!/usr/bin/env python3
"""Check the public site and Bunny manifest without fetching external URLs."""

from collections import Counter
from dataclasses import dataclass, field
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import sys
import xml.etree.ElementTree as ET
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
SITE_URL = "https://hjcpit.com/"
SITEMAP_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
PUBLIC_ROOT = {
    "index.html", "choice.html", "catalog.html", "archive.html",
    "app.js", "metal-selection.js", "warm-choice.js", "style.css",
    "products.json", "robots.txt", "sitemap.xml",
}
IDREFS = {
    "aria-activedescendant", "aria-controls", "aria-describedby",
    "aria-details", "aria-errormessage", "aria-flowto",
    "aria-labelledby", "aria-owns", "for", "headers", "list",
}
ISSUES = []


def require(condition, message):
    if not condition:
        ISSUES.append(message)
    return condition


@dataclass
class Element:
    tag: str
    attrs: dict
    line: int
    photos: list = field(default_factory=list)


class Page(HTMLParser):
    def __init__(self, name):
        super().__init__()
        self.name = name
        self.elements = []
        self.archive_card = None
        self.feed((ROOT / name).read_text(encoding="utf-8"))
        self.close()
        self.ids = Counter(e.attrs["id"] for e in self.elements if "id" in e.attrs)

    def handle_starttag(self, tag, attrs):
        element = Element(tag, dict(attrs), self.getpos()[0])
        self.elements.append(element)
        if "data-archive-photo" in element.attrs:
            self.archive_card = element
        elif tag == "img" and self.archive_card is not None:
            self.archive_card.photos.append(element)

    def handle_endtag(self, tag):
        if self.archive_card is not None and tag == self.archive_card.tag:
            self.archive_card = None


def check_manifest():
    paths = (ROOT / "infra/bunny-files.txt").read_text(encoding="utf-8").splitlines()
    for name, count in Counter(paths).items():
        require(count == 1, f"infra/bunny-files.txt: duplicate entry {name!r}")
        path = ROOT / name
        allowed = name in PUBLIC_ROOT or name.startswith("assets/")
        require(
            allowed and ".." not in PurePosixPath(name).parts
            and path.resolve().is_relative_to(ROOT) and path.is_file()
            and not path.is_symlink(),
            f"infra/bunny-files.txt: invalid or missing public file {name!r}",
        )
    for name in sorted(PUBLIC_ROOT - set(paths)):
        require(False, f"infra/bunny-files.txt: required file missing: {name}")
    return set(paths)


def local_reference(ref, source, location, manifest, *, external=True):
    try:
        url = urlsplit(ref)
    except ValueError:
        require(False, f"{location}: invalid URL {ref!r}")
        return None
    if url.scheme or url.netloc:
        require(external, f"{location}: expected a local file: {ref!r}")
        return None

    path = unquote(url.path)
    if not path:
        return source
    if not require(not path.startswith("/"), f"{location}: use a relative URL for GitHub Pages: {ref!r}"):
        return None
    if path.endswith("/"):
        path = posixpath.join(path, "index.html")
    name = posixpath.normpath(posixpath.join(posixpath.dirname(source), path))
    file = ROOT / name
    if not require(
        file.resolve().is_relative_to(ROOT) and file.is_file(),
        f"{location}: missing local file {ref!r}",
    ):
        return None
    require(name in manifest, f"{location}: missing from Bunny manifest: {name}")
    return name


def srcset_entries(value):
    # Public asset URLs are relative paths without unescaped spaces or commas.
    return [part.split() for part in value.split(",") if part.strip()]


def positive_int(value):
    return bool(value and value.isascii() and value.isdecimal() and int(value) > 0)


def check_pages(pages, manifest):
    for name, page in pages.items():
        for id_, count in page.ids.items():
            require(id_ and count == 1, f"{name}: empty or duplicate id {id_!r}")
        for element in page.elements:
            attrs = element.attrs
            where = f"{name}:{element.line} <{element.tag}>"
            for key in IDREFS.intersection(attrs):
                targets = (attrs[key] or "").split()
                require(targets, f"{where}: empty {key}")
                for target in targets:
                    require(target in page.ids, f"{where}: {key} points to missing id {target!r}")
            for key in ("href", "src", "poster", "data-archive-photo"):
                if key not in attrs:
                    continue
                value = attrs[key] or ""
                target = local_reference(value, name, where, manifest)
                if key == "href" and target in pages:
                    fragment = unquote(value.partition("#")[2])
                    if fragment:
                        require(fragment in pages[target].ids, f"{where}: missing anchor {value!r}")
            for parts in srcset_entries(attrs.get("srcset") or ""):
                local_reference(parts[0], name, where, manifest)
            if element.tag == "img":
                require("alt" in attrs, f"{where}: missing alt for {attrs.get('src')!r}")
                require(
                    positive_int(attrs.get("width")) and positive_int(attrs.get("height")),
                    f"{where}: missing dimensions for {attrs.get('src')!r}",
                )


def check_indexing(pages):
    canonical_urls = []
    for name, page in pages.items():
        canonical = SITE_URL if name == "index.html" else SITE_URL + name
        canonical_urls.append(canonical)
        links = [
            e.attrs.get("href") for e in page.elements
            if e.tag == "link" and e.attrs.get("rel") == "canonical"
        ]
        require(links == [canonical], f"{name}: expected canonical {canonical}")
        for e in page.elements:
            agent = (e.attrs.get("name") or "").lower()
            if e.tag == "meta" and agent in {"robots", "googlebot", "yandex"}:
                directives = re.split(r"[,\s]+", (e.attrs.get("content") or "").lower())
                require(
                    not {"noindex", "none"}.intersection(directives),
                    f"{name}: {agent} meta tag blocks production indexing",
                )

    robots = (ROOT / "robots.txt").read_text(encoding="utf-8")
    require(
        robots.splitlines() == ["User-agent: *", "Allow: /", "", f"Sitemap: {SITE_URL}sitemap.xml"],
        "robots.txt: expected unrestricted crawling and the production sitemap URL",
    )
    try:
        sitemap = ET.parse(ROOT / "sitemap.xml").getroot()
    except (ET.ParseError, OSError) as error:
        require(False, f"sitemap.xml: {error}")
        return
    locations = sitemap.findall(f"{SITEMAP_NS}url/{SITEMAP_NS}loc")
    require(
        sitemap.tag == f"{SITEMAP_NS}urlset"
        and Counter(location.text for location in locations) == Counter(canonical_urls),
        "sitemap.xml: expected exactly the canonical production URLs",
    )


def check_products(page, manifest):
    products = json.loads((ROOT / "products.json").read_text(encoding="utf-8"))
    if isinstance(products, dict):
        products = products.get("products")
    if not require(isinstance(products, list) and products, "products.json: expected a nonempty product list"):
        return
    seen = set()
    catalog = set()
    for product in products:
        id_ = product.get("id") if isinstance(product, dict) else None
        if not require(isinstance(id_, str) and id_, "products.json: product without a valid id"):
            continue
        where = f"products.json ({id_})"
        require(id_ not in seen, f"{where}: duplicate id")
        seen.add(id_)
        if not product.get("archive") and product.get("category") != "archive":
            catalog.add(id_)
        require(isinstance(product.get("name"), str) and product["name"].strip(), f"{where}: missing name")
        images = product.get("images")
        if require(isinstance(images, list) and images, f"{where}: expected at least one image"):
            for image in images:
                src = image.get("src") or image.get("url") if isinstance(image, dict) else image
                if require(isinstance(src, str) and src.startswith("assets/"), f"{where}: invalid image {image!r}"):
                    local_reference(src, "products.json", where, manifest, external=False)
    cards = Counter(e.attrs["data-product"] for e in page.elements if "data-product" in e.attrs)
    for id_, count in cards.items():
        require(count == 1, f"{page.name}: duplicate catalog card {id_!r}")
        require(id_ in catalog, f"{page.name}: card has no catalog product {id_!r}")
    for id_ in sorted(catalog - cards.keys()):
        require(False, f"{page.name}: product has no card {id_!r}")


def webp_size(name):
    """Read dimensions from the first WebP chunk (VP8, VP8L or VP8X)."""
    path = ROOT / name
    with path.open("rb") as file:
        header = file.read(30)
    size = path.stat().st_size
    if (
        len(header) < 25 or header[:4] != b"RIFF" or header[8:12] != b"WEBP"
        or int.from_bytes(header[4:8], "little") + 8 != size
        or int.from_bytes(header[16:20], "little") + 20 > size
    ):
        require(False, f"{name}: invalid WebP container")
        return None
    kind = header[12:16]
    if kind == b"VP8L" and header[20] == 0x2F:
        packed = int.from_bytes(header[21:25], "little")
        return (packed & 0x3FFF) + 1, ((packed >> 14) & 0x3FFF) + 1
    if kind == b"VP8X" and len(header) >= 30:
        return int.from_bytes(header[24:27], "little") + 1, int.from_bytes(header[27:30], "little") + 1
    if kind == b"VP8 " and len(header) >= 30 and header[23:26] == b"\x9d\x01\x2a":
        width = int.from_bytes(header[26:28], "little") & 0x3FFF
        height = int.from_bytes(header[28:30], "little") & 0x3FFF
        if width and height:
            return width, height
    require(False, f"{name}: invalid WebP dimensions")
    return None


def check_archive(page, manifest):
    cards = [e for e in page.elements if "data-archive-photo" in e.attrs]
    require(len(cards) >= 2, f"{page.name}: expected multiple archive photos")
    seen_originals = set()
    seen_thumbs = set()
    for card in cards:
        original = card.attrs["data-archive-photo"] or ""
        where = f"{page.name}:{card.line} ({original})"
        require(
            original.startswith("assets/") and not original.startswith("assets/archive-thumbs/"),
            f"{where}: expected a separate full-size archive image",
        )
        original_path = local_reference(original, page.name, where, manifest, external=False)
        if not original or not original_path:
            continue
        require(original_path not in seen_originals, f"{where}: duplicate archive original")
        seen_originals.add(original_path)
        original_size = webp_size(original_path)
        if not require(len(card.photos) == 1, f"{where}: expected one thumbnail <img>"):
            continue
        thumb = card.photos[0].attrs
        variants = srcset_entries(thumb.get("srcset") or "")
        descriptors = sorted(parts[1] for parts in variants if len(parts) == 2)
        if not require(
            len(variants) == 2 and descriptors == ["320w", "640w"],
            f"{where}: expected exactly 320w and 640w thumbnail variants",
        ):
            continue
        require(bool((thumb.get("sizes") or "").strip()), f"{where}: missing thumbnail sizes")
        require(thumb.get("src") in {parts[0] for parts in variants}, f"{where}: src must be a thumbnail")
        for src, descriptor in variants:
            if not require(src.startswith("assets/archive-thumbs/"), f"{where}: invalid thumbnail location {src!r}"):
                continue
            name = local_reference(src, page.name, where, manifest, external=False)
            if not name:
                continue
            require(name not in seen_thumbs, f"{where}: reused thumbnail {name}")
            seen_thumbs.add(name)
            dimensions = webp_size(name)
            if not dimensions:
                continue
            width, height = dimensions
            require(width == int(descriptor[:-1]), f"{name}: expected width {descriptor[:-1]}, got {width}")
            if original_size:
                full_width, full_height = original_size
                expected_height = round(full_height * width / full_width)
                require(abs(height - expected_height) <= 1, f"{name}: thumbnail changes the original aspect ratio")
    return len(cards)


def main():
    manifest = check_manifest()
    pages = {name: Page(name) for name in sorted(PUBLIC_ROOT) if name.endswith(".html")}
    check_pages(pages, manifest)
    check_indexing(pages)
    check_products(pages["catalog.html"], manifest)
    archive_count = check_archive(pages["archive.html"], manifest)
    css = (ROOT / "style.css").read_text(encoding="utf-8")
    for url in re.findall(r"url\(\s*['\"]?([^'\"\s)]+)", css):
        local_reference(url, "style.css", "style.css", manifest)
    if ISSUES:
        print("\n".join(dict.fromkeys(ISSUES)), file=sys.stderr)
        return 1
    print(f"Checked {len(pages)} pages, {archive_count} archive photo sets and {len(manifest)} public files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
