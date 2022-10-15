# Postgres Full Text Search ("FTS") benchmark

This is a benchmark of Postgres FTS versus other solutions:

- [SQLite FTS][sqlite-fts]
- [MeiliSearch][meilisearch]
- [Typesense][typesense]
- [OpenSearch][opensearch]

[sqlite-fts]: https://www.sqlite.org/fts5.html
[meilisearch]: https://www.meilisearch.com
[typesense]: https://typesense.org
[opensearch]: https://opensearch.org/

## Prerequisites

To run the tests, please ensure you have the following installed on your machine:

- `gunzip` (part of the [`gzip` software distribution][gzip])
- [Docker][docker]
- [NodeJS][nodejs] (`node` and `npm`)
- [`pnpm`][pnpm] (i.e. `npm install -g pnpm`)
- [`sqlite`][sqlite]

[gzip]: https://www.gnu.org/software/gzip/
[docker]: https://docs.docker.com
[nodejs]: https://nodejs.org
[sqlite]: https://sqlite.org
[pnpm]: https://pnpm.io

## Quickstart

To set up testing data and **run the full benchmark with *all* FTS engines**:

```console
make # equivalent to `make setup run-all`
```

To run only a single benchmark (in this case, with Postgres FTS):

```console
FTS_ENGINE=pg make setup run
```
(`FTS_ENGINE = 'pg' | 'meilisearch' | 'typesense' | 'opensearch' | 'sqlite-mem' | 'sqlite-disk'`)

To only install dependencies:

```console
make setup
```

## Dataset

The benchmark in this repository uses the a public domain movie dataset:

