# lastro (Helm chart)

Real Helm chart for the same single-process image described in `../../../Dockerfile` and
`../../../docker-compose.yml` — the Express server serves both the API and the built
client (`client/dist`) from one process.

Verified with a real `helm` binary in this environment:

```
helm lint deploy/helm/lastro
helm template lastro-demo deploy/helm/lastro
```

Both pass — every template renders to valid, well-formed Kubernetes YAML (checked with
`helm lint`, `helm template`, and a structural YAML parse of the rendered output),
including the conditional paths (`ingress.enabled`, `redis.enabled`, `autoscaling.enabled`,
`existingSecret`). This is not just written-and-hoped YAML.

## Before you deploy

**Read the `replicaCount` comment in `values.yaml` first.** This app persists to SQLite
(`server/src/db/index.ts`), a single-writer embedded database — running more than one
replica against the same data volume will corrupt data or silently drop writes under real
concurrent load. `replicaCount` is pinned to `1` and `autoscaling.enabled` defaults to
`false` for exactly this reason. Scaling out safely requires migrating to Postgres first —
that path is deliberately documented as *not yet implemented* in
`../../../docs/postgres-migration.md`.

## Quick start

```bash
# 1. Build and push the image (no public image was published from this sandbox)
docker build -t your-registry/lastro:1.0.0 ../../..
docker push your-registry/lastro:1.0.0

# 2. Bring your own Secret for the credentials you actually need (see
#    ../../../server/.env.example for the full list — JWT_SECRET at minimum)
kubectl create secret generic lastro-secrets --from-literal=JWT_SECRET=$(openssl rand -hex 32)

# 3. Install
helm install lastro deploy/helm/lastro \
  --set image.repository=your-registry/lastro \
  --set image.tag=1.0.0 \
  --set existingSecret=lastro-secrets

# 4. Access (no ingress by default)
kubectl port-forward svc/lastro 8080:80
```

See `values.yaml` for every option — persistence sizing, ingress/TLS, the optional bundled
demo Redis, resource requests/limits, and probes against the real
`GET /api/public/status` endpoint (not a fabricated `/healthz`).
