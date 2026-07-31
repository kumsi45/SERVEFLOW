from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(r"C:\Users\user\.codex\generated_images\019fb56f-099b-7b50-806f-ab9559d6776d")
SPEC_PATH = ROOT / "src/modules/setup-wizard/data/masterDishSpecifications.v1.json"
MANIFEST_PATH = ROOT / "src/modules/setup-wizard/data/masterAlcoholImageLibrary.v1.json"
WIDTHS = (2048, 1280, 1024, 768, 512, 320)
CATEGORIES = ("Beer", "Wine", "Whisky", "Cocktails", "Mocktails")
SOURCES = {
    "Bottled Beer": "exec-ed013617-acd7-42bd-8946-eefe34b32c80.png",
    "Draft Beer": "exec-3bfbb5eb-46b8-4de5-b030-96b9ffa2f15b.png",
    "Local Beer": "exec-b354dfe6-c65f-4ace-bf0c-3a68860404cc.png",
    "Red Wine": "exec-d5c7ef37-f175-4a39-8bd6-8223513a2e21.png",
    "White Wine": "exec-b6f994e2-5ae4-40bd-9139-1c4452a52e5d.png",
    "Sparkling Wine": "exec-f6cc1c36-f131-45a9-96d6-8878cafd0661.png",
    "Jack Daniel's": "exec-0c01d8d2-f9eb-4938-954a-aaa7200bd14a.png",
    "Jameson": "exec-c089aa93-350e-4465-bc97-07c95202eb44.png",
    "Johnnie Walker": "exec-a9dd3dbf-89e0-4c7d-b6c8-1f74dc77fc09.png",
    "Cosmopolitan": "exec-2e89b30f-65b1-423e-8dca-11e52ab2c1af.png",
    "Long Island Iced Tea": "exec-1c0adfb7-28f8-4595-ad13-412f8db0e40f.png",
    "Margarita": "exec-15849ab1-7dca-478e-bd75-e497a6a2478b.png",
    "Martini": "exec-8062d634-7c8a-4f8a-9f69-2addba103a2e.png",
    "Mojito": "exec-8de5c1cd-95cf-4a82-8a43-83376a90a5dd.png",
    "Fruit Punch": "exec-497055ed-287e-4cb9-8bb5-5e9fd22a68cb.png",
    "Lemon Mint": "exec-53122950-a11d-4e8b-a84f-de2bd8e9c427.png",
    "Virgin Mojito": "exec-bedc030c-1d12-4015-80b4-4331bb92d828.png",
}
MOCKTAILS = {"Fruit Punch", "Lemon Mint", "Virgin Mojito"}


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
    raise RuntimeError("Phase sources must exactly match the frozen category specifications.")

supabase_url = read_env().get("VITE_SUPABASE_URL", "").rstrip("/")
if not supabase_url:
    raise RuntimeError("VITE_SUPABASE_URL is required to create public URLs.")

created_at = datetime.now(timezone.utc).isoformat()
records = []
for item_name, source_name in SOURCES.items():
    specification = spec_by_name[item_name]
    if specification["business_types_using_this_item"] != ["Bar & Lounge"]:
        raise RuntimeError(f"Unexpected business type for {item_name}.")
    slug = specification["slug"]
    category_path = "fresh-juice" if item_name in MOCKTAILS else "alcoholic-drinks"
    base_path = Path("bar-lounge") / category_path / slug
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
            variants.append({"width": width, "height": width, "storage_path": storage_path,
                "public_url": f"{supabase_url}/storage/v1/object/public/smart-menu-images/{storage_path}",
                "mime_type": "image/webp", "byte_size": len(payload), "checksum_sha256": hashlib.sha256(payload).hexdigest()})

    records.append({"dish_id": specification["id"], "dish_name": item_name, "slug": slug,
        "category": specification["category"], "restaurant_type": "Bar & Lounge",
        "provider": "openai-built-in-imagegen", "provider_key": "openai-built-in-imagegen",
        "version": 1, "version_label": "v001", "base_storage_path": base_path.as_posix(),
        "storage_path": variants[0]["storage_path"], "public_url": variants[0]["public_url"],
        "checksum_sha256": variants[0]["checksum_sha256"], "mime_type": "image/webp",
        "width": 2048, "height": 2048, "lifecycle": "PENDING_REVIEW",
        "lifecycle_history": ["GENERATING", "PENDING_REVIEW"], "created_at": created_at,
        "style_guide_id": "serveflow-food-photography-v1", "style_guide_version": "1.0",
        "responsive_variants": variants})

checksums = [v["checksum_sha256"] for r in records for v in r["responsive_variants"]]
paths = [v["storage_path"] for r in records for v in r["responsive_variants"]]
if len(checksums) != len(set(checksums)) or len(paths) != len(set(paths)):
    raise RuntimeError("Duplicate responsive image checksum or storage path detected.")

MANIFEST_PATH.write_text(json.dumps({"library": "ServeFlow Phase 9.13.11 Alcohol Master Images",
    "version": "1.0", "phase": "9.13.11", "categories": list(CATEGORIES), "generated_at": created_at,
    "lifecycle": "PENDING_REVIEW", "images": records}, indent=2) + "\n", encoding="utf-8")
print(f"Prepared {len(records)} masters and {len(checksums)} unique WebP variants in PENDING_REVIEW.")
