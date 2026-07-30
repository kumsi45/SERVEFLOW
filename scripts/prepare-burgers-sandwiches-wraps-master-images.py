from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(r"C:\Users\user\.codex\generated_images\019fb195-9862-7903-a49f-fa2381dd9d81")
SPEC_PATH = ROOT / "src/modules/setup-wizard/data/masterDishSpecifications.v1.json"
MANIFEST_PATH = ROOT / "src/modules/setup-wizard/data/masterBurgersSandwichesWrapsImageLibrary.v1.json"
WIDTHS = (2048, 1280, 1024, 768, 512, 320)
SOURCES = {
    "Beef Burger": "exec-0197e972-4bc4-415f-8572-bcd95cff0252.png",
    "Chicken Burger": "exec-ac2086da-4252-42a2-b221-edbed8173c04.png",
    "Cheese Burger": "exec-018a58c6-af85-419f-b434-3250c3802ec4.png",
    "Double Burger": "exec-ac6c5e5b-2572-45a9-bf21-6535785ccc76.png",
    "Club Sandwich": "exec-4946a682-735d-4a5d-a746-f0cf1f74559f.png",
    "Chicken Sandwich": "exec-f7e67493-b8ed-4e3f-b420-49d65c5fca03.png",
    "Tuna Sandwich": "exec-bcdfb5d7-6f79-470a-9dcc-d58e0a3a2c77.png",
    "Beef Sandwich": "exec-95360f61-91a4-4f02-a7fe-0dd19753f3fe.png",
    "Vegetable Sandwich": "exec-0f12c6cd-d574-454d-929f-357f8a1cd5bd.png",
    "Chicken Wrap": "exec-f61b41c6-e2ea-41cc-a236-d8bde58845c2.png",
    "Beef Wrap": "exec-980a7968-d94a-494b-929a-1511619f956e.png",
    "Vegetable Wrap": "exec-f827bf5e-68dd-4a89-8938-e7c68d71d2a1.png",
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
approved = [entry for entry in specifications if entry["active"] and entry["category"] in ("Burgers", "Sandwiches", "Wraps")]
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
    restaurant_type = "Fast Food" if specification["category"] == "Wraps" else "Restaurant"
    root_slug = "fast-food" if restaurant_type == "Fast Food" else "restaurant"
    category_slug = specification["category"].lower()
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
        "version": 1, "base_storage_path": base_path.as_posix(),
        "storage_path": variants[0]["storage_path"], "public_url": variants[0]["public_url"],
        "checksum_sha256": variants[0]["checksum_sha256"], "mime_type": "image/webp",
        "width": 2048, "height": 2048, "lifecycle": "PENDING_REVIEW",
        "lifecycle_history": ["GENERATING", "PENDING_REVIEW"], "created_at": created_at,
        "provider_key": "openai-built-in-imagegen", "style_guide_id": "serveflow-food-photography-v1",
        "style_guide_version": "1.0", "responsive_variants": variants,
    })

checksums = [variant["checksum_sha256"] for record in records for variant in record["responsive_variants"]]
if len(checksums) != len(set(checksums)):
    raise RuntimeError("Duplicate responsive image checksum detected.")
MANIFEST_PATH.write_text(json.dumps({
    "library": "ServeFlow Phase 9.13.7 Burgers Sandwiches Wraps Master Images",
    "version": "1.0", "phase": "9.13.7", "categories": ["Burgers", "Sandwiches", "Wraps"],
    "generated_at": created_at, "lifecycle": "PENDING_REVIEW", "images": records,
}, indent=2) + "\n", encoding="utf-8")
print(f"Prepared {len(records)} masters and {len(checksums)} unique WebP variants in PENDING_REVIEW.")
