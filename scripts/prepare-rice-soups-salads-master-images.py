from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(r"C:\Users\user\.codex\generated_images\019fb54b-0fc8-7d71-a74c-7774ef952492")
SPEC_PATH = ROOT / "src/modules/setup-wizard/data/masterDishSpecifications.v1.json"
MANIFEST_PATH = ROOT / "src/modules/setup-wizard/data/masterRiceSoupsSaladsImageLibrary.v1.json"
WIDTHS = (2048, 1280, 1024, 768, 512, 320)
CATEGORIES = ("Rice Dishes", "Soups", "Salads")
SOURCES = {
    "Beef Rice": "exec-b45eadab-e219-4a02-be5c-b9ba821c1b90.png",
    "Chicken Rice": "exec-1454195c-c75d-41b4-9507-679a35ca869d.png",
    "Fried Rice": "exec-215ddfe4-bc3d-48a6-b11c-7e2a3048b25a.png",
    "Vegetable Rice": "exec-9a234118-47f7-4131-8c1b-9b1d5c509b76.png",
    "Chicken Soup": "exec-4493f018-5770-4c00-9b0d-6ab8bddcb162.png",
    "Fish Soup": "exec-8b66f75d-a57f-43e4-ab1a-7c012f1715c1.png",
    "Mushroom Soup": "exec-d5d583c7-9349-4eba-9252-c5229279bd9e.png",
    "Tomato Soup": "exec-32b75eeb-6054-4c73-a240-4f7568a18b23.png",
    "Vegetable Soup": "exec-eb635e80-6e30-47d1-8c2b-ec64bf2614c8.png",
    "Caesar Salad": "exec-38001f8d-c299-4af4-94e6-49f5f9f8730c.png",
    "Chicken Salad": "exec-d5dc1565-ef70-4d7c-b58c-0fafffce1860.png",
    "Garden Salad": "exec-21f5d064-e384-492f-b891-3696e7bd03b8.png",
    "Greek Salad": "exec-a2f9e480-b3f0-4c3a-86f2-bafb7275f4f7.png",
    "Green Salad": "exec-599cf971-83e3-4b3c-b231-4e7d6b4fb80d.png",
    "Mixed Salad": "exec-36dcf154-fad6-416e-88c8-166f65577cd1.png",
    "Tuna Salad": "exec-232f7337-7f72-46a1-a8b5-be9bcb9cf2f9.png",
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
    restaurant_type = "Restaurant" if "Restaurant" in specification["business_types_using_this_item"] else "Hotel"
    root_slug = restaurant_type.lower()
    category_slug = specification["category"].lower().replace(" ", "-")
    slug = specification["slug"]
    base_path = Path(root_slug) / category_slug / slug
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
if len(checksums) != len(set(checksums)):
    raise RuntimeError("Duplicate responsive image checksum detected.")

MANIFEST_PATH.write_text(json.dumps({
    "library": "ServeFlow Phase 9.13.8 Rice Soups Salads Master Images",
    "version": "1.0",
    "phase": "9.13.8",
    "categories": list(CATEGORIES),
    "generated_at": created_at,
    "lifecycle": "PENDING_REVIEW",
    "images": records,
}, indent=2) + "\n", encoding="utf-8")
print(f"Prepared {len(records)} masters and {len(checksums)} unique WebP variants in PENDING_REVIEW.")
