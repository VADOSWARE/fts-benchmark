.PHONY: all .data \
				clean clean-data \
				print-version \
# Check deps
				check-dep-nodejs check-dep-docker check-dep-gunzip check-env-FTS_ENGINE \
# Run a single experiment
				setup run ingest query \
# FTS Engine start
				engine-start engine-start-pg engine-start-meilisearch \
				engine-start-sqlite \
				engine-start-opensearch \
				engine-start-tyepsense \
				opensearch-volume-create \
# FTS Engine stop
				engine-stop engine-stop-pg engine-stop-meilisearch \
				engine-stop-sqlite engine-stop-opensearch engine-stop-tyepsense \
				opensearch-volume-delete

GIT ?= git
NODE ?= node
GUNZIP ?= gunzip
PNPM ?= pnpm
SQLITE ?= sqlite3

DOCKER ?= docker
DOCKER_LISTEN_HOST ?= 127.0.0.1

ROOT_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
VERSION ?= $(shell $(NODE) -e 'console.log(require("./package.json").version);')
CURRENT_SHA ?= $(shell $(GIT) rev-parse --short HEAD)

DATA_MOVIES_CSV_ZIPPED_PATH ?= $(ROOT_DIR)movies.csv.gz
DATA_MOVIES_CSV_PATH ?= $(ROOT_DIR)movies.csv
DATA_MOVIES_NDJSON_PATH ?= $(ROOT_DIR)movies.ndjson.json
SEARCH_PHRASES_NDJSON_PATH ?= $(ROOT_DIR)search-phrases.ndjson.json

SQLITE_DISK_DB_PATH ?= ./fts-sqlite-disk-db.sqlite

all: setup run-all

.data:
	@mkdir -p .data

clean: clean-data

clean-data:
	@echo "[note] this may need to run with sudo to remove container data dirs..."
	rm -rf ./.data

CHANGELOG_FILE_PATH ?= CHANGELOG

changelog:
	$(GIT) cliff --unreleased --tag=$(VERSION) --prepend=$(CHANGELOG_FILE_PATH)

print-version:
	echo -n $(VERSION)

###########
# Tooling #
###########

check-dep-nodejs:
ifeq (,$(shell which $(NODE)))
	$(error "please enture NodeJS is installed (see: https://nodejs.org)")
endif

check-dep-docker:
ifeq (,$(shell which $(DOCKER)))
	$(error "please enture Docker is installed (see: https://docs.docker.com)")
endif

check-dep-gunzip:
ifeq (,$(shell which $(GUNZIP)))
	$(error "please ensure gunzip is installed (see https://www.gnu.org/software/gzip)")
endif

check-dep-sqlite:
ifeq (,$(shell which $(SQLITE)))
	$(error "please ensure SQLite is installed (see https://www.sqlite.org)")
endif

check-env-FTS_ENGINE:
ifeq ("","$(FTS_ENGINE)")
	$(error "an FTS_ENGINE must be specified (ex. 'pg', 'meilisearch', 'sqlite', 'typesense', 'opensearch')")
endif

#########
# Build #
#########

INPUT_CSV_PATH ?= $(DATA_MOVIES_CSV_ZIPPED_PATH)

movies.csv: check-dep-gunzip
	@if [ ! -f "$(DATA_MOVIES_CSV_PATH)" ]; then \
		echo -e "[info] unzipping [$(DATA_MOVIES_CSV_ZIPPED_PATH)]..."; \
		$(GUNZIP) -fk $(DATA_MOVIES_CSV_ZIPPED_PATH); \
	fi

movies.ndjson.json: check-dep-gunzip movies.csv
	@if [ ! -f "$(DATA_MOVIES_NDJSON_PATH)" ]; then \
		echo -e "[info] converting [$(DATA_MOVIES_CSV_PATH)] to [$(DATA_MOVIES_NDJSON_PATH)]..."; \
		INPUT_CSV_PATH=$(DATA_MOVIES_CSV_PATH) OUTPUT_NDJSON_PATH=$(DATA_MOVIES_NDJSON_PATH) $(NODE) src/util/csv2ndjson.mjs; \
	fi

setup:
	$(PNPM) install

run:
	@$(MAKE) --quiet --no-print-directory engine-start || true
	@$(MAKE) --quiet --no-print-directory ingest
	@$(MAKE) --quiet --no-print-directory query
	@$(MAKE) --quiet --no-print-directory engine-stop

