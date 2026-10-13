import json, os
from PIL import Image
import pathlib
A=str(pathlib.Path(__file__).resolve().parents[2] / "apps/client/public/assets")
def origin(path, fw, fh):
    im=Image.open(path).convert("RGBA").crop((0,0,fw,fh)); px=im.load()
    ys=[y for y in range(fh) for x in range(fw) if px[x,y][3]]
    return round((max(ys)+1)/fh,4)
sheets=[]; images=[]
def sheet(key, rel, fw, fh, tag):
    p=f"{A}/{rel}"; w,h=Image.open(p).size
    sheets.append({"key":key,"path":f"assets/{rel}","frameWidth":fw,"frameHeight":fh,"frames":w//fw,
                   "originX":0.5,"originY":origin(p,fw,fh),"group":tag,"bytes":os.path.getsize(p)})
for f in sorted(os.listdir(f"{A}/avatar/body")):
    sheet(f[:-4], f"avatar/body/{f}", 64, 64, "avatar_body")
for f in sorted(os.listdir(f"{A}/avatar/layers")):
    sheet(f[:-4], f"avatar/layers/{f}", 64, 64, "avatar_layer")
for f, fw in [("rogue_idle",32),("wizard_idle",32),("tavern_a_idle",64),("tavern_b_idle",64),("peasant_a_idle",64),("peasant_a_walk",64)]:
    sheet(f"npc_{f}", f"vendor/pixel-crawler/npc/{f}.png", fw, fw, "npc")
for sub in ["tiles","buildings","props","props/trees"]:
    d=f"{A}/vendor/pixel-crawler/{sub}"
    for f in sorted(os.listdir(d)):
        if not f.endswith(".png"): continue
        if f == "roofs.png" and os.path.exists(f"{d}/roofs_upthere.png"): continue   # in gioco si usano i tetti Upthere
        p=f"{d}/{f}"; w,h=Image.open(p).size
        images.append({"key":f"{sub.replace('/','_')}_{f[:-4]}","path":f"assets/vendor/pixel-crawler/{sub}/{f}",
                       "width":w,"height":h,"tileSize":16 if sub in ("tiles","buildings") else None,"bytes":os.path.getsize(p)})
bp=f"{A}/brand/pixel"
if os.path.isdir(bp):
    for f in sorted(os.listdir(bp)):
        if f.endswith(".png"):
            p=f"{bp}/{f}"; w,h=Image.open(p).size
            images.append({"key":f"brand_pixel_{f[:-4]}","path":f"assets/brand/pixel/{f}","width":w,"height":h,"tileSize":None,"bytes":os.path.getsize(p)})
atlas={"key":"shoes","image":"assets/shoes/items_atlas.png","json":"assets/shoes/items_atlas.json",
       "bytes":os.path.getsize(f"{A}/shoes/items_atlas.png")+os.path.getsize(f"{A}/shoes/items_atlas.json")}
total=sum(s["bytes"] for s in sheets)+sum(i["bytes"] for i in images)+atlas["bytes"]
m={"note":"Manifest per il loader Phaser (scena Boot). Percorsi relativi alla root servita dal client. originY = piede del personaggio nel primo frame.",
   "spritesheets":sheets,"images":images,"atlases":[atlas],
   "excluded_from_boot":["assets/avatar/avatar_manifest.json (metadati)","assets/shoes/items/*.png (icone singole: usare l'atlas)","assets/shoes/silhouettes/*.png (maschere di lavoro)","assets/PREVIEW_*.png","assets/vendor/pixel-crawler/characters/* (sorgenti per rigenerare l'avatar)","assets/vendor/pixel-crawler/buildings/roofs.png (sorgente: in gioco roofs_upthere.png)"],
   "total_boot_bytes":total}
json.dump(m, open(f"{A}/manifest.json","w"), indent=1, ensure_ascii=False)
print("spritesheets",len(sheets),"images",len(images),"boot KB",round(total/1024))
by={}
for s in sheets: by[s["group"]]=by.get(s["group"],0)+s["bytes"]
for i in images: k=i["path"].split("/")[1] if i["path"].startswith("assets/brand") else i["path"].split("/")[3]; by[k]=by.get(k,0)+i["bytes"]
by["shoes_atlas"]=atlas["bytes"]
print({k:round(v/1024) for k,v in by.items()})
print([ (s["key"],s["originY"]) for s in sheets if s["group"]=="npc"])
