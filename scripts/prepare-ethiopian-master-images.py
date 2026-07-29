from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(r"C:\Users\user\.codex\generated_images\019fa7cb-0e64-7b33-b185-fcd89cf122ea")
SPECIFICATIONS = json.loads((ROOT / "src/modules/setup-wizard/data/masterDishSpecifications.v1.json").read_text(encoding="utf-8"))["specifications"]
SPEC_BY_NAME = {entry["item_name"]: entry for entry in SPECIFICATIONS}

SOURCES = {
    "Kitfo": "exec-1b5823ce-aefd-426e-b9c2-d2840a6332fa.png",
    "Tibs": "exec-c72c3d24-c80e-491a-b097-c5c37aec45d0.png",
    "Shekla Tibs": "exec-c06e5f77-1610-4f73-953f-beae75f131fd.png",
    "Doro Wot": "exec-2dc4899c-7abc-4420-92e8-7d2f5cfc0cb8.png",
    "Key Wot": "exec-bf4affd7-906d-4f42-a5bc-aad074d3c3fd.png",
    "Gored Gored": "exec-e4f15dc8-5e5d-4e8f-980e-e524cf5e62dc.png",
    "Shiro": "exec-64090193-444c-4ad7-b20b-3a3e8f42c726.png",
    "Misir Wot": "exec-0483086e-4f00-4136-a860-e7dea1e7777b.png",
    "Beyaynetu": "exec-84ba20c5-949f-4813-911f-fd679d5b0431.png",
    "Tegabino": "exec-d243044f-cab1-48f7-bd03-9ae54984d41e.png",
}

records = []
for item_name, source_name in SOURCES.items():
    specification = SPEC_BY_NAME[item_name]
    slug = specification["slug"]
    relative_path = Path("restaurant") / "ethiopian-traditional-dishes" / slug / "v001" / f"{slug}-v001-2048w.webp"
    destination = ROOT / "public" / "smart-menu-images" / relative_path
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(SOURCE_ROOT / source_name) as image:
        image = image.convert("RGB").resize((2048, 2048), Image.Resampling.LANCZOS)
        image.save(destination, "WEBP", quality=95, method=6, exact=True)
    payload = destination.read_bytes()
    records.append({
        "item_name": item_name, "slug": slug, "specification_id": specification["id"],
        "style_guide_id": "serveflow-food-photography-v1", "style_guide_version": "1.0",
        "storage_path": relative_path.as_posix(), "filename": destination.name,
        "mime_type": "image/webp", "width": 2048, "height": 2048,
        "byte_size": len(payload), "checksum_sha256": hashlib.sha256(payload).hexdigest(),
        "version": 1, "status": "PENDING_REVIEW",
        "lifecycle": ["GENERATING", "PENDING_REVIEW"],
        "provider_key": "openai-built-in-imagegen", "active": True,
    })

manifest = {
    "library": "ServeFlow Master Ethiopian Food Image Library", "version": "1.0",
    "category": "Traditional Ethiopian Dishes", "generated_at": datetime.now(timezone.utc).isoformat(),
    "approval_status": "PENDING_REVIEW", "images": records,
}
(ROOT / "src/modules/setup-wizard/data/masterEthiopianImageLibrary.v1.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(f"Prepared {len(records)} unique 2048x2048 WebP masters in PENDING_REVIEW.")
