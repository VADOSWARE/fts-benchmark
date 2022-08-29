# Postgres FTS benchmark

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
- [NodeJS][nodejs]
- [`sqlite`][sqlite]

[gzip]: https://www.gnu.org/software/gzip/
[docker]: https://docs.docker.com
[nodejs]: https://nodejs.org
[sqlite]: https://sqlite.org

## Quickstart

To set up testing data and run the benchmark:

```console
make
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

## Ingesting documents

Ingesting data into each separate solution is different, and code to do each can be found under `src/driver/<engine>.js`. For example, the `src/driver/pg.mjs` contains the code to enable document ingestion to Postgres.

## Performing queries

Queries to be performed in the test are specified via YAML and stored in `search-phrases.ndjson.json`.

This file is read by the automation and related scripts.

## Running the benchmark

The benchmark can be run with the following command:

```console
FTS_ENGINE=<engine> make setup run
```

`FTS_ENGINE` can be `pg`,`meilisearch`, `typesense`, or `sqlite`.

To run the ingest & query tests with Postgres:

```console
TIMING=true FTS_ENGINE=pg make run
```

If an error occurs during set up, consider tearing down the existing `FTS_ENGINE`:

```console
FTS_ENGINE=pg make engine-stop
```

### Clearing data

To clear all the data inbetween runs:

```console
sudo make clean # sudo is likely needed to clear docker container data folders
```
