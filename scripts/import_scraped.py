#!/usr/bin/env python3
"""Turn a raw certificate-archive export into a BeePath dataset (data/<name>/).

    python3 scripts/import_scraped.py raw/archive.json --out data/binus
    python3 scripts/import_scraped.py raw/archive.csv  --out data/binus --field-map scripts/field_map.example.json

Input: a JSON array (or {"items": [...]}) or a CSV with one row per certificate.
This script does NOT scrape. It only converts a file you already have.

What it does
  1. Keeps ONLY these fields: title, issuer, category, description, url, price, hours, level, provider type.
     Everything else in the raw rows (names, IDs, emails, anything personal) is dropped.
  2. Skips rows whose text looks like an email or a long ID number, and reports how many.
  3. De-duplicates, gives each certificate a stable id (same certificate => same id on re-import,
     so ratings keep pointing at the right certificate).
  4. Suggests certificate -> skill mappings with a KEYWORD BASELINE using the keywords in data/roles.json.
     This is a rough first pass (method: "keyword"). Replace or refine it with your offline LLM tagging,
     then review review.csv by hand before you call the mapping curated.

Afterwards: run `python3 scripts/validate_data.py <name>`, then open the app at /?dataset=<name>
or set CERT_DATASET in js/config.js. Keep raw files and data/binus/ out of git (see .gitignore).
"""
import argparse, csv, datetime, hashlib, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIELDS = ["title", "issuer", "category", "description", "url", "price", "hours", "level", "provider_type"]
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
LONG_NUMBER = re.compile(r"\b\d{10,}\b")


