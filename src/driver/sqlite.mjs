/* global process */
import Database from "better-sqlite3";

const DEFAULT_BATCH_SIZE = 10_000;

async function connect({ dbPath, batchSize, currentBatch }) {
  dbPath = dbPath ?? process.env.SQLITE_DISK_DB_PATH;

  if (!dbPath) {
    throw new Error(`[error] Missing/invalid SQLite DB path [${dbPath}] (did you specify SQLITE_DISK_DB_PATH?)`);
  }

  process.stderr.write(`[info] using SQLite DB @ [${dbPath}]\n`);
  const db = new Database(dbPath, { fileMustExist: true });

  // Set up the initial table
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS movies_fts USING fts5(title, original_title, overview);`);

  if (process.env.FTS_ENGINE_RESET_AT_INIT) {
    await db.run(`TRUNCATE TABLE movies`);
  }

  const insert = await db.prepare(`
INSERT INTO movies_fts
  (rowid, title,original_title,overview)
VALUES
  (@id, @title, @original_title, @overview)
`);
  const search = await db.prepare("SELECT rowid as id,* FROM movies_fts WHERE title MATCH @phrase OR original_title MATCH @phrase OR overview MATCH @phrase");

  return {
    batchSize,
    db,
    currentBatch: currentBatch || [],
    statements: {
      insert,
      search,
    },
  };
}

export async function build(args) {
  const { db, statements, batchSize, currentBatch } = await connect({
    ...args,
    batchSize: args && args.batchSize ? args.batchSize : DEFAULT_BATCH_SIZE,
    currentBatch: args.currentBatch ?? [],
  });

  if (!batchSize || typeof batchSize !== "number") {
    throw new Error(`Missing/invalid batch size [${batchSize}]`);
  }

  const sendBatch = async (b) => {
    if (process.env.DEBUG) {
      process.stderr.write(`[debug] sending batch ([${batchSize}] documents)\n`);
    }

    const runTransaction = db.transaction((docs) => {
      for (const doc of docs) {
        try {
          statements.insert.run(doc);
        } catch (err) {
          if (err.code !== "SQLITE_CONSTRAINT_PRIMARYKEY") { throw err; }
        }
      }
    });

    await runTransaction(b);
  };

  return {

    // Ingesting search documents
    async ingest({ document }) {
      if (currentBatch.length < batchSize) {
        currentBatch.push({
          id: document.id,
          title: document.title,
          original_title: document.original_title,
          overview: document.overview,
        });
        return;
      }

      await sendBatch(currentBatch);
      currentBatch.splice(0, currentBatch.length);
    },

    // Querying search phrases
    async query({ phrase }) {
      const results = await statements.search.all({ phrase });

      const ids = results.map(r => r.id);
      if (process.env.DEBUG && !process.env.TIMING_FORMAT) {
        process.stderr.write(`[debug] Search for [${phrase}] returned [${ids.length}] ids\n`);
      }

      return { ids };
    },

    /// Final ingest wait
    async ingestWait() {
      if (currentBatch.length === 0) { return; }
      // Send final batch
      await sendBatch(currentBatch);
    },

  };
}
