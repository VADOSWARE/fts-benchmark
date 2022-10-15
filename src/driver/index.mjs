/* global process */
import * as readline from "node:readline/promises";
import * as fs from "node:fs";

async function executeIngest({ driver, inputPath }) {
  let processed = 0;

  if (!inputPath) { throw new Error(`Missing/invalid [${inputPath}]`); }

  const lines = readline.createInterface({
    input: fs.createReadStream(inputPath),
    crlfDelay: Infinity,
  });

  let before;
  let elapsed;
  let ids;

  process.stderr.write(`[info] ingesting lines in [${inputPath}]...\n`);
  for await (const line of lines) {
    // Parse incoming line as JSON
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      process.stderr.write(`failed to parse line as JSON: [${line}]\n`);
    }

    await driver.ingest({
      document: obj,
    });
    processed++;
  }

  // For drivers that care when ingestion has completed (for example those that batch updates)
  // Mark ingestion completed, allow driver to perform any final operations
  if (driver.ingestWait) { await driver.ingestWait(); }

  if (process.env.DEBUG) {
    process.stderr.write(`[info] successfully processed [${processed}] lines\n`);
  }
}

async function executeQuery({ driver, inputPath }) {
  let processed = 0;
  const lines = readline.createInterface({
    input: fs.createReadStream(inputPath),
    crlfDelay: Infinity,
  });

  let before;
  let elapsed;
  let ids;

  process.stderr.write(`[info] ingesting and running search phrases in [${inputPath}]...\n`);
  for await (const line of lines) {
    // Parse incoming line as JSON
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      process.stderr.write(`failed to parse line as JSON: [${line}]\n`);
    }

    if (process.env.TIMING) { before = process.hrtime(); }

    const { ids } = await driver.query({ phrase: obj });

    if (process.env.TIMING) {
      elapsed = process.hrtime(before)[1] / 1_000_000;
      if (process.env.TIMING_FORMAT === "md-table") {
        process.stderr.write(`| \`${process.env.FTS_ENGINE}\` | "${obj}" | \`${ids.length}\` | \`${elapsed.toPrecision(3)}\` | \`${(elapsed / ids.length * 1.0).toPrecision(3)}\` |\n`);
      } else {
        process.stderr.write(`[timing] phrase ["${obj}"]: returned [${ids.length}] results in ${elapsed}.ms\n`);
      }
    }

    processed++;
  }

  if (process.env.DEBUG && processed % 1000 === 0) {
    process.stderr.write(`[info] successfully queried [${processed}] lines\n`);
  }

  if (!process.env.TIMING) {
    process.stderr.write(`[info] set TIMING=true to see timing data for each query!\n`);
  }

  process.stderr.write(`[info] finished running search queries\n`);
}

// Ingest ndjson into a given search engine driver
export async function execute({ op, driver, ingestInputPath, queryInputPath }) {
  // Handle the intended operation
  switch (op) {
    // Ingestion
  case "ingest":
    await executeIngest({ driver, inputPath: ingestInputPath });
    break;

    // Querying
  case "query":
    await executeQuery({ driver, inputPath: queryInputPath });
    break;

    // Ingestion
  case "ingest+query":
    await executeIngest({ driver, inputPath: ingestInputPath });
    await executeQuery({ driver, inputPath: queryInputPath });
    break;

    // Unknown operation
  default:
    throw new Error(`Missing/invalid operation [${op}]`);
  }
}

// Initialize the driver set by FTS_ENGINE
async function createDriver({ engine }) {
  const driverJSPath = `./${engine}.mjs`;
  console.log(`[info] importing driver from [${driverJSPath}]`);

  const driver = await import(driverJSPath);
  if (!driver.build || typeof driver.build !== "function") { throw new Error(`Invalid driver @ [${driverJSPath}], should expose a 'build' function`); }

  const result = driver.build();
  if (!(result instanceof Promise)) { throw new Error(`Invalid driver @ [${driverJSPath}], 'build' function should return a Promise`); }

  return await result;
}

async function main() {
  if (!process.env.FTS_ENGINE) {
    throw new Error(`[error] Invalid/missing FTS engine [${process.env.FTS_ENGINE}] (did you specify FTS_ENGINE ?)`);
  }

  // Set up and initialize driver (an object expected to contain ingest, init and query functions)
  const driver = await createDriver({ engine: process.env.FTS_ENGINE });
  process.stderr.write(`[info] finished initializing driver [${process.env.FTS_ENGINE}]\n`);

  const op = process.env.OP;
  // Process operation
  switch (op) {
  case 'query':
  case 'ingest':
  case 'ingest+query':

    if (op.includes("ingest") && (!process.env.INGEST_INPUT_PATH || !fs.existsSync(process.env.INGEST_INPUT_PATH))) {
      throw new Error(`[error] Invalid/missing input path [${process.env.INGEST_INPUT_PATH}] (did you a valid ndjson file for INGEST_INPUT_PATH?)`);
    }

    if (op.includes("query") && (!process.env.QUERY_INPUT_PATH || !fs.existsSync(process.env.QUERY_INPUT_PATH))) {
      throw new Error(`[error] Invalid/missing input path [${process.env.QUERY_INPUT_PATH}] (did you a valid ndjson file for QUERY_INPUT_PATH?)`);
    }

    await execute({
      driver,
      op: process.env.OP,
      ingestInputPath: process.env.INGEST_INPUT_PATH,
      queryInputPath: process.env.QUERY_INPUT_PATH,
    });
    break;

  default:
    throw new Error(`[error] Invalid operation [${process.env.OP}] (did you specify OP?)`);
  }
}

main();