run-all:
	@$(MAKE) --quiet --no-print-directory run FTS_ENGINE=pg
	@$(MAKE) --quiet --no-print-directory run FTS_ENGINE=meilisearch
	@$(MAKE) --quiet --no-print-directory run FTS_ENGINE=typesense
	@$(MAKE) --quiet --no-print-directory run FTS_ENGINE=opensearch
	@$(MAKE) --quiet --no-print-directory run FTS_ENGINE=sqlite-disk
	@$(MAKE) --quiet --no-print-directory run FTS_ENGINE=sqlite-mem

######################
# Release Automation #
######################

release-major:
	$(PNPM) version major --no-git-tag-version
	$(MAKE) -s --no-print-directory changelog
	$(GIT) commit -am "release: v`$(MAKE) -s --no-print-directory print-version`"
	$(GIT) tag "v`$(MAKE) -s --no-print-directory print-version`"
	$(GIT) push --all

release-minor:
	$(PNPM) version minor --no-git-tag-version
	$(MAKE) -s --no-print-directory changelog
	$(GIT) commit -am "release: v`$(MAKE) -s --no-print-directory print-version`"
	$(GIT) tag "v`$(MAKE) -s --no-print-directory print-version`"
	$(GIT) push --all

release-patch:
	$(PNPM) version patch --no-git-tag-version
	$(MAKE) -s --no-print-directory changelog
	$(GIT) commit -am "release: v`$(MAKE) -s --no-print-directory print-version`"
	$(GIT) tag "v`$(MAKE) -s --no-print-directory print-version`"
	$(GIT) push --all

#############
# Ingestion #
#############

ingest: check-dep-nodejs check-env-FTS_ENGINE movies.ndjson.json
ifeq ("pg","$(FTS_ENGINE)")
	@$(MAKE) --quiet --no-print-directory ingest-pg
else ifeq ("meilisearch","$(FTS_ENGINE)")
	@$(MAKE) --quiet --no-print-directory ingest-meilisearch
else ifeq ("typesense","$(FTS_ENGINE)")
	@$(MAKE) --quiet --no-print-directory ingest-typesense
else ifeq ("opensearch","$(FTS_ENGINE)")
	@$(MAKE) --quiet --no-print-directory ingest-opensearch
else ifeq ("sqlite-disk","$(FTS_ENGINE)")
	@$(MAKE) --quiet --no-print-directory ingest-sqlite-disk
else ifeq ("sqlite-mem","$(FTS_ENGINE)")
	@$(MAKE) --quiet --no-print-directory ingest-sqlite-mem
else
	$(error "failed to start unrecognized FTS engine [$(FTS_ENGINE)]")
endif

ingest-pg:
	@OP=ingest \
	INGEST_INPUT_PATH=$(DATA_MOVIES_NDJSON_PATH) \
	PG_URL=$(PG_URL) \
	$(NODE) "src/driver/index.mjs"

ingest-meilisearch:
	@OP=ingest \
	INGEST_INPUT_PATH=$(DATA_MOVIES_NDJSON_PATH) \
	MEILI_URL=http://$(MEILI_HOST):$(MEILI_PORT) \
	MEILI_API_KEY=$(MEILI_MASTER_KEY) \
	$(NODE) "src/driver/index.mjs"

ingest-typesense:
	@OP=ingest \
	INGEST_INPUT_PATH=$(DATA_MOVIES_NDJSON_PATH) \
	TYPESENSE_HOST=$(TYPESENSE_HOST) \
	TYPESENSE_PORT=$(TYPESENSE_PORT) \
	TYPESENSE_API_KEY=$(TYPESENSE_API_KEY) \
	$(NODE) "src/driver/index.mjs"

ingest-opensearch:
	@OP=ingest \
	INGEST_INPUT_PATH=$(DATA_MOVIES_NDJSON_PATH) \
	OPENSEARCH_PROTOCOL=$(OPENSEARCH_PROTOCOL) \
	OPENSEARCH_HOST=$(OPENSEARCH_HOST) \
	OPENSEARCH_PORT=$(OPENSEARCH_PORT) \
	OPENSEARCH_AUTH_USERNAME=$(OPENSEARCH_AUTH_USERNAME) \
	OPENSEARCH_AUTH_PASSWORD=$(OPENSEARCH_AUTH_PASSWORD) \
	$(NODE) "src/driver/index.mjs"

ingest-sqlite-disk:
	@OP=ingest \
	INGEST_INPUT_PATH=$(DATA_MOVIES_NDJSON_PATH) \
	SQLITE_DISK_DB_PATH=$(SQLITE_DISK_DB_PATH) \
	$(NODE) "src/driver/index.mjs"