def load_raw(path):
    p = Path(path)
    if p.suffix.lower() == ".csv":
        with p.open(newline="", encoding="utf-8-sig") as f:
            return list(csv.DictReader(f))
    data = json.loads(p.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = next((v for v in data.values() if isinstance(v, list)), [])
    if not isinstance(data, list):
        sys.exit("Raw file must contain a list of certificate rows.")
    return data


def pick(row, names):
    """names: a column name or a list of fallback names."""
    for n in ([names] if isinstance(names, str) else names):
        if n in row and row[n] not in (None, ""):
            return row[n]
    return None


def clean(s, limit):
    if s is None:
        return None
    s = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", str(s))).strip()
    return s[:limit] or None


def parse_price(v):
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        return {"amount": max(0, int(v)), "currency": "IDR"}
    s = str(v).strip().lower()
    if re.search(r"\b(free|gratis)\b", s):
        return {"amount": 0, "currency": "IDR"}
    if "$" in s or "usd" in s:
        m = re.search(r"\d+(?:[.,]\d+)?", s)
        return {"amount": float(m.group().replace(",", ".")), "currency": "USD"} if m else None
    digits = re.sub(r"[^\d]", "", s)  # "Rp 450.000" -> 450000
    return {"amount": int(digits), "currency": "IDR"} if digits else None


def parse_hours(v):
    if v in (None, ""):
        return None
    if isinstance(v, (int, float)):
        return float(v) if v > 0 else None
    s = str(v).lower()
    m = re.search(r"\d+(?:[.,]\d+)?", s)
    if not m:
        return None
    n = float(m.group().replace(",", "."))
    if "min" in s:
        n /= 60
    return round(n, 1) if n > 0 else None


def parse_level(v):
    s = str(v or "").lower()
    for key, name in (("begin", "Beginner"), ("dasar", "Beginner"), ("inter", "Intermediate"), ("menengah", "Intermediate"), ("advan", "Advanced"), ("lanjut", "Advanced")):
        if key in s:
            return name
    return None


def safe_url(v):
    s = str(v or "").strip()
    return s if re.match(r"^https?://", s, re.I) else None


def stable_id(title, issuer, url):
    h = hashlib.sha1(f"{title}|{issuer}|{url or ''}".lower().encode()).hexdigest()[:10]
    return f"b-{h}"


def kw_regex(kw):
    return re.compile(rf"(?<![a-z0-9]){re.escape(kw.lower())}(?![a-z0-9])")


def suggest(cert, skills, min_conf, top_n):
    title = cert["title"].lower()
    rest = " ".join(str(cert.get(k) or "") for k in ("category", "description")).lower()
    scored = []
    for sk in skills:
        t_hits = sum(1 for kw in sk["keywords"] if kw_regex(kw).search(title))
        o_hits = sum(1 for kw in sk["keywords"] if not kw_regex(kw).search(title) and kw_regex(kw).search(rest))
        conf = round(min(1.0, (2 * t_hits + o_hits) / 4), 2)
        if conf >= min_conf:
            scored.append((conf, sk["id"]))
    scored.sort(reverse=True)
    return scored[:top_n]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("raw")
    ap.add_argument("--out", required=True, help="output folder, e.g. data/binus")
    ap.add_argument("--field-map", help="JSON: BeePath field -> raw column name (or list of fallbacks)")
    ap.add_argument("--roles", default=str(ROOT / "data" / "roles.json"))
    ap.add_argument("--min-confidence", type=float, default=0.5)
    ap.add_argument("--top-skills", type=int, default=3, help="max skills mapped per certificate")
    ap.add_argument("--source", default="binus_archive")
    ap.add_argument("--label", default="Binus archive data")
    args = ap.parse_args()

    fmap = {f: f for f in FIELDS}
    if args.field_map:
        fmap.update(json.loads(Path(args.field_map).read_text(encoding="utf-8")))

    roles = json.loads(Path(args.roles).read_text(encoding="utf-8"))
    skills = [s for r in roles if r["status"] == "available" for s in r["skills"]]

    rows = load_raw(args.raw)
    certs, seen, skipped_pii, skipped_empty, dupes = [], set(), 0, 0, 0
    for row in rows:
        title = clean(pick(row, fmap["title"]), 200)
        if not title:
            skipped_empty += 1
            continue
        issuer = clean(pick(row, fmap["issuer"]), 120)
        category = clean(pick(row, fmap["category"]), 80)
        desc = clean(pick(row, fmap["description"]), 600)
        text = " ".join(x or "" for x in (title, issuer, category, desc))
        if EMAIL.search(text) or LONG_NUMBER.search(text):
            skipped_pii += 1
            continue
        key = (title.lower(), (issuer or "").lower())
        if key in seen:
            dupes += 1
            continue
        seen.add(key)
        url = safe_url(pick(row, fmap["url"]))
        ptype_raw = str(pick(row, fmap["provider_type"]) or issuer or "").lower()
        certs.append({
            "id": stable_id(title, issuer or "", url),
            "title": title, "issuer": issuer, "category": category, "description": desc,
            "providerType": "campus" if re.search(r"binus|campus|internal", ptype_raw) else "third_party",
            "url": url,
            "price": parse_price(pick(row, fmap["price"])),
            "hours": parse_hours(pick(row, fmap["hours"])),
            "level": parse_level(pick(row, fmap["level"])),
            "source": args.source, "sample": False,
        })

    maps, review = [], []
    for c in certs:
        for conf, sid in suggest(c, skills, args.min_confidence, args.top_skills):
            maps.append({"certificateId": c["id"], "skillId": sid, "relevance": conf, "method": "keyword"})
            review.append((c["id"], c["title"], sid, conf))
    review.sort(key=lambda r: r[3])

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    mapped = len({m["certificateId"] for m in maps})
    meta = {
        "dataSource": args.source,
        "label": args.label,
        "importedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "notice": "Mappings were suggested by a keyword baseline. Review them before presenting them as curated.",
        "counts": {"rawRows": len(rows), "certificates": len(certs), "mapped": mapped, "mappings": len(maps),
                   "skippedPossiblePersonalData": skipped_pii, "skippedEmpty": skipped_empty, "duplicates": dupes},
    }
    (out / "certificates.json").write_text(json.dumps(certs, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (out / "mappings.json").write_text(json.dumps(maps, indent=2) + "\n", encoding="utf-8")
    (out / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    with (out / "review.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["certificateId", "title", "skillId", "confidence"])
        w.writerows(review)

    print(f"Read {len(rows)} rows -> {len(certs)} certificates ({dupes} duplicates, {skipped_empty} empty, {skipped_pii} skipped for possible personal data)")
    print(f"Mapped {mapped} certificates to skills ({len(maps)} mappings); {len(certs) - mapped} left unmapped on purpose")
    print(f"Wrote {out}/ (certificates.json, mappings.json, meta.json, review.csv)")
    print("Next: review review.csv, run scripts/validate_data.py, then open the app at /?dataset=" + out.name)
    print("Reminder: keep the raw file and this folder out of git, your demo and your video unless you have permission.")


if __name__ == "__main__":
    main()
