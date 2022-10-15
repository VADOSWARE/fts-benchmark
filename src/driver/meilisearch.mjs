/* global process */
import { waitFor, TimeoutError } from "async-wait-for-promise";
import { MeiliSearch } from "meilisearch";

const INDEX_NAME = "movies";
const LARGE_LIMIT = 100_000;

async function connectMeilisearch() {
  // Create MeiliSearch Host
  if (!process.env.MEILI_URL) {
    throw new Error(`[error] Missing/invalid MeiliSearch URL [${process.env.MEILI_URL}] (did you specify MEILI_URL?)`);
  }
  const url = process.env.MEILI_URL;

  // Create MeiliSearch API Key
  if (!process.env.MEILI_API_KEY) {
    throw new Error(`[error] Missing/invalid MeiliSearch URL [${process.env.MEILI_API_KEY}] (did you specify MEILI_API_KEY?)`);
  }
  const apiKey = process.env.MEILI_API_KEY;

  // Create MeiliSearch client
  const client = new MeiliSearch({ host: url, apiKey });

  if (process.env.FTS_ENGINE_RESET_AT_INIT) {
    let deleteIndexResult = await client.index.deleteIndex();
    // Wait for task to complete
    await waitFor(
      async () => {
        const taskNow = await client.getTask(deleteIndexResult.taskUid);
        if (taskNow.status !== "succeeded") { return null; }
        return true;
      },
      { timeoutMs: 5 * 1000 },
    );
  }

  // Create the index
  const indexCreateResult = await client.createIndex(INDEX_NAME, { primaryKey: 'id' });
  try {
    // Wait for task to complete
    await waitFor(
      async () => {
        const taskNow = await client.getTask(indexCreateResult.taskUid);

        if (taskNow.status === "failed" && taskNow.error.code === "index_already_exists") {
          return true;
        }

        if (taskNow.status === "succeeded") { return true; }

        return null;
      },
      { timeoutMs: 6000 * 1000 },
    );
  } catch (err) {
    process.stderr.write(`[error] failed to create index \n`);
    throw err;
  }

  const index = client.index(INDEX_NAME);

  return {
    client,
    index,
  };
}

let CURRENT_BATCH = [];
const BATCH_SIZE = 10_000;

export async function build() {
  const { client, index } = await connectMeilisearch();

  // Build a functoin for sending batches
  const sendBatch = async (batch) => {
    if (process.env.DEBUG) {
      process.stderr.write(`[debug] sending batch ([${BATCH_SIZE}] documents)\n`);
    }

    const updateDocumentsResult = await index.updateDocuments(batch);

    // Wait for meilisearch task to complete
    await waitFor(
      async () => {
        const taskNow = await client.getTask(updateDocumentsResult.taskUid);
        if (taskNow.status === "succeeded") { return true; }
        return null;
      },
      { timeoutMs: 60 * 1000, intervalMs: 10, },
    );
  };

  return {
    // Ingesting search documents
    async ingest({ document }) {
      if (CURRENT_BATCH.length < BATCH_SIZE) {
        CURRENT_BATCH.push({
          id: document.id,
          title: document.title,
          overview: document.overview,
          original_title: document.original_title,
        });
        return;
      }

      await sendBatch(CURRENT_BATCH);

      CURRENT_BATCH = [];
    },

    // Querying search phrases
    async query({ phrase }) {

      const results = await index.search(phrase, { limit: LARGE_LIMIT });

      // Gather IDs of hits
      const ids = results.hits.map(r => r.id);
      if (process.env.DEBUG) {
        process.stderr.write(`[debug] Search for [${phrase}] returned [${ids.length}] ids\n`);
      }

      return { ids };
    },

    /// Final ingest wait
    async ingestWait() {
      // Send final batch
      await sendBatch(CURRENT_BATCH);
    },
  };
}
