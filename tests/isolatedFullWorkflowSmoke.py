#!/usr/bin/env python3
"""Disposable integration smoke: website -> Tiquet -> CRM; NO production endpoints."""
import os, json, time, subprocess, urllib.request, urllib.error, pathlib, sys, shutil

TIQUET = pathlib.Path("/home/firelion/v79-dev/tiquet-customer-workflow")
WEBSITE = pathlib.Path("/home/firelion/v79-dev/website-crm-workflow")
POSTGRES = "tiquet-website-workflow-smoke-pg"
PG_URL = "postgres://v79test:temporary_smoke_only@127.0.0.1:55441/v79test"
INTAKE_SECRET="test_intake_secret_local_only_20261109"
CRM_SECRET="test_crm_secret_local_only_more_than_32_chars_20261109"
TIQUET_URL="http://127.0.0.1:3000"
WEBSITE_URL="http://127.0.0.1:31861"
processes=[]
def run(*args, **kwargs):
    return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,**kwargs)
def check(method, url, body=None, token=None, headers=None, expect=200):
    data=json.dumps(body).encode() if body is not None else None
    h={"Content-Type":"application/json",**(headers or {})}
    if token: h["Authorization"]="Bearer "+token
    request=urllib.request.Request(url,data=data,headers=h,method=method)
    try:
        with urllib.request.urlopen(request,timeout=12) as response:
            status=response.status; payload=json.loads(response.read() or "{}")
    except urllib.error.HTTPError as e:
        status=e.code; payload=json.loads(e.read() or "{}")
    if status!=expect:
        raise AssertionError("{} {} expected {} got {}: {}".format(method,url,expect,status,str(payload)[:260]))
    return payload
def ready(url,max_wait=45):
    for _ in range(max_wait * 5):
        try:
            with urllib.request.urlopen(url,timeout=2) as response:
                if response.status<500: return
        except Exception: pass
        time.sleep(.2)
    raise RuntimeError("Server did not start: "+url)
def launch(root, env, logfile):
    fp=open(logfile,"w",encoding="utf-8")
    process=subprocess.Popen(["node", "server/index.js" if root==TIQUET else "dist/server/server.cjs"],
        cwd=root, env={**os.environ,**env}, stdout=fp,stderr=subprocess.STDOUT,start_new_session=True)
    processes.append((process,fp))
    return process
def shutdown(process):
    if process.poll() is None:
        process.terminate()
        try: process.wait(timeout=7)
        except subprocess.TimeoutExpired:
            process.kill();process.wait(timeout=4)
