from __future__ import annotations
import hashlib,json
from datetime import datetime,timezone
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];DATA=ROOT/"src/modules/setup-wizard/data";IMAGE_ROOT=ROOT/"public/smart-menu-images";WIDTHS=(1280,1024,768,512,320)
sources=[DATA/"masterBreakfastImageLibrary.v1.json",DATA/"masterEthiopianImageLibrary.v1.json"]
def env():
 d={}
 for line in (ROOT/".env.local").read_text(encoding="utf-8").splitlines():
  if "=" in line and not line.lstrip().startswith("#"):k,v=line.split("=",1);d[k.strip()]=v.strip().strip("'\"")
 return d
base_url=env()["VITE_SUPABASE_URL"].rstrip("/");records=[];before={}
for manifest_path in sources:
 manifest=json.loads(manifest_path.read_text(encoding="utf-8"))
 for entry in manifest["images"]:
  master=IMAGE_ROOT/entry["storage_path"];payload=master.read_bytes();digest=hashlib.sha256(payload).hexdigest()
  if digest!=entry["checksum_sha256"]:raise RuntimeError(f"Legacy master checksum mismatch: {entry['item_name']}")
  before[entry["storage_path"]]=digest;base=entry["storage_path"].split("/v001/")[0];variants=[]
  with Image.open(master) as opened:
   if opened.format!="WEBP" or opened.size!=(2048,2048):raise RuntimeError(f"Invalid legacy master: {entry['item_name']}")
   image=opened.convert("RGB")
   for width in WIDTHS:
    path=f"{base}/v001/{entry['slug']}-v001-{width}w.webp";destination=IMAGE_ROOT/path
    if destination.exists():raise RuntimeError(f"Refusing to overwrite responsive asset: {path}")
    image.resize((width,width),Image.Resampling.LANCZOS).save(destination,"WEBP",quality=95,method=6,exact=True);data=destination.read_bytes();variants.append({"width":width,"height":width,"storage_path":path,"public_url":f"{base_url}/storage/v1/object/public/smart-menu-images/{path}","mime_type":"image/webp","byte_size":len(data),"checksum_sha256":hashlib.sha256(data).hexdigest()})
  if hashlib.sha256(master.read_bytes()).hexdigest()!=before[entry["storage_path"]]:raise RuntimeError(f"Legacy master changed: {entry['item_name']}")
  records.append({"dish_name":entry["item_name"],"slug":entry["slug"],"specification_id":entry["specification_id"],"base_storage_path":base,"master_storage_path":entry["storage_path"],"master_checksum_sha256":entry["checksum_sha256"],"master_byte_size":entry["byte_size"],"version":1,"version_label":"v001","status":"PENDING_REVIEW","provider_key":entry["provider_key"],"style_guide_id":entry["style_guide_id"],"style_guide_version":entry["style_guide_version"],"responsive_variants_added":variants})
hashes=[v["checksum_sha256"] for r in records for v in r["responsive_variants_added"]]
if len(records)!=18 or len(hashes)!=90 or len(set(hashes))!=90:raise RuntimeError("Expected 18 masters and 90 unique variants.")
(DATA/"masterLegacyResponsiveUpgrade.v1.json").write_text(json.dumps({"library":"ServeFlow Phase 9.13.14B Legacy Responsive Upgrade","phase":"9.13.14B","version":"1.0","generated_at":datetime.now(timezone.utc).isoformat(),"source_width":2048,"added_widths":list(WIDTHS),"masters":records},indent=2)+"\n",encoding="utf-8");print("Prepared 90 missing responsive variants from 18 unchanged legacy masters.")
