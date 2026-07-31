from __future__ import annotations

import hashlib, json
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = Path(r"C:\Users\user\.codex\generated_images\019fb56f-099b-7b50-806f-ab9559d6776d")
SPEC_PATH = ROOT / "src/modules/setup-wizard/data/masterDishSpecifications.v1.json"
MANIFEST_PATH = ROOT / "src/modules/setup-wizard/data/masterSnacksImageLibrary.v1.json"
WIDTHS = (2048, 1280, 1024, 768, 512, 320)
CATEGORIES = ("Donuts", "Cupcakes", "Pies", "Fries", "Snacks", "Bar Snacks")
SOURCES = {
    "Apple Pie":"exec-7a2379ad-3f6d-4dc0-af6e-fe5273aa8944.png", "Chicken Pie":"exec-94bb3c53-0cfc-4c59-8f3d-933bbc7b286b.png", "Meat Pie":"exec-51a8e55f-fd32-40b2-b919-d26f85786b63.png",
    "Chocolate Cupcake":"exec-d4b52c30-e86c-4ec6-8211-721895ad734e.png", "Strawberry Cupcake":"exec-6aa2ca6b-cdbe-4438-8e9b-5026e08b7188.png", "Vanilla Cupcake":"exec-fa2fc33a-6091-44c9-b59e-25cc53d4c154.png",
    "Chocolate Donut":"exec-28391019-ccb5-4b25-910d-3308d82bbede.png", "Filled Donut":"exec-f4557820-7391-4e6e-b243-0b37d96f6f01.png", "Glazed Donut":"exec-e8e4a21b-9ebd-4b5d-aa2d-1e632dfa6fe1.png",
    "Loaded Fries":"exec-802f8f9e-611a-45a8-918a-2b6b80790ad2.png", "Potato Wedges":"exec-0325f032-c445-4624-be60-99a2cd300171.png", "Pizza Slice":"exec-69a510f4-7c30-4181-8d2e-dbb057f325c4.png",
    "Nachos":"exec-323af161-0c09-4fa1-90fb-8b56c8001ca4.png", "Peanuts":"exec-df2721b7-41d3-4e7b-b1f0-33d741e7584e.png", "Popcorn":"exec-8cec3874-3053-494f-aae9-165c8ff0c33f.png",
}
IDENTITIES = {
    "Apple Pie":("Bakery","bakery/desserts/apple-pie"), "Chicken Pie":("Bakery","bakery/desserts/chicken-pie"), "Meat Pie":("Bakery","bakery/desserts/meat-pie"),
    "Chocolate Cupcake":("Bakery","bakery/desserts/chocolate-cupcake"), "Strawberry Cupcake":("Bakery","bakery/desserts/strawberry-cupcake"), "Vanilla Cupcake":("Bakery","bakery/desserts/vanilla-cupcake"),
    "Chocolate Donut":("Bakery","bakery/desserts/chocolate-donut"), "Filled Donut":("Bakery","bakery/desserts/filled-donut"), "Glazed Donut":("Bakery","bakery/desserts/glazed-donut"),
    "Loaded Fries":("Fast Food","fast-food/snacks-fast-food/loaded-fries"), "Potato Wedges":("Fast Food","fast-food/snacks-fast-food/potato-wedges"), "Pizza Slice":("Cafe","cafe/snacks-fast-food/pizza-slice"),
    "Nachos":("Bar & Lounge","bar-lounge/snacks-fast-food/nachos"), "Peanuts":("Bar & Lounge","bar-lounge/snacks-fast-food/peanuts"), "Popcorn":("Bar & Lounge","bar-lounge/snacks-fast-food/popcorn"),
}

def read_env():
    values={}
    for line in (ROOT/".env.local").read_text(encoding="utf-8").splitlines():
        if "=" not in line or line.lstrip().startswith("#"): continue
        key,value=line.split("=",1); values[key.strip()]=value.strip().strip("'\"")
    return values

specs=json.loads(SPEC_PATH.read_text(encoding="utf-8"))["specifications"]
approved=[e for e in specs if e["active"] and e["category"] in CATEGORIES]; by_name={e["item_name"]:e for e in approved}
if set(SOURCES)!=set(by_name) or set(IDENTITIES)!=set(by_name): raise RuntimeError("Phase sources and identities must exactly match frozen specifications.")
base_url=read_env().get("VITE_SUPABASE_URL","").rstrip("/")
if not base_url: raise RuntimeError("VITE_SUPABASE_URL is required.")
created_at=datetime.now(timezone.utc).isoformat(); records=[]
for name,source_name in SOURCES.items():
    spec=by_name[name]; restaurant_type,base_storage_path=IDENTITIES[name]
    if restaurant_type not in spec["business_types_using_this_item"]: raise RuntimeError(f"Unexpected identity for {name}.")
    source=SOURCE_ROOT/source_name; slug=spec["slug"]
    if not source.exists(): raise RuntimeError(f"Missing accepted source for {name}: {source}")
    variants=[]
    with Image.open(source) as opened:
        image=opened.convert("RGB")
        if image.width!=image.height: raise RuntimeError(f"Source must be square for {name}: {image.size}")
        for width in WIDTHS:
            storage_path=f"{base_storage_path}/v001/{slug}-v001-{width}w.webp"; destination=ROOT/"public/smart-menu-images"/storage_path
            if destination.exists():
                with Image.open(destination) as existing:
                    if existing.format!="WEBP" or existing.size!=(width,width): raise RuntimeError(f"Existing immutable variant is invalid: {storage_path}")
            else:
                destination.parent.mkdir(parents=True,exist_ok=True); image.resize((width,width),Image.Resampling.LANCZOS).save(destination,"WEBP",quality=95,method=6,exact=True)
            payload=destination.read_bytes(); variants.append({"width":width,"height":width,"storage_path":storage_path,"public_url":f"{base_url}/storage/v1/object/public/smart-menu-images/{storage_path}","mime_type":"image/webp","byte_size":len(payload),"checksum_sha256":hashlib.sha256(payload).hexdigest()})
    records.append({"dish_id":spec["id"],"dish_name":name,"slug":slug,"category":spec["category"],"restaurant_type":restaurant_type,"provider":"openai-built-in-imagegen","provider_key":"openai-built-in-imagegen","version":1,"version_label":"v001","base_storage_path":base_storage_path,"storage_path":variants[0]["storage_path"],"public_url":variants[0]["public_url"],"checksum_sha256":variants[0]["checksum_sha256"],"mime_type":"image/webp","width":2048,"height":2048,"lifecycle":"PENDING_REVIEW","lifecycle_history":["GENERATING","PENDING_REVIEW"],"created_at":created_at,"style_guide_id":"serveflow-food-photography-v1","style_guide_version":"1.0","responsive_variants":variants})
checksums=[v["checksum_sha256"] for r in records for v in r["responsive_variants"]]; paths=[v["storage_path"] for r in records for v in r["responsive_variants"]]
if len(checksums)!=len(set(checksums)) or len(paths)!=len(set(paths)): raise RuntimeError("Duplicate checksum or path detected.")
MANIFEST_PATH.write_text(json.dumps({"library":"ServeFlow Phase 9.13.14 Snacks Master Images","version":"1.0","phase":"9.13.14","categories":list(CATEGORIES),"generated_at":created_at,"lifecycle":"PENDING_REVIEW","images":records},indent=2)+"\n",encoding="utf-8")
print(f"Prepared {len(records)} masters and {len(checksums)} unique WebP variants in PENDING_REVIEW.")
