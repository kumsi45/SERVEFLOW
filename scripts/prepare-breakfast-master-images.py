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
    "Chechebsa": "exec-e15f65ba-622c-4f52-9480-1e167c4a4688.png",
    "Firfir": "exec-e1daabdc-8afa-4beb-a6a7-34ee9669b2ae.png",
    "Ful": "exec-0fe46570-0579-42b9-99ee-5593e7e2ef45.png",
    "Fetira": "exec-4653c131-5181-4238-a70a-11f20aa9d608.png",
    "Omelette": "exec-870fa3e9-db04-4f73-8256-9dbbfe2d69f3.png",
    "Scrambled Eggs": "exec-5a07c08f-dd3c-4b3e-95cf-b24d78b164bd.png",
    "Kinche": "exec-43159be8-24ab-44a4-a164-84a44cd64357.png",
    "Dulet": "exec-e94e6261-7e16-4810-a89f-7c272e7dc2b0.png",
}

records = []
for item_name, source_name in SOURCES.items():
    specification = SPEC_BY_NAME[item_name]
    slug = specification["slug"]
    relative_path = Path("restaurant") / "breakfast" / slug / "v001" / f"{slug}-v001-2048w.webp"
    destination = ROOT / "public" / "smart-menu-images" / relative_path
    destination.parent.mkdir(parents=True, exist_ok=True)
    source = SOURCE_ROOT / source_name
    with Image.open(source) as image:
        image = image.convert("RGB").resize((2048, 2048), Image.Resampling.LANCZOS)
        image.save(destination, "WEBP", quality=95, method=6, exact=True)
    payload = destination.read_bytes()
    records.append({
        "item_name": item_name,
        "slug": slug,
        "specification_id": specification["id"],
        "style_guide_id": "serveflow-food-photography-v1",
        "style_guide_version": "1.0",
        "storage_path": relative_path.as_posix(),
        "filename": destination.name,
        "mime_type": "image/webp",
        "width": 2048,
        "height": 2048,
        "byte_size": len(payload),
        "checksum_sha256": hashlib.sha256(payload).hexdigest(),
        "version": 1,
        "status": "PENDING_REVIEW",
        "lifecycle": ["GENERATING", "PENDING_REVIEW"],
        "provider_key": "openai-built-in-imagegen",
        "active": True,
    })

manifest = {
    "library": "ServeFlow Master Breakfast Image Library",
    "version": "1.0",
    "category": "Breakfast",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "approval_status": "PENDING_REVIEW",
    "images": records,
}
manifest_path = ROOT / "src/modules/setup-wizard/data/masterBreakfastImageLibrary.v1.json"
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(f"Prepared {len(records)} unique 2048x2048 WebP masters in PENDING_REVIEW.")