- [On Kaggle](https://www.kaggle.com/datasets/rounakbanik/the-movies-dataset?select=movies_metadata.csv)
- [On HuggingFace](https://huggingface.co/spaces/Kamand/Movie_Recommendation/blob/main/movies_metadata.csv), in particular the following columns:

- `homepage`
- `title`
- `original_title`
- `overview`
- `production_companies`
- `spoken_languages`
- `tagline`

Data is processed from CSV into [newline delimited JSON][ndjson] (see `movies.ndjson.json.gz`).

[ndjson]: http://ndjson.org

## How the benchmark works

### Environment variables

| ENV Variable                  | Default                          | Example                               | Description                                             |
|-------------------------------|----------------------------------|---------------------------------------|---------------------------------------------------------|
| `FTS_ENGINE`                  | N/A                              | `pg`                                  | The FTS engine to use                                   |
| `DEBUG`                       | N/A                              | `true`                                | Enable debug mode                                       |
| `TIMING`                      | N/A                              | `true`                                | Enable timing information display                       |
| `DATA_MOVIES_CSV_ZIPPED_PATH` | `./movies.csv.gz`                | `/path/to/movies.csv.gz`              | Path to the movie data set                              |
| `DATA_MOVIES_CSV_PATH`        | `./movies.csv`                   | `/path/to/movies.csv`                 | Path to the movie data set, uncompressed                |
| `DATA_MOVIES_NDJSON_PATH`     | `./movies.ndjson.json`           | `/path/to/movies.ndjson.json`         | Path to the newline delimited JSON data for movies      |
| `SEARCH_PHRASES_NDJSON_PATH`  | `./search-phrases.ndjson.json`   | `/path/to/search-phrases.ndjson.json` | Path to search phrases to use as newline delimited JSON |

Some variables are used per-run and are normally set by more ergonomic top-level `Makefile` targets:

| ENV Variable               | Default                                                               | Example                    | Description                                                   |
|----------------------------|-----------------------------------------------------------------------|----------------------------|---------------------------------------------------------------|
| `INPUT_CSV_PATH`           | `$(DATA_MOVIES_CSV_ZIPPED_PATH)`                                      | `/path/to/movies2.csv.gz`  | Path to compressed CSV (normally unzipped by Makefile target) |
| `OP`                       | N/A                                                                   | `ingest`                   | Operation to perform                                          |
| `SQLITE_DISK_DB_PATH`      | `./fts-sqlite-disk-db.sqlite`                                         | `:memory:`                 | SQLite DB path                                                |
| `PG_URL`                   | `postgres://$(PG_USER):$(PG_PASSWORD)@$(PG_HOST):$(PG_PORT)/$(PG_DB)` | `postgres://localhost`     | Postgres DB path                                              |
| `TYPESENSE_HOST`           | `localhost`                                                           | `typesense.domain.tld`     | Hostname for Typesense server                                 |
| `TYPESENSE_PORT`           | `8108`                                                                | `8109`                     | Port for Typesense server                                     |
| `TYPESENSE_API_KEY`        | `badtypesenseapikey`                                                  | `tttttttttttttttt`         | API key for Typesense server                                  |
| `MEILI_HOST`               | `localhost`                                                           | `meili.domain.tld`         | Hostname for MeiliSearch server                               |
| `MEILI_PORT`               | `7700`                                                                | `7701`                     | Port for MeiliSearch                                          |
| `MEILI_URL`                | `http://$(MEILI_HOST):$(MEILI_PORT)`                                  | `https://meili.domain.tld` | Full URL to use when accessing Meilisearch                    |
| `MEILI_API_KEY`            | `$(MEILI_MASTER_KEY)`                                                 | `xxxxxxxxxxxxxxxxxxx`      | MeiliSearch API key                                           |
| `OPENSEARCH_PROTOCOL`      | `http`                                                                | `https`                    | Protocol to use when accessing OpenSearch service             |
| `OPENSEARCH_HOST`          | `localhost`                                                           | `opensearch.domain.tld`    | Host for OpenSearch server                                    |
| `OPENSEARCH_PORT`          | `9200`                                                                | `9201`                     | Port for OpenSearch server                                    |
| `OPENSEARCH_AUTH_USERNAME` | `admin`                                                               | `admin`                    | Admin username for OpenSearch server                          |
| `OPENSEARCH_AUTH_PASSWORD` | `admin`                                                               | `hunter2`                  | Admin password for OpenSearch server                          |

See `Makefile` for the code and other variables that might be excluded here.

### Running a single benchmark

A single benchmark can be run with the following command:

```console
FTS_ENGINE=<engine> make setup run
```

Options for `FTS_ENGINE`:

- `pg`
- `meilisearch`
- `typesense`
- `sqlite`.

To run the ingest & query tests with Postgres:

```console
TIMING=true FTS_ENGINE=pg make run
```

If an error occurs during set up, consider tearing down the existing `FTS_ENGINE`:

```console
FTS_ENGINE=pg make engine-stop
```

### Setup/Teardown of a single backing service

To control the setup/teardown of a single backing service, use the `engine-start` and `engine-stop` top level targets.

For example, if you wanted to start MeiliSearch and poke around on the instance:

```console
FTS_ENGINE=meilisearch make engine-start
```

After this command returns, you should have an instance of meilisearch running with a stable name (`fts-$(FTS_ENGINE)`):

```
$ docker ps
CONTAINER ID   IMAGE                          COMMAND                  CREATED         STATUS         PORTS                                            NAMES
4d7c0efdf5cf   getmeili/meilisearch:v0.28.1   "tini -- /bin/meilis…"   7 seconds ago   Up 6 seconds   127.0.0.1:7700->7700/tcp                         fts-meili
```

To stop the service:

```console
FTS_ENGINE=meilisearch make engine-stop
```

### Ingesting documents

Ingesting data into each separate solution is different, and code to do each can be found under `src/driver/<engine>.js`. For example, the `src/driver/pg.mjs` contains the code to enable document ingestion to Postgres.

### Performing queries

Queries to be performed in the test are specified via YAML and stored in `search-phrases.ndjson.json`.

This file is read by the automation and related scripts.

### Clearing data

To clear all the data inbetween runs:

```console
sudo make clean # sudo is likely needed to clear docker container data folders
```
