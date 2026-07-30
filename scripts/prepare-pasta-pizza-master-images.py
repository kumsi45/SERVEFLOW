from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(r"C:\Users\user\.codex\generated_images\019fb195-9862-7903-a49f-fa2381dd9d81")
SPEC_PATH = ROOT / "src/modules/setup-wizard/data/masterDishSpecifications.v1.json"
MANIFEST_PATH = ROOT / "src/modules/setup-wizard/data/masterPastaPizzaImageLibrary.v1.json"
WIDTHS = (2048, 1280, 1024, 768, 512, 320)

SOURCES = {
    "Spaghetti": "exec-ae797358-c8a2-45ea-858f-afd19fcf8b07.png",
    "Pasta Alfredo": "exec-72479c53-326e-4c25-b0b3-6cb723ef6dcb.png",
    "Macaroni": "exec-a9d69120-53f5-48c0-82d8-6cb75e18cd84.png",
    "Pasta with Chicken": "exec-4c60f4a0-a56e-4bec-b892-8b92cfa49668.png",
    "Pasta with Beef": "exec-692afeb2-94f5-4cca-baa5-661e3c6cbfa3.png",
    "Margherita Pizza": "exec-31947a0d-3dec-44b2-9372-8bc745f4bbc9.png",
    "Beef Pizza": "exec-595f9ea5-8d30-48d0-931a-c391db0d40a1.png",
    "Chicken Pizza": "exec-246ac666-b93b-4515-a923-2966f2b8d3fc.png",
    "Vegetable Pizza": "exec-463b6ca7-d1a8-48da-bc14-1f93e5ebc943.png",
    "Mini Pizza": "exec-ddfebc1b-0107-46a6-b43d-0f34df00703c.png",
    "Tuna Pizza": "exec-8947ecfa-413a-4154-8e21-7f12540770b9.png",
    "Pepperoni Pizza": "exec-85c27746-d763-44de-9253-312223f4c06b.png",
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
approved = [entry for entry in specifications if entry["active"] and entry["category"] in ("Pasta", "Pizza")]
spec_by_name = {entry["item_name"]: entry for entry in approved}
if set(SOURCES) != set(spec_by_name):
    raise RuntimeError("Phase sources do not exactly match the frozen Pasta and Pizza specification set.")

supabase_url = read_env().get("VITE_SUPABASE_URL", "").rstrip("/")
if not supabase_url:
    raise RuntimeError("VITE_SUPABASE_URL is required to create public URLs.")

created_at = datetime.now(timezone.utc).isoformat()
records = []
for item_name, source_name in SOURCES.items():
    specification = spec_by_name[item_name]
    restaurant_type = "Fast Food" if item_name in ("Mini Pizza", "Pepperoni Pizza") else "Restaurant"
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
        "version": 1,
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
        "provider_key": "openai-built-in-imagegen",
        "style_guide_id": "serveflow-food-photography-v1",
        "style_guide_version": "1.0",
        "responsive_variants": variants,
    })

checksums = [variant["checksum_sha256"] for record in records for variant in record["responsive_variants"]]
if len(checksums) != len(set(checksums)):
    raise RuntimeError("Duplicate responsive image checksum detected.")

MANIFEST_PATH.write_text(json.dumps({
    "library": "ServeFlow Phase 9.13.6 Pasta and Pizza Master Images",
    "version": "1.0",
    "phase": "9.13.6",
    "categories": ["Pasta", "Pizza"],
    "generated_at": created_at,
    "lifecycle": "PENDING_REVIEW",
    "images": records,
}, indent=2) + "\n", encoding="utf-8")
print(f"Prepared {len(records)} masters and {len(checksums)} unique WebP variants in PENDING_REVIEW.")