ingest-sqlite-mem:
	@OP=ingest+query \
	INGEST_INPUT_PATH=$(DATA_MOVIES_NDJSON_PATH) \
	QUERY_INPUT_PATH=$(SEARCH_PHRASES_NDJSON_PATH) \
	SQLITE_DISK_DB_PATH=":memory:" \
	$(NODE) "src/driver/index.mjs"

############
# Querying #
############

QUERIES_YAML_PATH ?= $(ROOT_DIR)queries.yaml

## Run the query
query: check-dep-nodejs check-env-FTS_ENGINE
ifeq ("pg","$(FTS_ENGINE)")
	@$(MAKE) --quiet --no-print-directory query-pg
else ifeq ("meilisearch","$(FTS_ENGINE)")
	@$(MAKE) --quiet --no-print-directory query-meilisearch
else ifeq ("typesense","$(FTS_ENGINE)")
	@$(MAKE) --quiet --no-print-directory query-typesense
else ifeq ("opensearch","$(FTS_ENGINE)")
	@$(MAKE) --quiet --no-print-directory query-opensearch
else ifeq ("sqlite-disk","$(FTS_ENGINE)")
	@$(MAKE) --quiet --no-print-directory query-sqlite-disk
else ifeq ("sqlite-mem","$(FTS_ENGINE)")
	@$(MAKE) --quiet --no-print-directory query-sqlite-mem
else
	$(error "failed to start unrecognized FTS engine [$(FTS_ENGINE)]")
endif

query-pg:
	@OP=query \
	TIMING=true \
	QUERY_INPUT_PATH=$(SEARCH_PHRASES_NDJSON_PATH) \
	PG_URL=$(PG_URL) \
	$(NODE) "src/driver/index.mjs"

query-meilisearch:
	@OP=query \
	TIMING=true \
	QUERY_INPUT_PATH=$(SEARCH_PHRASES_NDJSON_PATH) \
	MEILI_URL=http://$(MEILI_HOST):$(MEILI_PORT) \
	MEILI_API_KEY=$(MEILI_MASTER_KEY) \
	$(NODE) "src/driver/index.mjs"

query-typesense:
	@OP=query \
	TIMING=true \
	QUERY_INPUT_PATH=$(SEARCH_PHRASES_NDJSON_PATH) \
	TYPESENSE_HOST=$(TYPESENSE_HOST) \
	TYPESENSE_PORT=$(TYPESENSE_PORT) \
	TYPESENSE_API_KEY=$(TYPESENSE_API_KEY) \
	$(NODE) "src/driver/index.mjs"

query-opensearch:
	@OP=query \
	TIMING=true \
	QUERY_INPUT_PATH=$(SEARCH_PHRASES_NDJSON_PATH) \
	OPENSEARCH_PROTOCOL=$(OPENSEARCH_PROTOCOL) \
	OPENSEARCH_HOST=$(OPENSEARCH_HOST) \
	OPENSEARCH_PORT=$(OPENSEARCH_PORT) \
	OPENSEARCH_AUTH_USERNAME=$(OPENSEARCH_AUTH_USERNAME) \
	OPENSEARCH_AUTH_PASSWORD=$(OPENSEARCH_AUTH_PASSWORD) \
	$(NODE) "src/driver/index.mjs"

query-sqlite-disk:
	@OP=query \
	TIMING=true \
	QUERY_INPUT_PATH=$(SEARCH_PHRASES_NDJSON_PATH) \
	SQLITE_DISK_DB_PATH=$(SQLITE_DISK_DB_PATH) \
	$(NODE) "src/driver/index.mjs"

query-sqlite-mem:
	@echo -e "ingest and query for sqlite memory happen *at the same time*, this is a no-op"

#######################
# FTS Engines - Start #
#######################

## Start the FTS engine of choice
engine-start: check-dep-docker
ifeq ("pg","$(FTS_ENGINE)")
	$(MAKE) engine-start-pg
else ifeq ("meilisearch","$(FTS_ENGINE)")
	$(MAKE) engine-start-meilisearch
else ifeq ("typesense","$(FTS_ENGINE)")
	$(MAKE) engine-start-typesense
else ifeq ("opensearch","$(FTS_ENGINE)")
	$(MAKE) engine-start-opensearch
else ifeq ("sqlite-disk","$(FTS_ENGINE)")
	$(MAKE) engine-start-sqlite-disk
else ifeq ("sqlite-mem","$(FTS_ENGINE)")
	$(MAKE) engine-start-sqlite-disk
else
	$(error "failed to start unrecognized FTS engine [$(FTS_ENGINE)]")
endif

