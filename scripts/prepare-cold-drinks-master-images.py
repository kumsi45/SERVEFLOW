from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(r"C:\Users\user\.codex\generated_images\019fb56f-099b-7b50-806f-ab9559d6776d")
SPEC_PATH = ROOT / "src/modules/setup-wizard/data/masterDishSpecifications.v1.json"
MANIFEST_PATH = ROOT / "src/modules/setup-wizard/data/masterColdDrinksImageLibrary.v1.json"
WIDTHS = (2048, 1280, 1024, 768, 512, 320)
CATEGORIES = ("Fresh Juice", "Milkshakes", "Cold Drinks", "Soft Drinks")
SOURCES = {
    "Avocado Juice": "exec-85f22cb5-a8e2-4110-a026-4cfbc0346f2d.png",
    "Mango Juice": "exec-a6b4fdbc-1810-41d3-a73d-f8fd5e32354e.png",
    "Orange Juice": "exec-e3ad7e06-1c5b-4a9c-8d74-8127a8c9ef2d.png",
    "Pineapple Juice": "exec-d7f04b53-c935-450e-bd3e-e71da9361e73.png",
    "Mixed Juice": "exec-62a1b367-137e-4277-8c25-5d971376a49e.png",
    "Juice": "exec-b4df48fd-2dba-4275-9865-0156892c9b99.png",
    "Banana Milkshake": "exec-a28da701-0ccb-4088-9936-7b433a7fcf34.png",
    "Chocolate Milkshake": "exec-17370757-3ed7-4a2c-ad08-7e77771b58db.png",
    "Mango Milkshake": "exec-68ab6ec3-4e7b-457d-b7fd-93a10ed63012.png",
    "Strawberry Milkshake": "exec-4f40e637-1927-4149-9db7-bc505332a26c.png",
    "Vanilla Milkshake": "exec-ba8756aa-3d10-432d-97da-a3b5af0ffbca.png",
    "Energy Drink": "exec-35d22566-687f-42f2-98a7-4938c40c5789.png",
    "Water": "exec-27d026ba-70fa-4378-9480-dc9af696d372.png",
    "Soda Water": "exec-9a8b5882-72f5-40e5-8cab-56e3480725b9.png",
}
IDENTITIES = {
    "Avocado Juice": ("Cafe", "cafe/fresh-juice/avocado-juice"),
    "Mango Juice": ("Cafe", "cafe/fresh-juice/mango-juice"),
    "Orange Juice": ("Cafe", "cafe/fresh-juice/orange-juice"),
    "Pineapple Juice": ("Cafe", "cafe/fresh-juice/pineapple-juice"),
    "Mixed Juice": ("Cafe", "cafe/fresh-juice/mixed-juice"),
    "Banana Milkshake": ("Cafe", "cafe/smoothies-milkshakes/banana-milkshake"),
    "Chocolate Milkshake": ("Cafe", "cafe/smoothies-milkshakes/chocolate-milkshake"),
    "Mango Milkshake": ("Cafe", "cafe/smoothies-milkshakes/mango-milkshake"),
    "Strawberry Milkshake": ("Cafe", "cafe/smoothies-milkshakes/strawberry-milkshake"),
    "Vanilla Milkshake": ("Cafe", "cafe/smoothies-milkshakes/vanilla-milkshake"),
    "Energy Drink": ("Bar & Lounge", "bar-lounge/soft-drinks/energy-drink"),
    "Juice": ("Bakery", "bakery/fresh-juice/juice"),
    "Water": ("Hotel", "hotel/soft-drinks/water"),
    "Soda Water": ("Bar & Lounge", "bar-lounge/soft-drinks/soda-water"),
}


def read_env() -> dict[str, str]:
    values: dict[str, str] = {}
    for line in (ROOT / ".env.local").read_text(encoding="utf-8").splitlines():
        if "=" not in line or line.lstrip().startswith("#"):
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


