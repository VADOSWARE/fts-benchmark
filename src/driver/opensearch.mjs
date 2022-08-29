/* global process */
import { waitFor, TimeoutError } from "async-wait-for-promise";
import { Client } from "@opensearch-project/opensearch";

const INDEX_NAME = "movies";
const INDEX_SETTINGS = {
  settings: {
    index: {
      number_of_shards: 1,
      number_of_replicas: 1,
    }
  }
};

async function connectOpenSearch() {
  // Create OpenSearch Host
  if (!process.env.OPENSEARCH_HOST) {
    throw new Error(`[error] Missing/invalid OpenSearch host [${process.env.OPENSEARCH_HOST}] (did you specify OPENSEARCH_HOST?)`);
  }
  const host = process.env.OPENSEARCH_HOST;

  // Create OpenSearch Protocol
  const protocol = process.env.OPENSEARCH_PROTOCOL ?? "https";

  // Create OpenSearch Port
  if (!process.env.OPENSEARCH_PORT) {
    throw new Error(`[error] Missing/invalid OpenSearch port [${process.env.OPENSEARCH_PORT}] (did you specify OPENSEARCH_PORT?)`);
  }
  const port = process.env.OPENSEARCH_PORT;

  if (!process.env.OPENSEARCH_AUTH_USERNAME) {
    throw new Error(`[error] Missing/invalid OpenSearch auth username [${process.env.OPENSEARCH_AUTH_USERNAME}] (did you specify OPENSEARCH_AUTH_USERNAME?)`);
  }
  const username = process.env.OPENSEARCH_AUTH_USERNAME;

  if (!process.env.OPENSEARCH_AUTH_PASSWORD) {
    throw new Error(`[error] Missing/invalid OpenSearch auth password [${process.env.OPENSEARCH_AUTH_PASSWORD}] (did you specify OPENSEARCH_AUTH_PASSWORD?)`);
  }
  const password = process.env.OPENSEARCH_AUTH_PASSWORD;

  const node = `${protocol}://${username}:${password}@${host}:${port}`;
  if (process.env.DEBUG) {
    process.stderr.write(`[info] connecting to node [${node}]\n`);
  }

  // Create OpenSearch client
  const client = new Client({
    node,
    ssl: { rejectUnauthorized: false },
  });

  if (process.env.FTS_ENGINE_RESET_AT_INIT) {
    await client.indices.delete({
      index: INDEX_NAME,
    });
  }

  // Create the index
  try {
    await client.indices.create({
      index: INDEX_NAME,
      body: INDEX_SETTINGS,
    });
  } catch (err) {
    if (err.meta && err.meta.body && err.meta.body.error && err.meta.body.error.root_cause.some(c => c.type === "resource_already_exists_exception")) {
      if (process.env.DEBUG) {
        process.stderr.write(`[debug] skipping creating index [${INDEX_NAME}], it already exists`);
      }
    } else {
      process.stderr.write(`[error] failed to create [${INDEX_NAME}]`);
      throw err;
    }
  }

  return { client };
}

let CURRENT_BATCH = [];
const BATCH_SIZE = 10_000;

export async function build() {
  const { client, index } = await connectOpenSearch();

  // Build a functoin for sending batches
  const sendBatch = async (batch) => {
    if (process.env.DEBUG) {
      process.stderr.write(`[debug] sending batch ([${BATCH_SIZE}] documents)\n`);
    }

    const result = await client.bulk({
      body: CURRENT_BATCH,
    });

    const failed = Math.min(0, CURRENT_BATCH.length - result.body.items.length);

    if (failed > 0) {
      process.stderr.write(`[error] failed to insert all items into batch (${failed} failed)\n`);
    }

    process.stderr.write(`[error] successfully wrote batch of [${CURRENT_BATCH.length - failed}] documents to ES\n`);
  };

  return {
    // Ingesting search documents
    async ingest({ document }) {
      if (CURRENT_BATCH.length < BATCH_SIZE * 2) {
        CURRENT_BATCH.push({
            index: {
              _index: INDEX_NAME,
              _id: document.id,
            },
        });
        CURRENT_BATCH.push({
            title: document.title,
            original_title: document.original_title,
            overview: document.overview,
        });
        return;
      }

      await sendBatch(CURRENT_BATCH);

      CURRENT_BATCH = [];
    },

    // Querying search phrases
    async query({ phrase }) {

      // Get first page of results
      const resp = await client.search({
        index: INDEX_NAME,
        body: {
          size: 10_000, // max
          query: {
            multi_match: {
              query: phrase,
              fields: [ "title", "original_title", "overview" ],
            },
          },
        },
      });

      // Gather IDs of hits
      const ids = resp.body.hits.hits.map(r => r.id);
      if (process.env.DEBUG && !process.env.TIMING_FORMAT) {
        process.stderr.write(`[debug] Search for [${phrase}] returned [${ids.length}] ids\n`);
      }

      return { ids };
    },

    /// Final ingest wait
    async ingestWait() {
      if (CURRENT_BATCH.length === 0) { return; }
      // Send final batch
      await sendBatch(CURRENT_BATCH);
    },
  };
}
