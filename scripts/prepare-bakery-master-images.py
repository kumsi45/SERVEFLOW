from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(r"C:\Users\user\.codex\generated_images\019fb56f-099b-7b50-806f-ab9559d6776d")
SPEC_PATH = ROOT / "src/modules/setup-wizard/data/masterDishSpecifications.v1.json"
MANIFEST_PATH = ROOT / "src/modules/setup-wizard/data/masterBakeryImageLibrary.v1.json"
WIDTHS = (2048, 1280, 1024, 768, 512, 320)
CATEGORIES = ("Bread", "Bakery", "Pastries")
SOURCES = {
    "Brown Bread": "exec-531d96d1-931c-463a-848e-f08de0b5723c.png",
    "French Bread": "exec-345a607f-f511-4370-b770-d03c76026c49.png",
    "Milk Bread": "exec-b223f16c-70e8-4562-a6fd-29aa60a2809f.png",
    "White Bread": "exec-30361110-0185-4d10-b9b4-e8daa01bbe0e.png",
    "Brownie": "exec-d1ea0268-79ae-4e82-972f-2c63ca80cc91.png",
    "Cookies": "exec-713cf04a-017a-4c6d-baa0-4bcc56ae59c8.png",
    "Croissant": "exec-a0e9d0b9-f691-4bcc-828f-7191ff07d80c.png",
    "Danish Pastry": "exec-1ddc56fa-04b0-45d2-9d40-91d00842492c.png",
    "Donut": "exec-a291f005-4861-46e1-983a-5bdfccb55ddf.png",
    "Muffin": "exec-5f8bf72b-0efe-411e-b6b2-955cbc9c7438.png",
    "Puff Pastry": "exec-31acd4ec-4fb4-463d-8844-312c741dfe71.png",
}
IDENTITIES = {
    "Brown Bread": ("Bakery", "bakery/bakery/brown-bread"),
    "French Bread": ("Bakery", "bakery/bakery/french-bread"),
    "Milk Bread": ("Bakery", "bakery/bakery/milk-bread"),
    "White Bread": ("Bakery", "bakery/bakery/white-bread"),
    "Croissant": ("Bakery", "bakery/bakery/croissant"),
    "Danish Pastry": ("Bakery", "bakery/bakery/danish-pastry"),
    "Puff Pastry": ("Bakery", "bakery/bakery/puff-pastry"),
    "Brownie": ("Cafe", "cafe/desserts/brownie"),
    "Cookies": ("Cafe", "cafe/bakery/cookies"),
    "Donut": ("Cafe", "cafe/bakery/donut"),
    "Muffin": ("Cafe", "cafe/bakery/muffin"),
}

def read_env() -> dict[str, str]:
    values = {}
    for line in (ROOT / ".env.local").read_text(encoding="utf-8").splitlines():
        if "=" not in line or line.lstrip().startswith("#"): continue
        key, value = line.split("=", 1); values[key.strip()] = value.strip().strip("'\"")
    return values

specifications = json.loads(SPEC_PATH.read_text(encoding="utf-8"))["specifications"]
approved = [e for e in specifications if e["active"] and e["category"] in CATEGORIES]
spec_by_name = {e["item_name"]: e for e in approved}
if set(SOURCES) != set(spec_by_name) or set(IDENTITIES) != set(spec_by_name):
    raise RuntimeError("Phase sources and identities must exactly match frozen specifications.")
supabase_url = read_env().get("VITE_SUPABASE_URL", "").rstrip("/")
if not supabase_url: raise RuntimeError("VITE_SUPABASE_URL is required.")

created_at = datetime.now(timezone.utc).isoformat(); records = []
for item_name, source_name in SOURCES.items():
    specification = spec_by_name[item_name]; restaurant_type, base_storage_path = IDENTITIES[item_name]
    if restaurant_type not in specification["business_types_using_this_item"]: raise RuntimeError(f"Unexpected identity for {item_name}.")
    slug = specification["slug"]; base_path = Path(base_storage_path); source = SOURCE_ROOT / source_name
    if not source.exists(): raise RuntimeError(f"Missing accepted source for {item_name}: {source}")
    variants = []
    with Image.open(source) as opened:
        image = opened.convert("RGB")
        if image.width != image.height: raise RuntimeError(f"Source is not square for {item_name}: {image.size}")
        for width in WIDTHS:
            relative_path = base_path / "v001" / f"{slug}-v001-{width}w.webp"; destination = ROOT / "public/smart-menu-images" / relative_path
            if destination.exists():
                with Image.open(destination) as existing:
                    if existing.format != "WEBP" or existing.size != (width, width): raise RuntimeError(f"Existing immutable variant is invalid: {relative_path.as_posix()}")
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                image.resize((width, width), Image.Resampling.LANCZOS).save(destination, "WEBP", quality=95, method=6, exact=True)
            payload = destination.read_bytes(); storage_path = relative_path.as_posix()
            variants.append({"width": width, "height": width, "storage_path": storage_path, "public_url": f"{supabase_url}/storage/v1/object/public/smart-menu-images/{storage_path}", "mime_type": "image/webp", "byte_size": len(payload), "checksum_sha256": hashlib.sha256(payload).hexdigest()})
    records.append({"dish_id": specification["id"], "dish_name": item_name, "slug": slug, "category": specification["category"], "restaurant_type": restaurant_type, "provider": "openai-built-in-imagegen", "provider_key": "openai-built-in-imagegen", "version": 1, "version_label": "v001", "base_storage_path": base_path.as_posix(), "storage_path": variants[0]["storage_path"], "public_url": variants[0]["public_url"], "checksum_sha256": variants[0]["checksum_sha256"], "mime_type": "image/webp", "width": 2048, "height": 2048, "lifecycle": "PENDING_REVIEW", "lifecycle_history": ["GENERATING", "PENDING_REVIEW"], "created_at": created_at, "style_guide_id": "serveflow-food-photography-v1", "style_guide_version": "1.0", "responsive_variants": variants})

checksums = [v["checksum_sha256"] for r in records for v in r["responsive_variants"]]; paths = [v["storage_path"] for r in records for v in r["responsive_variants"]]
if len(checksums) != len(set(checksums)) or len(paths) != len(set(paths)): raise RuntimeError("Duplicate checksum or path detected.")
MANIFEST_PATH.write_text(json.dumps({"library": "ServeFlow Phase 9.13.12 Bakery Master Images", "version": "1.0", "phase": "9.13.12", "categories": list(CATEGORIES), "generated_at": created_at, "lifecycle": "PENDING_REVIEW", "images": records}, indent=2) + "\n", encoding="utf-8")
print(f"Prepared {len(records)} masters and {len(checksums)} unique WebP variants in PENDING_REVIEW.")