WAIT4X_IMAGE ?= atkrad/wait4x:2.6.2@sha256:594886afdd1f4d6678e97a4fb7d9bbd951c750d255b1197ada90ffe3f260c271

###############
# FTS Engines #
###############

PG_CONTAINER_NAME ?= fts-pg
PG_IMAGE ?= postgres:14.5-alpine3.16@sha256:9ece045f37060bf6b0a36ffbd5afa4f56636370791abae5062ed6005ec0e5110
PG_PASSWORD ?= fts
PG_USER ?= fts
PG_PORT ?= 5432
PG_HOST ?= localhost
PG_DB ?= fts
PG_URL ?= "postgres://$(PG_USER):$(PG_PASSWORD)@$(PG_HOST):$(PG_PORT)/$(PG_DB)"

engine-start-pg:
	@$(DOCKER) run \
		--rm \
		--detach \
		-p $(DOCKER_LISTEN_HOST):$(PG_PORT):$(PG_PORT) \
		-e POSTGRES_USER=$(PG_USER) \
		-e POSTGRES_PASSWORD=$(PG_PASSWORD) \
		-v $(PWD)/.data/postgres:/var/lib/postgresql/data \
		--name=$(PG_CONTAINER_NAME) \
		$(PG_IMAGE)
	@echo "[info] started docker container [$(PG_CONTAINER_NAME)]..."
	@echo "[info] waiting for TCP connectivity to [$(PG_CONTAINER_NAME)]..."
	@$(DOCKER) run --rm  --net=host $(WAIT4X_IMAGE) tcp $(PG_HOST):$(PG_PORT)
	sleep 3

############################
# FTS Engine - MeiliSearch #
############################

MEILI_CONTAINER_NAME ?= fts-meili
MEILI_IMAGE ?= getmeili/meilisearch:v0.28.1@sha256:dc55a924c56420ae0bbcf8724311de46816aa623fdc90bc89bdb98e72dad08ce
MEILI_MASTER_KEY ?= meilisearch
MEILI_ENV ?= production
MEILI_PORT ?= 7700
MEILI_HOST ?= localhost

engine-start-meilisearch:
	$(DOCKER) run --rm \
		--detach \
		-p $(DOCKER_LISTEN_HOST):$(MEILI_PORT):$(MEILI_PORT) \
		-e MEILI_MASTER_KEY=$(MEILI_MASTER_KEY) \
		--name=$(MEILI_CONTAINER_NAME) \
		-v $(PWD)/.data/meilisearch:/meili_data \
		$(MEILI_IMAGE) \
			/bin/meilisearch \
			--env="$(MEILI_ENV)"
	@echo "[info] waiting for TCP connectivity to [$(MEILI_CONTAINER_NAME)]..."
	@$(DOCKER) run --rm  --net=host $(WAIT4X_IMAGE) tcp $(MEILI_HOST):$(MEILI_PORT)
	sleep 3

##########################
# FTS Engine - Typesense #
##########################

TYPESENSE_CONTAINER_NAME ?= fts-typesense
TYPESENSE_IMAGE ?= typesense/typesense:0.23.1@sha256:827ac4dda3cd766c5e6db955729d9abaf9ae08722d3c50e047d3f8afea23a726
TYPESENSE_API_KEY ?= badtypesenseapikey
TYPESENSE_PORT ?= 8108
TYPESENSE_HOST ?= localhost

engine-start-typesense:
	@$(DOCKER) run --rm \
		--detach \
		-p $(DOCKER_LISTEN_HOST):$(TYPESENSE_PORT):$(TYPESENSE_PORT) \
		--name=$(TYPESENSE_CONTAINER_NAME) \
		-v $(PWD)/.data/typesense:/data \
		$(TYPESENSE_IMAGE) \
			--data-dir /data \
			--api-key="$(TYPESENSE_API_KEY)"
	@echo "[info] started docker container [$(TYPESENSE_CONTAINER_NAME)]..."
	@echo "[info] waiting for TCP connectivity to [$(TYPESENSE_CONTAINER_NAME)]..."
	@$(DOCKER) run --rm  --net=host $(WAIT4X_IMAGE) tcp $(TYPESENSE_HOST):$(TYPESENSE_PORT)
	sleep 3

###########################
# FTS Engine - OpenSearch #
###########################

OPENSEARCH_CONTAINER_NAME ?= fts-opensearch
OPENSEARCH_IMAGE ?= opensearchproject/opensearch:2.2.0@sha256:174ee3a36ded56043add6e9d9086c9c0e877c38b3161a9f89b5bfc8f83a24ab3
OPENSEARCH_AUTH_PASSWORD ?= admin
OPENSEARCH_AUTH_USERNAME ?= admin
OPENSEARCH_PROTOCOL ?= http
OPENSEARCH_HOST ?= localhost
OPENSEARCH_PORT ?= 9200
OPENSEARCH_PERF_PORT ?= 9600

