# PostgreSQL 16 (тот же базовый образ, что и раньше) + pgvector для смыслового поиска (E-037).
# Базовый образ не меняем: данные и правила сортировки в индексах остаются прежними.
FROM postgres:16-alpine
ARG PGVECTOR_VERSION=v0.8.0
RUN apk add --no-cache --virtual .build-deps git build-base \
 && git clone --branch "$PGVECTOR_VERSION" --depth 1 https://github.com/pgvector/pgvector.git /tmp/pgvector \
 && cd /tmp/pgvector \
 && make OPTFLAGS="" with_llvm=no \
 && make install with_llvm=no \
 && cd / && rm -rf /tmp/pgvector \
 && apk del .build-deps
