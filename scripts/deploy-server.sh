#!/usr/bin/env bash
set -euo pipefail

sha="${1:?Missing validated commit SHA}"
root="${2:?Missing absolute deployment directory}"
project="${3:?Missing existing Compose project name}"
service="${4:?Missing Compose service name}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit SHA' >&2; exit 1; }
[[ "$root" = /* && "$root" != / && "$root" != *'..'* ]] || { echo 'DEPLOY_ROOT must be a safe absolute app directory' >&2; exit 1; }
[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ && "$service" =~ ^[A-Za-z0-9_-]+$ ]] || { echo 'Invalid Compose project or service' >&2; exit 1; }
for executable in docker rsync tar; do command -v "$executable" >/dev/null || { echo "Missing $executable" >&2; exit 1; }; done

archive="$HOME/v79-release-${sha}.tar.gz"
test -f "$archive" || { echo 'Release bundle missing' >&2; exit 1; }
test -d "$root" && test -f "$root/.env" || { echo "Existing app directory and .env required: $root" >&2; exit 1; }
case "$service" in
  v79-marketing) port=3070; endpoint=/api/health ;;
  fire-finance) port=3010; endpoint=/api/health; test -d "$root/data" ;;
  v79-tiquet-manager) port=3050; endpoint=/health ;;
  course-builder) port=3030; endpoint=/healthz; test -d "$root/data" ;;
  V79website) port=3000; endpoint=/api/ready; test -d "$root/data" && test -d "$root/uploads" ;;
  *) echo 'Unexpected service; deployment denied' >&2; exit 1 ;;
esac
docker network inspect proxy_network >/dev/null
docker compose version >/dev/null

stage="$(mktemp -d "$root/.incoming.XXXXXXXX")"
trap 'rm -rf -- "$stage"' EXIT
tar -xzf "$archive" -C "$stage" --no-same-owner
test -f "$stage/docker-compose.yml" && test -f "$stage/Dockerfile"

# Preserve production state, local git history, and backups. Source is staged first;
# no source files are changed if the release bundle or prerequisites are invalid.
rsync -a --exclude='/.env' --exclude='/.env.*' --exclude='/data/' \
  --exclude='/uploads/' --exclude='/backups/' --exclude='/.git/' "$stage/" "$root/"
cd "$root"
docker compose --project-name "$project" config --services | grep -Fx "$service" >/dev/null
docker compose --project-name "$project" up -d --build --wait --wait-timeout 180 "$service"

# Compose-only status is insufficient for services without a container HEALTHCHECK.
for attempt in {1..12}; do
  if docker compose --project-name "$project" exec -T -e "HEALTH_URL=http://127.0.0.1:${port}${endpoint}" "$service" \
      node -e 'fetch(process.env.HEALTH_URL,{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok) process.exitCode=1}).catch(()=>{process.exitCode=1})' ; then
    printf '%s\n' "$sha" > .deployed_sha
    rm -f -- "$archive"
    echo "Deployed and checked: $service $sha"
    exit 0
  fi
  sleep 5
done
echo "Health endpoint failed after deployment: $service" >&2
docker compose --project-name "$project" logs --tail=80 "$service" >&2
exit 1
