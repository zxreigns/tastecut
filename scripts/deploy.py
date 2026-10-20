#!/usr/bin/env python3
"""Cloudflare Pages direct upload with a _worker.js (advanced mode), no wrangler.
env: CF_API_TOKEN (or TAB_VAULT) (Cloudflare API token), CF_ACCOUNT (account id), optional ENV_JSON (path to {NAME: value} secrets for the production env).
usage: deploy.py <project> <site_dir> [worker.js]"""
import os, sys, json, base64, requests, mimetypes, blake3
tok=os.environ.get("CF_API_TOKEN") or os.environ["TAB_VAULT"]; tok=json.loads(tok) if tok.startswith('"') else tok
acct=os.environ["CF_ACCOUNT"]; proj=sys.argv[1]; d=sys.argv[2]; worker=sys.argv[3] if len(sys.argv)>3 and sys.argv[3] else None
envs=json.load(open(os.environ["ENV_JSON"])) if os.environ.get("ENV_JSON") else {}
H={"Authorization":"Bearer "+tok}; API="https://api.cloudflare.com/client/v4"; B=f"{API}/accounts/{acct}/pages/projects"
r=requests.get(f"{B}/{proj}",headers=H,timeout=30)
if r.status_code==404 or not r.json().get("success"):
    r=requests.post(B,headers=H,json={"name":proj,"production_branch":"main"},timeout=30); print("create",r.status_code)
cfg={"deployment_configs":{"production":{"ai_bindings":{"AI":{}},"compatibility_date":"2026-10-01","compatibility_flags":["nodejs_compat"]}}}
if envs: cfg["deployment_configs"]["production"]["env_vars"]={k:{"type":"secret_text","value":v} for k,v in envs.items()}
r=requests.patch(f"{B}/{proj}",headers=H,json=cfg,timeout=30); print("patch",r.status_code,json.dumps(r.json().get("errors")))
jwt=requests.get(f"{B}/{proj}/upload-token",headers=H,timeout=30).json()["result"]["jwt"]
J={"Authorization":"Bearer "+jwt}
manifest={}; payload={}
for root,_,fs in os.walk(d):
    for f in fs:
        p=os.path.join(root,f); rel="/"+os.path.relpath(p,d).replace(os.sep,"/")
        if rel in ("/_headers","/_redirects"): continue
        b=open(p,"rb").read(); b64=base64.b64encode(b).decode(); ext=os.path.splitext(f)[1].lstrip(".")
        h=blake3.blake3((b64+ext).encode()).hexdigest()[:32]
        manifest[rel]=h; payload[h]={"key":h,"value":b64,"metadata":{"contentType":mimetypes.guess_type(f)[0] or "application/octet-stream"},"base64":True}
miss=requests.post(f"{API}/pages/assets/check-missing",headers=J,json={"hashes":list(payload)},timeout=60).json()
missing=miss.get("result",list(payload)); print("files",len(payload),"missing",len(missing))
batch=[]; size=0
def flush():
    global batch,size
    if not batch: return
    rr=requests.post(f"{API}/pages/assets/upload",headers=J,json=batch,timeout=300)
    if not rr.json().get("success"): print("upload err",rr.text[:300]); sys.exit(1)
    batch=[]; size=0
for h in missing:
    item=payload[h]; batch.append(item); size+=len(item["value"])
    if size>40_000_000 or len(batch)>=400: flush()
flush()
up=requests.post(f"{API}/pages/assets/upsert-hashes",headers=J,json={"hashes":list(payload)},timeout=60).json(); print("upsert",up.get("success"))
files={"manifest":(None,json.dumps(manifest),"application/json"),"branch":(None,"main")}
if worker: files["_worker.js"]=("_worker.js",open(worker,"rb").read(),"application/javascript")
for special in ("_headers","_redirects"):
    sp=os.path.join(d,special)
    if os.path.exists(sp): files[special]=(special,open(sp,"rb").read(),"text/plain")
r=requests.post(f"{B}/{proj}/deployments",headers=H,files=files,timeout=300)
j=r.json(); print(json.dumps({"deploy":r.status_code,"success":j.get("success"),"errors":j.get("errors"),"url":(j.get("result") or {}).get("url"),"id":(j.get("result") or {}).get("id")}))
