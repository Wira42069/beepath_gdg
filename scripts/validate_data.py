#!/usr/bin/env python3
"""Validate BeePath data files. Run before every demo, recording or deploy.

    python3 scripts/validate_data.py            # roles, seed ratings, and every data/<dataset>/ found
    python3 scripts/validate_data.py binus      # one dataset

Exit code 1 if any error is found. Warnings never fail the run.
Checks include a privacy scan: certificate text must not contain emails or long ID-like numbers.
"""
import json, re, sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
LONG_NUMBER = re.compile(r"\b\d{10,}\b")  # student-ID-like
errors, warnings = [], []
err = lambda m: errors.append(m)
warn = lambda m: warnings.append(m)


def load(p):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        err(f"{p}: cannot read ({e})")
        return None


def is_http(u):
    return isinstance(u, str) and re.match(r"^https?://", u, re.I) is not None


def check_roles():
    roles = load(DATA / "roles.json")
    skills = {}
    if not isinstance(roles, list):
        return skills
    seen_roles = set()
    for r in roles:
        if r.get("id") in seen_roles:
            err(f"roles.json: duplicate role id {r.get('id')}")
        seen_roles.add(r.get("id"))
        if r.get("status") not in ("available", "coming_soon"):
            err(f"roles.json: role {r.get('id')} has invalid status {r.get('status')!r}")
        order = []
        for s in r.get("skills", []):
            sid = s.get("id")
            if not sid or sid in skills:
                err(f"roles.json: missing or duplicate skill id {sid!r}")
            skills[sid] = r["id"]
            for f in ("name", "description"):
                if not s.get(f):
                    err(f"roles.json: skill {sid} missing {f}")
            for p in s.get("prerequisites", []):
                if p not in order:
                    err(f"roles.json: skill {sid} lists prerequisite {p} that is unknown or comes later in the path")
            for res in s.get("resources", []):
                if not is_http(res.get("url")):
                    err(f"roles.json: skill {sid} resource has a non-http(s) url: {res.get('url')!r}")
            if not s.get("keywords"):
                warn(f"roles.json: skill {sid} has no keywords (the import script uses them to suggest mappings)")
            order.append(sid)
        if r.get("status") == "available" and not r.get("skills"):
            err(f"roles.json: available role {r.get('id')} has no skills")
    return skills


def check_dataset(name, skills):
    d = DATA / name
    meta, certs, maps = load(d / "meta.json"), load(d / "certificates.json"), load(d / "mappings.json")
    if not (isinstance(meta, dict) and isinstance(certs, list) and isinstance(maps, list)):
        return
    tag = f"[{name}]"
    if name == "sample":
        if meta.get("dataSource") != "sample":
            err(f"{tag} meta.dataSource must be 'sample'")
        if not all(c.get("sample") is True for c in certs):
            err(f"{tag} every certificate in the sample dataset must have sample: true")
    elif meta.get("dataSource") == "sample":
        err(f"{tag} meta says 'sample' but the folder is not data/sample")

    ids = set()
    for c in certs:
        cid = c.get("id")
        if not cid or cid in ids:
            err(f"{tag} missing or duplicate certificate id {cid!r}")
        ids.add(cid)
        if not c.get("title"):
            err(f"{tag} {cid}: missing title")
        if c.get("url") is not None and not is_http(c["url"]):
            err(f"{tag} {cid}: url must be http(s) or null")
        p = c.get("price")
        if p is not None and not (isinstance(p, dict) and isinstance(p.get("amount"), (int, float)) and p["amount"] >= 0):
            err(f"{tag} {cid}: price must be null or {{amount>=0, currency}}")
        h = c.get("hours")
        if h is not None and not (isinstance(h, (int, float)) and h > 0):
            err(f"{tag} {cid}: hours must be null or a positive number")
        text = " ".join(str(c.get(k) or "") for k in ("title", "issuer", "category", "description"))
        if EMAIL.search(text) or LONG_NUMBER.search(text):
            err(f"{tag} {cid}: text looks like it contains an email or ID number (possible personal data)")

    pairs = set()
    for m in maps:
        cid, sid, rel = m.get("certificateId"), m.get("skillId"), m.get("relevance")
        if cid not in ids:
            err(f"{tag} mapping points to unknown certificate {cid!r}")
        if sid not in skills:
            err(f"{tag} mapping points to unknown skill {sid!r}")
        if not (isinstance(rel, (int, float)) and 0 <= rel <= 1):
            err(f"{tag} mapping {cid}->{sid}: relevance must be between 0 and 1")
        if (cid, sid) in pairs:
            err(f"{tag} duplicate mapping {cid}->{sid}")
        pairs.add((cid, sid))

    kw = sum(1 for m in maps if m.get("method") == "keyword")
    if kw:
        warn(f"{tag} {kw} mappings come from the keyword baseline and still need human review (see review.csv)")
    covered = {m.get("skillId") for m in maps}
    for sid in skills:
        if sid not in covered:
            warn(f"{tag} skill {sid} has no certificates")
    print(f"{tag} {len(certs)} certificates, {len(maps)} mappings, {len({m.get('certificateId') for m in maps})} certificates mapped")


def check_seed(skills, datasets):
    seed = load(DATA / "seed_ratings.json")
    if not isinstance(seed, list):
        return
    for i, r in enumerate(seed):
        if r.get("skillId") not in skills:
            err(f"seed_ratings.json[{i}]: unknown skill {r.get('skillId')!r}")
        if not (isinstance(r.get("stars"), int) and 1 <= r["stars"] <= 5):
            err(f"seed_ratings.json[{i}]: stars must be an integer 1-5")
        if not isinstance(r.get("relevant"), bool):
            err(f"seed_ratings.json[{i}]: relevant must be true or false")
    print(f"seed_ratings.json: {len(seed)} ratings" + (" (empty: ratings start from zero)" if not seed else ""))


def main():
    skills = check_roles()
    names = sys.argv[1:] or sorted(p.parent.name for p in DATA.glob("*/certificates.json"))
    for n in names:
        check_dataset(n, skills)
    check_seed(skills, names)
    for w in warnings:
        print("warning:", w)
    for e in errors:
        print("ERROR:", e)
    print(f"\n{len(errors)} error(s), {len(warnings)} warning(s)")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
