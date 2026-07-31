from __future__ import annotations
import hashlib,json
from datetime import datetime,timezone
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];SOURCE_ROOT=Path(r"C:\Users\user\.codex\generated_images\019fb56f-099b-7b50-806f-ab9559d6776d")
SPEC=ROOT/"src/modules/setup-wizard/data/masterDishSpecifications.v1.json";MANIFEST=ROOT/"src/modules/setup-wizard/data/masterBreakfastCompletionImageLibrary.v1.json";WIDTHS=(2048,1280,1024,768,512,320)
SOURCES={"Cereals":"exec-ec579076-ebfb-40ec-b0e4-c6cd6bb01ab7.png","Continental Breakfast":"exec-a2285936-8729-448f-95d4-7238caaa5840.png","Ethiopian Breakfast":"exec-6cb753dd-0504-4f92-a0f7-62cbf26c8a6c.png","Fresh Fruits":"exec-e055623a-664b-4c00-bac9-4aeb7122f0af.png","Pancake":"exec-19c857af-2afe-4e23-adee-bf73e35b8c36.png","Toast":"exec-fb18cac7-03ef-4d28-8047-430ca6e5c6ba.png"}
def env():
 d={}
 for line in (ROOT/".env.local").read_text(encoding="utf-8").splitlines():
  if "=" in line and not line.lstrip().startswith("#"): k,v=line.split("=",1);d[k.strip()]=v.strip().strip("'\"")
 return d
specs=json.loads(SPEC.read_text(encoding="utf-8"))["specifications"];approved={e["item_name"]:e for e in specs if e["active"] and e["category"]=="Breakfast" and e["item_name"] in SOURCES}
if set(approved)!=set(SOURCES):raise RuntimeError("The completion set must exactly match six frozen Breakfast specifications.")
url=env()["VITE_SUPABASE_URL"].rstrip("/");created=datetime.now(timezone.utc).isoformat();records=[]
for name,filename in SOURCES.items():
 s=approved[name];source=SOURCE_ROOT/filename;base=f"hotel/breakfast/{s['slug']}";variants=[]
 with Image.open(source) as opened:
  image=opened.convert("RGB")
  if image.width!=image.height:raise RuntimeError(f"Source is not square: {name}")
  for width in WIDTHS:
   path=f"{base}/v001/{s['slug']}-v001-{width}w.webp";destination=ROOT/"public/smart-menu-images"/path
   if destination.exists():raise RuntimeError(f"Refusing to overwrite immutable asset: {path}")
   destination.parent.mkdir(parents=True,exist_ok=True);image.resize((width,width),Image.Resampling.LANCZOS).save(destination,"WEBP",quality=95,method=6,exact=True);payload=destination.read_bytes()
   variants.append({"width":width,"height":width,"storage_path":path,"public_url":f"{url}/storage/v1/object/public/smart-menu-images/{path}","mime_type":"image/webp","byte_size":len(payload),"checksum_sha256":hashlib.sha256(payload).hexdigest()})
 records.append({"dish_id":s["id"],"dish_name":name,"slug":s["slug"],"category":"Breakfast","restaurant_type":"Hotel","provider":"openai-built-in-imagegen","provider_key":"openai-built-in-imagegen","version":1,"version_label":"v001","base_storage_path":base,"storage_path":variants[0]["storage_path"],"public_url":variants[0]["public_url"],"checksum_sha256":variants[0]["checksum_sha256"],"mime_type":"image/webp","width":2048,"height":2048,"lifecycle":"PENDING_REVIEW","lifecycle_history":["GENERATING","PENDING_REVIEW"],"created_at":created,"style_guide_id":"serveflow-food-photography-v1","style_guide_version":"1.0","responsive_variants":variants})
checksums=[v["checksum_sha256"] for r in records for v in r["responsive_variants"]]
if len(checksums)!=36 or len(set(checksums))!=36:raise RuntimeError("Expected 36 unique checksums.")
MANIFEST.write_text(json.dumps({"library":"ServeFlow Phase 9.13.14A Breakfast Completion","version":"1.0","phase":"9.13.14A","categories":["Breakfast"],"generated_at":created,"lifecycle":"PENDING_REVIEW","images":records},indent=2)+"\n",encoding="utf-8");print("Prepared 6 Breakfast masters and 36 unique responsive WebP variants.")
