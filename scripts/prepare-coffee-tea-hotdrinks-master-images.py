from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(r"C:\Users\user\.codex\generated_images\019fb56f-099b-7b50-806f-ab9559d6776d")
SPEC_PATH = ROOT / "src/modules/setup-wizard/data/masterDishSpecifications.v1.json"
MANIFEST_PATH = ROOT / "src/modules/setup-wizard/data/masterCoffeeTeaHotDrinksImageLibrary.v1.json"
WIDTHS = (2048, 1280, 1024, 768, 512, 320)
CATEGORIES = ("Coffee", "Tea", "Hot Drinks")
SOURCES = {
    "Americano": "exec-f4077986-425f-4244-97bd-6334f7af957c.png",
    "Latte": "exec-9532c9da-354d-4e13-b1db-0e26c41a1ca9.png",
    "Macchiato": "exec-ed749d58-8b6d-48e8-a6e8-c31a92f0de4b.png",
    "Mocha": "exec-69019ed0-6a64-4c04-9875-c7a74d3e77a1.png",
    "Black Tea": "exec-d481ccd1-00f0-47b1-9260-532f9a8ce992.png",
    "Green Tea": "exec-2725a52c-c56d-4827-8e19-20564cd06173.png",
    "Milk Tea": "exec-d33cc3b9-883e-4135-b8ff-4881f49fef82.png",
    "Cappuccino": "exec-36eec94e-447b-48b4-9c67-cd49b614d33b.png",
    "Espresso": "exec-01d5631d-09db-4194-93e3-c4be30548ccc.png",
}
BASE_PATH_CATEGORIES = {
    "Americano": "coffee",
    "Latte": "coffee",
    "Macchiato": "coffee",
    "Mocha": "coffee",
    "Black Tea": "tea-hot-drinks",
    "Green Tea": "tea-hot-drinks",
    "Milk Tea": "tea-hot-drinks",
    "Cappuccino": "coffee",
    "Espresso": "coffee",
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
if set(SOURCES) != set(spec_by_name):
    raise RuntimeError("Phase sources do not exactly match the frozen category specification set.")

supabase_url = read_env().get("VITE_SUPABASE_URL", "").rstrip("/")
if not supabase_url:
    raise RuntimeError("VITE_SUPABASE_URL is required to create public URLs.")

created_at = datetime.now(timezone.utc).isoformat()
records = []
for item_name, source_name in SOURCES.items():
    specification = spec_by_name[item_name]
    if "Cafe" not in specification["business_types_using_this_item"]:
        raise RuntimeError(f"Unexpected business type for {item_name}.")
    restaurant_type = "Cafe"
    category_slug = BASE_PATH_CATEGORIES[item_name]
    slug = specification["slug"]
    base_path = Path("cafe") / category_slug / slug
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
                image.resize((width, width), Image.Resampling.LANCZOS).save(
                    destination, "WEBP", quality=95, method=6, exact=True
                )
            payload = destination.read_bytes()
            storage_path = relative_path.as_posix()
            variants.append({
                "width": width,
                "height": width,
                "storage_path": storage_path,
                "public_url": f"{supabase_url}/storage/v1/object/public/smart-menu-images/{storage_path}",
                "mime_type": "image/webp",
                "byte_size": len(payload),
                "checksum_sha256": hashlib.sha256(payload).hexdigest(),
            })

    records.append({
        "dish_id": specification["id"],
        "dish_name": item_name,
        "slug": slug,
        "category": specification["category"],
        "restaurant_type": restaurant_type,
        "provider": "openai-built-in-imagegen",
        "provider_key": "openai-built-in-imagegen",
        "version": 1,
        "version_label": "v001",
        "base_storage_path": base_path.as_posix(),
        "storage_path": variants[0]["storage_path"],
        "public_url": variants[0]["public_url"],
        "checksum_sha256": variants[0]["checksum_sha256"],
        "mime_type": "image/webp",
        "width": 2048,
        "height": 2048,
        "lifecycle": "PENDING_REVIEW",
        "lifecycle_history": ["GENERATING", "PENDING_REVIEW"],
        "created_at": created_at,
        "style_guide_id": "serveflow-food-photography-v1",
        "style_guide_version": "1.0",
        "responsive_variants": variants,
    })

checksums = [variant["checksum_sha256"] for record in records for variant in record["responsive_variants"]]
paths = [variant["storage_path"] for record in records for variant in record["responsive_variants"]]
if len(checksums) != len(set(checksums)):
    raise RuntimeError("Duplicate responsive image checksum detected.")
if len(paths) != len(set(paths)):
    raise RuntimeError("Duplicate responsive storage path detected.")

MANIFEST_PATH.write_text(json.dumps({
    "library": "ServeFlow Phase 9.13.9 Coffee Tea Hot Drinks Master Images",
    "version": "1.0",
    "phase": "9.13.9",
    "categories": list(CATEGORIES),
    "generated_at": created_at,
    "lifecycle": "PENDING_REVIEW",
    "images": records,
}, indent=2) + "\n", encoding="utf-8")
print(f"Prepared {len(records)} masters and {len(checksums)} unique WebP variants in PENDING_REVIEW.")