specifications = json.loads(SPEC_PATH.read_text(encoding="utf-8"))["specifications"]
approved = [entry for entry in specifications if entry["active"] and entry["category"] in CATEGORIES]
spec_by_name = {entry["item_name"]: entry for entry in approved}
if set(SOURCES) != set(spec_by_name) or set(IDENTITIES) != set(spec_by_name):
    raise RuntimeError("Phase sources and identities must exactly match the frozen category specifications.")

supabase_url = read_env().get("VITE_SUPABASE_URL", "").rstrip("/")
if not supabase_url:
    raise RuntimeError("VITE_SUPABASE_URL is required to create public URLs.")

created_at = datetime.now(timezone.utc).isoformat()
records = []
for item_name, source_name in SOURCES.items():
    specification = spec_by_name[item_name]
    restaurant_type, base_storage_path = IDENTITIES[item_name]
    if restaurant_type not in specification["business_types_using_this_item"]:
        raise RuntimeError(f"Unexpected restaurant identity for {item_name}.")
    base_path = Path(base_storage_path)
    slug = specification["slug"]
    source = SOURCE_ROOT / source_name
    if not source.exists():
        raise RuntimeError(f"Missing accepted generated source for {item_name}: {source}")

    variants = []
    with Image.open(source) as opened:
        image = opened.convert("RGB")
        if image.width != image.height:
            raise RuntimeError(f"Accepted source is not square for {item_name}: {image.size}")
        for width in WIDTHS:
            relative_path = base_path / "v001" / f"{slug}-v001-{width}w.webp"
            destination = ROOT / "public/smart-menu-images" / relative_path
            if destination.exists():
                with Image.open(destination) as existing:
                    if existing.format != "WEBP" or existing.size != (width, width):
                        raise RuntimeError(f"Existing immutable variant is invalid: {relative_path.as_posix()}")
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                image.resize((width, width), Image.Resampling.LANCZOS).save(destination, "WEBP", quality=95, method=6, exact=True)
            payload = destination.read_bytes()
            storage_path = relative_path.as_posix()
            variants.append({
                "width": width, "height": width, "storage_path": storage_path,
                "public_url": f"{supabase_url}/storage/v1/object/public/smart-menu-images/{storage_path}",
                "mime_type": "image/webp", "byte_size": len(payload),
                "checksum_sha256": hashlib.sha256(payload).hexdigest(),
            })

    records.append({
        "dish_id": specification["id"], "dish_name": item_name, "slug": slug,
        "category": specification["category"], "restaurant_type": restaurant_type,
        "provider": "openai-built-in-imagegen", "provider_key": "openai-built-in-imagegen",
        "version": 1, "version_label": "v001", "base_storage_path": base_path.as_posix(),
        "storage_path": variants[0]["storage_path"], "public_url": variants[0]["public_url"],
        "checksum_sha256": variants[0]["checksum_sha256"], "mime_type": "image/webp",
        "width": 2048, "height": 2048, "lifecycle": "PENDING_REVIEW",
        "lifecycle_history": ["GENERATING", "PENDING_REVIEW"], "created_at": created_at,
        "style_guide_id": "serveflow-food-photography-v1", "style_guide_version": "1.0",
        "responsive_variants": variants,
    })

checksums = [variant["checksum_sha256"] for record in records for variant in record["responsive_variants"]]
paths = [variant["storage_path"] for record in records for variant in record["responsive_variants"]]
if len(checksums) != len(set(checksums)) or len(paths) != len(set(paths)):
    raise RuntimeError("Duplicate responsive image checksum or storage path detected.")

MANIFEST_PATH.write_text(json.dumps({
    "library": "ServeFlow Phase 9.13.10 Cold Drinks Master Images", "version": "1.0",
    "phase": "9.13.10", "categories": list(CATEGORIES), "generated_at": created_at,
    "lifecycle": "PENDING_REVIEW", "images": records,
}, indent=2) + "\n", encoding="utf-8")
print(f"Prepared {len(records)} masters and {len(checksums)} unique WebP variants in PENDING_REVIEW.")