try:
    run("podman","run","-d","--rm","--name",POSTGRES,
        "-e","POSTGRES_USER=v79test","-e","POSTGRES_PASSWORD=temporary_smoke_only",
        "-e","POSTGRES_DB=v79test","-p","127.0.0.1:55441:5432","docker.io/library/postgres:16")
    for _ in range(80):
        if subprocess.run(["podman","exec",POSTGRES,"pg_isready","-U","v79test","-d","v79test"],
                          stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0: break
        time.sleep(.35)
    else: raise RuntimeError("Test PostgreSQL did not initialise")
    tiquet_env={
        "NODE_ENV":"production","V79_ALLOW_LEGACY_AUTH":"1","DATABASE_URL":PG_URL,
        "JWT_SECRET":"test_tiquet_local_jwt_secret_12345678901234567890",
        "SUPER_ADMIN_JWT_SECRET":"test_tiquet_local_admin_secret_1234567890123456",
        "INTAKE_ACCOUNT_ID":"default_account","INTAKE_SECRET":INTAKE_SECRET,
        "PORT":"3050",
    }
    boot=launch(TIQUET,tiquet_env,"/tmp/v79-workflow-smoke-tiquet-boot.log")
    ready(TIQUET_URL+"/health/ready")
    reg=check("POST",TIQUET_URL+"/api/auth/register",{
        "name":"Workflow Test Admin","email":"workflow.test@example.invalid",
        "password":"Workflow!2026#SafeLogin","companyName":"Test Vision79 Workflow"
    },expect=201)
    token=reg.get("token")
    if not token:raise AssertionError("Missing admin token in isolated Tiquet response")
    account=check("GET",TIQUET_URL+"/api/auth/me",token=token)
    account_id=account["account_id"]
    assert account["role"]=="Admin",account
    print("PASS isolated admin account registered",flush=True)
    shutdown(boot)
    time.sleep(1)
    tiquet_env.update({
      "INTAKE_ACCOUNT_ID":account_id,
      "TIQUET_WEBSITE_CRM_CONVERT_URL":WEBSITE_URL+"/api/integrations/tiquet/customer-convert",
      "TIQUET_WEBSITE_CRM_SECRET":CRM_SECRET
    })
    actual_tiquet=launch(TIQUET,tiquet_env,"/tmp/v79-workflow-smoke-tiquet.log")
    ready(TIQUET_URL+"/health/ready")
    # No production website DB, Hub SSO, SMTP, or external integrations are used.
    shutil.rmtree(WEBSITE/"data",ignore_errors=True)
    website_env={
      "PORT":"31861","CAPTCHA_MODE":"disabled","WEBSITE_HUB_SSO_ENABLED":"false",
      "V79TIQUET_INTAKE_URL":TIQUET_URL+"/api/public/intake",
      "V79TIQUET_INTAKE_SECRET":INTAKE_SECRET,
      "TIQUET_CRM_SHARED_SECRET":CRM_SECRET,
      "TIQUET_CRM_ACCOUNT_ID":account_id,
      "NODE_ENV":"development"
    }
    site=launch(WEBSITE,website_env,"/tmp/v79-workflow-smoke-website.log")
    ready(WEBSITE_URL+"/api/apps")
    print("PASS both isolated services started",flush=True)
    payload={
      "name":"Test Contact","company":"Saint Lucia Sample Shop",
      "email":"test.customer@example.invalid","phone":"7585550199",
      "employees":"3","biggestChallenge":"Need managed router support",
      "serviceRequested":"Managed IT Support",
      "message":"Please help inspect network performance",
      "pageOrigin":"/contact","leadSource":"Website Contact Form"
    }
    key={"Idempotency-Key":"workflow-smoke-test-20261109"}
    lead=check("POST",WEBSITE_URL+"/api/leads",payload,headers=key,expect=201)
    again=check("POST",WEBSITE_URL+"/api/leads",payload,headers=key,expect=200)
    assert again["id"]==lead["id"]
    print("PASS website lead saved and exact retry deduplicated",flush=True)
    job=None
    for i in range(100):
        jobs=check("GET",TIQUET_URL+"/api/jobs",token=token)
        found=[x for x in jobs if x.get("clientEmail")=="test.customer@example.invalid"]
        if len(found)==1:
            job=found[0];break
        time.sleep(.35)
    assert job,"Website-to-Tiquet handoff failed"
    assert job["intakeEventId"] and job["websiteAckStatus"] in ("queued","sending","failed")
    assert job["secureTokenExpires"],"Portal link expiry missing"
    print("PASS ticket created with durable email queue, valid portal expiry and correlation",flush=True)
    jobid=job["id"]
    for i in range(40):
        jobs=check("GET",TIQUET_URL+"/api/jobs",token=token)
        item=next(x for x in jobs if x["id"]==jobid)
        if item.get("websiteAckStatus")=="failed":break
        time.sleep(.3)
    else: raise AssertionError("SMTP absent but queue did not record failure")
    assert item["websiteAckSentAt"] is None
    print("PASS unavailable SMTP reports pending retry; no false delivery",flush=True)
    bad=check("POST",WEBSITE_URL+"/api/integrations/tiquet/customer-convert",{
      "jobId":jobid,"intakeEventId":job["intakeEventId"],
      "sourceAccountId":account_id,"confirmationNotes":"Customer approved the work",
      "confirmedBy":"Admin"
    },headers={"x-v79-tiquet-crm-secret":"wrong"},expect=401)
    check("POST",TIQUET_URL+"/api/jobs/"+jobid+"/customer-confirmation",{
      "outcome":"confirmed","notes":"Customer has agreed to proceed"
    },expect=401)
    print("PASS unauthorised direct conversion and ticket update rejected",flush=True)
    callback=check("POST",TIQUET_URL+"/api/jobs/"+jobid+"/customer-confirmation",{
      "outcome":"callback","notes":"Call back tomorrow after the manager reviews options"
    },token=token)
    assert callback["outcome"]=="callback"
    confirm=check("POST",TIQUET_URL+"/api/jobs/"+jobid+"/customer-confirmation",{
      "outcome":"confirmed","notes":"Spoke to owner, approved managed ICT service after review"
    },token=token)
    assert confirm["success"] and confirm["customerId"].startswith("V79-CLI-"),confirm
    repeated=check("POST",TIQUET_URL+"/api/jobs/"+jobid+"/customer-confirmation",{
      "outcome":"confirmed","notes":"This is an accidental repeated click after approval"
    },token=token)
    assert repeated["customerId"]==confirm["customerId"]
    assert repeated["alreadyConverted"]
    print("PASS callback, approved conversion and idempotent repeated click",flush=True)
    jobs=check("GET",TIQUET_URL+"/api/jobs",token=token)
    persisted=next(x for x in jobs if x["id"]==jobid)
    assert persisted["crmSyncStatus"]=="synced" and persisted["crmLeadId"],persisted
    assert any("linked to customer" in a["action"] for a in persisted["activityLog"])
    print("PASS CRM customer link and ticket audit persisted",flush=True)
    # Website persists CRM via an internal storage layer (not necessarily
    # a plain JSON file). Read back through the authenticated integration.
    crm=check("POST", WEBSITE_URL+"/api/integrations/tiquet/customer-convert", {
      "jobId":jobid, "intakeEventId":job["intakeEventId"],
      "sourceAccountId":account_id, "confirmationNotes":"Repeated verification call, same customer",
      "confirmedBy":"Test Admin"
    }, headers={"x-v79-tiquet-crm-secret":CRM_SECRET})
    assert crm["alreadyConverted"] is True,crm
    assert crm["crmLeadId"]==confirm["crmLeadId"] and crm["customerId"]==confirm["customerId"]
    print("PASS website CRM confirms previously stored conversion with identical customer identity",flush=True)
    # Repeat business is another opportunity, not a new customer.
    second_payload={**payload,"message":"Please upgrade a switch at our second site"}
    check("POST", WEBSITE_URL+"/api/leads", second_payload,
          headers={"Idempotency-Key":"workflow-second-request-20261109"},expect=201)
    second=None
    for i in range(100):
        jobs=check("GET",TIQUET_URL+"/api/jobs",token=token)
        matches=[x for x in jobs if x["id"]!=jobid and
                 x.get("clientEmail")=="test.customer@example.invalid"]
        if len(matches)==1:
            second=matches[0];break
        time.sleep(.35)
    assert second,"Second website enquiry was not linked to Tiquet"
    new_confirmation=check("POST", TIQUET_URL+"/api/jobs/"+second["id"]+"/customer-confirmation", {
      "outcome":"confirmed","notes":"Existing customer confirmed additional switch installation work"
    },token=token)
    assert new_confirmation["customerId"]==confirm["customerId"],new_confirmation
    assert new_confirmation["crmLeadId"]!=confirm["crmLeadId"],new_confirmation
    print("PASS repeat business creates a separate opportunity but reuses the existing customer ID",flush=True)
    print("FULL_WORKFLOW_SMOKE_PASS",flush=True)
except Exception as error:
    print("FULL_WORKFLOW_SMOKE_FAILED",repr(error),flush=True)
    for loc in ("/tmp/v79-workflow-smoke-tiquet-boot.log",
                "/tmp/v79-workflow-smoke-tiquet.log","/tmp/v79-workflow-smoke-website.log"):
        fp=pathlib.Path(loc)
        if fp.exists():
            print("LOG",loc,flush=True)
            print("\n".join(fp.read_text(errors="replace").splitlines()[-13:]),flush=True)
    sys.exit(1)
finally:
    for proc,fp in reversed(processes):
        shutdown(proc); fp.close()
    subprocess.run(["podman","stop","--time","2",POSTGRES],check=False,
                   stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    # This is a throw-away working tree. Do not retain any test customer PII.
    shutil.rmtree(WEBSITE/"data",ignore_errors=True)