opensearch-volume-create:
	$(DOCKER) volume create $(OPENSEARCH_CONTAINER_NAME)

engine-start-opensearch: .data opensearch-volume-create
	@$(DOCKER) run \
		--detach \
		--rm \
		--name=$(OPENSEARCH_CONTAINER_NAME) \
		-p $(DOCKER_LISTEN_HOST):$(OPENSEARCH_PORT):$(OPENSEARCH_PORT) \
		-p $(DOCKER_LISTEN_HOST):$(OPENSEARCH_PERF_PORT):$(OPENSEARCH_PERF_PORT) \
		-e "discovery.type=single-node" \
		-e "plugins.security.disabled=true" \
		-v $(OPENSEARCH_CONTAINER_NAME):/usr/share/opensearch/data \
		$(OPENSEARCH_IMAGE)
	@echo "[info] started docker container [$(OPENSEARCH_CONTAINER_NAME)]..."
	@echo "[info] waiting for TCP connectivity to [$(OPENSEARCH_CONTAINER_NAME)]..."
	@$(DOCKER) run --rm  --net=host $(WAIT4X_IMAGE) tcp $(OPENSEARCH_HOST):$(OPENSEARCH_PORT)
	sleep 10

#######################
# FTS Engine - SQLite #
#######################

engine-start-sqlite-disk: .data check-dep-sqlite
	@if [ ! -f "$(SQLITE_DISK_DB_PATH)" ] ; then \
		touch $(SQLITE_DISK_DB_PATH); \
		$(SQLITE) $(SQLITE_DISK_DB_PATH) ".databases"; \
	fi;
	@echo "[info] using SQLite DB @ [$(SQLITE_DISK_DB_PATH)]..."

engine-start-sqlite-disk-mem: .data check-dep-sqlite
	@echo "[info] using SQLite DB @ [$(SQLITE_DISK_DB_PATH)]..."

######################
# FTS Engines - Stop #
######################

## Stop the FTS engine of choice
engine-stop: check-dep-docker
ifeq ("pg","$(FTS_ENGINE)")
	@$(MAKE) --quiet --no-print-directory engine-stop-pg
else ifeq ("meilisearch","$(FTS_ENGINE)")
	@$(MAKE) --quiet --no-print-directory engine-stop-meilisearch
else ifeq ("typesense","$(FTS_ENGINE)")
	@$(MAKE) --quiet --no-print-directory engine-stop-typesense
else ifeq ("opensearch","$(FTS_ENGINE)")
	@$(MAKE) --quiet --no-print-directory engine-stop-opensearch
else ifeq ("sqlite-disk","$(FTS_ENGINE)")
	@$(MAKE) --quiet --no-print-directory engine-stop-sqlite-disk
else ifeq ("sqlite-mem","$(FTS_ENGINE)")
	@$(MAKE) --quiet --no-print-directory engine-stop-sqlite-mem
else
	$(error "failed to stop unrecognized FTS engine [$(FTS_ENGINE)]")
endif

engine-stop-pg:
	@$(DOCKER) stop $(PG_CONTAINER_NAME) || true
	@$(DOCKER) rm $(PG_CONTAINER_NAME) || true

engine-stop-meilisearch:
	@$(DOCKER) stop $(MEILI_CONTAINER_NAME) || true
	@$(DOCKER) rm $(MEILI_CONTAINER_NAME) || true

engine-stop-typesense:
	@$(DOCKER) stop $(TYPESENSE_CONTAINER_NAME) || true
	@$(DOCKER) rm $(TYPESENSE_CONTAINER_NAME) || true

opensearch-volume-delete:
	@$(DOCKER) volume rm $(OPENSEARCH_CONTAINER_NAME) || true

engine-stop-opensearch:
	@$(DOCKER) stop $(OPENSEARCH_CONTAINER_NAME) || true
	@$(DOCKER) rm $(OPENSEARCH_CONTAINER_NAME) || true
	@if [ -n "$DELETE_DATA" ]; then \
		 $(MAKE) --quiet --no-print-directory opensearch-volume-delete; \
	fi

engine-stop-sqlite-disk:
	@echo "[info] Plesae delete SQLite @ [$(SQLITE_DISK_DB_PATH)] manually"

engine-stop-sqlite-mem:
	@echo "[info] SQLite DB stop is a no-op"
