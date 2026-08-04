FROM minio/mc@sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727 AS mc

FROM postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193
RUN apk add --no-cache bash coreutils findutils jq restic \
  && addgroup -g 10001 backup \
  && adduser -D -u 10001 -G backup backup \
  && mkdir -p /opt/backup /repository /staging /restore /cache \
  && chown -R backup:backup /repository /staging /restore /cache
COPY --from=mc /usr/bin/mc /usr/local/bin/mc
COPY ops/backup/common.sh ops/backup/backup-postgres ops/backup/backup-minio \
  ops/backup/backup-all ops/backup/restore-postgres ops/backup/restore-minio \
  ops/backup/restore-all ops/backup/run-backup-loop /opt/backup/
RUN chmod 0555 /opt/backup/*
USER backup
ENV RESTIC_CACHE_DIR=/cache
ENV MC_CONFIG_DIR=/tmp/.mc
ENTRYPOINT ["/opt/backup/run-backup-loop"]
