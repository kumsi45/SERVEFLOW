from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(r"C:\Users\user\.codex\generated_images\019fb195-9862-7903-a49f-fa2381dd9d81")
SPEC_PATH = ROOT / "src/modules/setup-wizard/data/masterDishSpecifications.v1.json"
MANIFEST_PATH = ROOT / "src/modules/setup-wizard/data/masterChickenFishImageLibrary.v1.json"
WIDTHS = (2048, 1280, 1024, 768, 512, 320)

SOURCES = {
    "Grilled Chicken": "exec-b21fb0d1-ce6f-4ef1-bd3d-facdfd15effc.png",
    "Chicken Breast": "exec-0b564b7a-03cd-48e8-a5d5-ae2eb9ec1370.png",
    "Chicken Cutlet": "exec-85ee4d33-094d-4385-8c03-38df7184b844.png",
    "Fried Chicken": "exec-272e7c17-0e2a-4caa-9813-dd0a298e3e26.png",
    "Chicken Wings": "exec-0a7396bd-591e-4efb-bc38-4fec24ba3544.png",
    "Asa Tibs": "exec-43001fc8-b105-4303-b1fb-f86005ffc4f6.png",
    "Grilled Fish": "exec-b03b75bc-5b1d-4a4a-9947-5b0dd6936992.png",
    "Fried Fish": "exec-68a03924-52c0-4a9c-b520-b34dbb62f858.png",
    "Fish Cutlet": "exec-0b09fed3-fa5a-48d9-8045-d2bb30d9ed8e.png",
}

CATEGORY_SLUGS = {"Chicken": "chicken", "Fish & Seafood": "fish-seafood"}


def read_env() -> dict[str, str]:
    values: dict[str, str] = {}
    for line in (ROOT / ".env.local").read_text(encoding="utf-8").splitlines():
        if "=" not in line or line.lstrip().startswith("#"):
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


specifications = json.loads(SPEC_PATH.read_text(encoding="utf-8"))["specifications"]
spec_by_name = {entry["item_name"]: entry for entry in specifications}
env = read_env()
supabase_url = env.get("VITE_SUPABASE_URL", "").rstrip("/")
if not supabase_url:
    raise RuntimeError("VITE_SUPABASE_URL is required to create public URLs.")

records = []
created_at = datetime.now(timezone.utc).isoformat()
for item_name, source_name in SOURCES.items():
    specification = spec_by_name[item_name]
    category = specification["category"]
    if category not in CATEGORY_SLUGS:
        raise RuntimeError(f"Out-of-phase category for {item_name}: {category}")
    source = SOURCE_ROOT / source_name
    if not source.exists():
        raise RuntimeError(f"Missing accepted generated source for {item_name}: {source}")

    slug = specification["slug"]
    base_path = Path("restaurant") / CATEGORY_SLUGS[category] / slug
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
                resized = image.resize((width, width), Image.Resampling.LANCZOS)
                resized.save(destination, "WEBP", quality=95, method=6, exact=True)
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
        "category": category,
        "restaurant_type": "Restaurant",
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

all_checksums = [variant["checksum_sha256"] for record in records for variant in record["responsive_variants"]]
if len(all_checksums) != len(set(all_checksums)):
    raise RuntimeError("Duplicate responsive image checksum detected.")

manifest = {
    "library": "ServeFlow Phase 9.13.5 Chicken and Fish Seafood Master Images",
    "version": "1.0",
    "phase": "9.13.5",
    "categories": ["Chicken", "Fish & Seafood"],
    "generated_at": created_at,
    "lifecycle": "PENDING_REVIEW",
    "images": records,
}
MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(f"Prepared {len(records)} masters and {len(all_checksums)} unique WebP variants in PENDING_REVIEW.")
