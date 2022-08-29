/* global process */
import { waitFor, TimeoutError } from "async-wait-for-promise";
import { Client } from "typesense";

const COLLECTION_NAME = "movies";
const COLLECTION_SCHEMA = {
  name: COLLECTION_NAME,
  num_documents: 0,
  fields: [
    {
      name: 'title',
      type: 'string',
      facet: false
    },
    {
      name: 'original_title',
      type: 'string',
      facet: false
    },
    {
      name: 'overview',
      type: 'string',
      facet: false
    },
  ],
};

const LARGE_LIMIT = 100_000;

async function connectTypesense() {
  // Create Typesense Host
  if (!process.env.TYPESENSE_HOST) {
    throw new Error(`[error] Missing/invalid Typesense host [${process.env.TYPESENSE_HOST}] (did you specify TYPESENSE_HOST?)`);
  }
  const host = process.env.TYPESENSE_HOST;

  // Create Typesense Port
  if (!process.env.TYPESENSE_PORT) {
    throw new Error(`[error] Missing/invalid Typesense port [${process.env.TYPESENSE_PORT}] (did you specify TYPESENSE_PORT?)`);
  }
  const port = process.env.TYPESENSE_PORT;

  // Create Typesense API Key
  if (!process.env.TYPESENSE_API_KEY) {
    throw new Error(`[error] Missing/invalid Typesense URL [${process.env.TYPESENSE_API_KEY}] (did you specify TYPESENSE_API_KEY?)`);
  }
  const apiKey = process.env.TYPESENSE_API_KEY;

  // Create Typesense client
  const client = new Client({
    nodes: [ { host, port, protocol: 'http' } ],
    apiKey,
    numretries: 3,
    connectionTimeoutSeconds: 300,
    logLevel: process.env.DEBUG ? 'debug' : 'info',
  });

  if (process.env.FTS_ENGINE_RESET_AT_INIT) {
    await client.collections(COLLECTION_NAME).delete();
  }

  // Create the index
  try {
    await client.collections().create(COLLECTION_SCHEMA);
  } catch (err) {
    if (err.name !== "ObjectAlreadyExists") {
      process.stderr.write(`[error] unexpected exception while creating collection \n`);
      throw err;
    }
  }

  return { client };
}

let CURRENT_BATCH = [];
const BATCH_SIZE = 10_000;

export async function build() {
  const { client, index } = await connectTypesense();

  // Build a functoin for sending batches
  const sendBatch = async (batch) => {
    if (process.env.DEBUG) {
      process.stderr.write(`[debug] sending batch ([${BATCH_SIZE}] documents)\n`);
    }

    const results = await client.collections(COLLECTION_NAME).documents().import(batch, { action: 'upsert' });

    const failed = results.filter(item => item.success === false);
    if (failed.length > 0) {
      throw new Error("Failed to ingest!");
    }

  };

  return {
    // Ingesting search documents
    async ingest({ document }) {
      if (CURRENT_BATCH.length < BATCH_SIZE) {
        CURRENT_BATCH.push({
          id: document.id,
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

      let allHits = [];
      let newest;
      let page = 1;

      // Get first page of results
      newest = await client.collections(COLLECTION_NAME).documents().search({
        q: phrase,
        //query_by: "title,original_title,overview",
        query_by: "title",
        page,
        per_page: 250,
      });
      allHits = allHits.concat(newest.hits);

      // Exhaust pagination list
      while (newest.hits.length === 250) {
        page++;

        newest = await client.collections(COLLECTION_NAME).documents().search({
          q: phrase,
          //query_by: "title,original_title,overview",
          query_by: "title",
          per_page: 250,
          page,
        });

        // Add the
        allHits = allHits.concat(newest.hits);
      }

      // Gather IDs of hits
      const ids = allHits.map(r => r.document.id);
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
