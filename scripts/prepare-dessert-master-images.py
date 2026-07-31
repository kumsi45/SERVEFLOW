from __future__ import annotations

import hashlib, json
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(r"C:\Users\user\.codex\generated_images\019fb56f-099b-7b50-806f-ab9559d6776d")
SPEC_PATH = ROOT / "src/modules/setup-wizard/data/masterDishSpecifications.v1.json"
MANIFEST_PATH = ROOT / "src/modules/setup-wizard/data/masterDessertImageLibrary.v1.json"
WIDTHS = (2048, 1280, 1024, 768, 512, 320)
CATEGORIES = ("Cakes", "Desserts", "Cookies")
SOURCES = {
    "Birthday Cake": "exec-554ae6ac-775b-4f6d-b4b6-eb121b131b92.png", "Black Forest Cake": "exec-24a94306-ee6b-4359-8d90-392753bdf7e0.png",
    "Chocolate Cake": "exec-8b36dda4-a219-4d07-a0e5-966c40435aaa.png", "Red Velvet Cake": "exec-b76b5f68-379a-43b7-b1ec-0b52fdf633af.png",
    "White Forest Cake": "exec-a29481e7-8ac3-4c8b-b419-8ad62c927fee.png", "Butter Cookie": "exec-31b05371-958c-4442-ac5e-f04f44adb100.png",
    "Cake": "exec-94c0f630-569e-4bea-8252-dd561d905d77.png", "Chocolate Chip Cookie": "exec-7c15c5b9-bb91-4853-8490-f39ff34e2346.png",
    "Oat Cookie": "exec-531e3023-31a7-4315-ab1d-b95b5c3d9b2a.png", "Fruit Salad": "exec-60d7b7c9-7267-4e21-8564-fcc00cac1d47.png",
    "Ice Cream": "exec-cbbc9e2d-eb2a-4736-bce4-0673dacc1b4c.png", "Sundae": "exec-e58d21fc-cd14-44be-8ebe-0d75ef05de9e.png",
}
IDENTITIES = {
    "Birthday Cake": ("Bakery", "bakery/desserts/birthday-cake"), "Black Forest Cake": ("Bakery", "bakery/desserts/black-forest-cake"),
    "Chocolate Cake": ("Bakery", "bakery/desserts/chocolate-cake"), "Red Velvet Cake": ("Bakery", "bakery/desserts/red-velvet-cake"),
    "White Forest Cake": ("Bakery", "bakery/desserts/white-forest-cake"), "Butter Cookie": ("Bakery", "bakery/desserts/butter-cookie"),
    "Chocolate Chip Cookie": ("Bakery", "bakery/desserts/chocolate-chip-cookie"), "Oat Cookie": ("Bakery", "bakery/desserts/oat-cookie"),
    "Cake": ("Cafe", "cafe/desserts/cake"), "Fruit Salad": ("Hotel", "hotel/desserts/fruit-salad"),
    "Ice Cream": ("Fast Food", "fast-food/desserts/ice-cream"), "Sundae": ("Fast Food", "fast-food/desserts/sundae"),
}

def read_env():
    values = {}
    for line in (ROOT / ".env.local").read_text(encoding="utf-8").splitlines():
        if "=" not in line or line.lstrip().startswith("#"): continue
        key, value = line.split("=", 1); values[key.strip()] = value.strip().strip("'\"")
    return values

specifications = json.loads(SPEC_PATH.read_text(encoding="utf-8"))["specifications"]
approved = [e for e in specifications if e["active"] and e["category"] in CATEGORIES]; spec_by_name = {e["item_name"]: e for e in approved}
if set(SOURCES) != set(spec_by_name) or set(IDENTITIES) != set(spec_by_name): raise RuntimeError("Phase sources and identities must exactly match frozen specifications.")
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
                destination.parent.mkdir(parents=True, exist_ok=True); image.resize((width, width), Image.Resampling.LANCZOS).save(destination, "WEBP", quality=95, method=6, exact=True)
            payload = destination.read_bytes(); storage_path = relative_path.as_posix()
            variants.append({"width": width, "height": width, "storage_path": storage_path, "public_url": f"{supabase_url}/storage/v1/object/public/smart-menu-images/{storage_path}", "mime_type": "image/webp", "byte_size": len(payload), "checksum_sha256": hashlib.sha256(payload).hexdigest()})
    records.append({"dish_id": specification["id"], "dish_name": item_name, "slug": slug, "category": specification["category"], "restaurant_type": restaurant_type, "provider": "openai-built-in-imagegen", "provider_key": "openai-built-in-imagegen", "version": 1, "version_label": "v001", "base_storage_path": base_path.as_posix(), "storage_path": variants[0]["storage_path"], "public_url": variants[0]["public_url"], "checksum_sha256": variants[0]["checksum_sha256"], "mime_type": "image/webp", "width": 2048, "height": 2048, "lifecycle": "PENDING_REVIEW", "lifecycle_history": ["GENERATING", "PENDING_REVIEW"], "created_at": created_at, "style_guide_id": "serveflow-food-photography-v1", "style_guide_version": "1.0", "responsive_variants": variants})
checksums = [v["checksum_sha256"] for r in records for v in r["responsive_variants"]]; paths = [v["storage_path"] for r in records for v in r["responsive_variants"]]
if len(checksums) != len(set(checksums)) or len(paths) != len(set(paths)): raise RuntimeError("Duplicate checksum or path detected.")
MANIFEST_PATH.write_text(json.dumps({"library": "ServeFlow Phase 9.13.13 Dessert Master Images", "version": "1.0", "phase": "9.13.13", "categories": list(CATEGORIES), "generated_at": created_at, "lifecycle": "PENDING_REVIEW", "images": records}, indent=2) + "\n", encoding="utf-8")
print(f"Prepared {len(records)} masters and {len(checksums)} unique WebP variants in PENDING_REVIEW.")
