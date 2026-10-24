#!/usr/bin/env python3
"""Read-only V79 Hub/Tiquet metadata evidence. NEVER prints secret values or records.

Run on the authorized v79sl device only, with explicit --audit. No file content
reads beyond Docker inspect's in-memory metadata; never writes, executes Docker
changes, connects to PostgreSQL, opens backups, or prints environment values
except approved non-secret 0/1 feature flags.
"""
import argparse, datetime, json, os, pathlib, socket, subprocess, sys

NAMES = ("v79-hub", "v79-tiquet-manager", "tiquet-postgres", "v79-hub-postgres")
FLAGS = {
    "v79-hub": ("V79_HUB_TIQUET_SESSION_BINDING",),
    "v79-tiquet-manager": (
        "V79_ENTITLEMENT_RECHECK_ENABLED",
        "V79_TIQUET_SESSION_BINDING_ENABLED",
        "V79_SUPPORT_DESK_ENABLED",
        "V79_ALLOW_LEGACY_AUTH",
    ),
}
SENSITIVE_KEYS = (
    "SECRET", "PASSWORD", "PRIVATE", "TOKEN", "API_KEY", "DATABASE_URL", "SMTP",
    "WIPAY", "RESEND",
)

def summarise(inspects, home, now):
    by_name = {str(x.get("Name", "")).lstrip("/"): x for x in inspects}
    result = {"schema": "v79-readonly-metadata-v1",
              "audit_time_utc": now.isoformat(),
              "secret_values_exported": False,
              "production_write_actions": False,
              "containers": {}, "backups": {}}
    for name in NAMES:
        o = by_name.get(name)
        if not o:
            result["containers"][name] = {"present": False}
            continue
        state = o.get("State") or {}
        env = (o.get("Config") or {}).get("Env") or []
        # Inspect data never leaves this process: only allowlisted boolean keys.
        allowed = {}
        for key in FLAGS.get(name, ()):
            matches = [str(e)[len(key)+1:] for e in env if str(e).startswith(key+"=")]
            v = matches[-1] if matches else None
            allowed[key] = "ON" if v == "1" else "OFF" if v == "0" else "UNSET" if v is None else "OTHER_STOP"
        networks = (o.get("NetworkSettings") or {}).get("Networks") or {}
        mounts = o.get("Mounts") or []
        published = (o.get("NetworkSettings") or {}).get("Ports") or {}
        image = str(o.get("Image") or "")
        result["containers"][name] = {
            "present": True, "running": state.get("Running") is True,
            "health": (state.get("Health") or {}).get("Status", "NOT_REPORTED"),
            "image_id": image if image.startswith("sha256:") and len(image) == 71 else "NOT_VERIFIED",
            "networks": sorted(n for n in networks if n in {"proxy_network","bridge"}),
            "published_host_ports": any(v for v in published.values()),
            "mount_type_counts": {
                k: sum(1 for m in mounts if m.get("Type") == k)
                for k in ("bind","volume","tmpfs")
            },
            "feature_flags": allowed,
            "critical_secret_values": "NOT_READ_FOR_PARITY",
        }
    backups = {
        "recovery_checkpoints": home / "V79-Recovery-Checkpoints",
        "portfolio_checkpoints": home / "V79-Portfolio-Checkpoints",
        "offhost_capture": home / "V79-P1-R1-Offhost-Capture",
    }
    for label, root in backups.items():
        if not root.is_dir() or root.is_symlink():
            result["backups"][label] = {"directory_present": False}
            continue
        encrypted = 0
        newest = None
        # Depth 3 only, max 4000 filesystem entries, metadata only.
        pending = [(root, 0)]
        seen = 0
        while pending and seen < 4000:
            parent, depth = pending.pop()
            try:
                children = list(parent.iterdir())
            except (OSError, PermissionError):
                continue
            for p in children:
                seen += 1
                if seen > 4000:
                    break
                try:
                    if p.is_symlink():
                        continue
                    if p.is_dir() and depth < 3:
                        pending.append((p, depth+1))
                    elif p.is_file() and p.suffix.lower() in (".gpg",".age"):
                        encrypted += 1
                        stamp = p.stat().st_mtime
                        newest = stamp if newest is None else max(newest,stamp)
                except (OSError, PermissionError):
                    continue
        age_hours = None if newest is None else max(0,round((now.timestamp()-newest)/3600,1))
        result["backups"][label] = {
            "directory_present": True, "encrypted_files_visible": encrypted,
            "latest_encrypted_file_age_hours": age_hours,
            "scan_entry_cap_reached": seen >= 4000,
            "restore_tested": False,
            "encrypted_content_read": False,
        }
    result["gates"] = {
        "actual_secret_parity": "NOT_TESTED",
        "cross_store_atomic_recovery": "NOT_TESTED",
        "production_restore": "NOT_TESTED",
        "live_release": "NO_GO",
    }
    return result

def self_test():
    example = {"Name": "/v79-hub", "State":{"Running":True},
               "Config":{"Env":["V79_HUB_TIQUET_SESSION_BINDING=0",
                                "DB_PASSWORD=SUPER_PRIVATE_CANARY",
                                "V79_TIQUET_LAUNCH_SECRET=SUPER_PRIVATE_CANARY"]},
               "Image":"sha256:"+"a"*64,
               "Mounts":[], "NetworkSettings":{"Networks":{"proxy_network":{}},"Ports":{}}}
    from tempfile import TemporaryDirectory
    with TemporaryDirectory() as d:
        output=json.dumps(summarise([example],pathlib.Path(d),
                          datetime.datetime.now(datetime.timezone.utc)))
    assert "SUPER_PRIVATE_CANARY" not in output
    assert "DB_PASSWORD" not in output
    assert "v79-hub" in output
    assert '"live_release": "NO_GO"' in output
    print("V79_READONLY_AUDIT_SELF_TEST=PASS_NO_SECRET_VALUES")
    print("V79_READONLY_AUDIT_WRITES=NONE")

def main():
    parser=argparse.ArgumentParser()
    mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--self-test",action="store_true")
    mode.add_argument("--audit",action="store_true")
    args=parser.parse_args()
    if args.self_test:
        self_test()
        return
    if socket.gethostname()!="v79sl":
        raise SystemExit("STOP: AUDIT_AUTHORIZED_SERVER_HOSTNAME_MISMATCH")
    # No database access; Docker inspect is read-only, no exec/start/restart.
    p=subprocess.run(["docker","inspect",*NAMES],capture_output=True,text=True,
                     timeout=15,check=False)
    if p.returncode != 0:
        # Missing containers may cause inspect nonzero: retry one by one,
        # still no raw error output or environment values printed.
        items=[]
        for name in NAMES:
            r=subprocess.run(["docker","inspect",name],capture_output=True,
                             text=True,timeout=8,check=False)
            if r.returncode == 0:
                items.extend(json.loads(r.stdout))
    else:
        items=json.loads(p.stdout)
    # Do not leak stderr/stdout from inspect on failure.
    report=summarise(items,pathlib.Path.home(),
                     datetime.datetime.now(datetime.timezone.utc))
    print(json.dumps(report,indent=2,sort_keys=True))
if __name__=="__main__":
    main()
