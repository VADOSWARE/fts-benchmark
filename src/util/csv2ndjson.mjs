/* global process */

import { default as Papa } from "papaparse";
import { createReadStream, createWriteStream, existsSync } from "node:fs";

export async function convert({
  inputPath,
  outputPath,
}) {

  // Quick (leaky) check that files exist
  if (!inputPath || !existsSync(inputPath)) {
    throw new Error(`Invalid or missing input path [${inputPath}] (did you specify INPUT_CSV_PATH ?)`);
  }

  if (!outputPath) {
    throw new Error(`Invalid output path [${outputPath}] (did you specify OUTPUT_NDJSON_PATH ?)`);
  }

  // Open the output file
  const outputStream = createWriteStream(outputPath);

  // Parse the file
  await new Promise((resolve, reject) => {
    Papa.parse(
      createReadStream(inputPath),
      {
        header: true,
        delimeter: ",",
        skipEmptyLines: true,
        error: reject,
        complete: () => resolve(),
        chunk: (results) => {
          for (const row of results.data) {
            try {
              const record = {
                ...row,
                production_companies: JSON.parse(row.production_companies.replaceAll("'",'"')),
                production_countries: JSON.parse(row.production_countries.replaceAll("'",'"')),
                genres: JSON.parse(row.genres.replaceAll("'",'"')),
                spoken_languages: JSON.parse(row.spoken_languages.replaceAll("'",'"')),
              };
              outputStream.write(`${JSON.stringify(record)}\n`);
            } catch (err) {
              process.stderr.write(`[warn] failed to write row with ID [${row.id}]: [${row.title}]\n`);
            }
          }
        },
      },
    );
  });
}

// Conver the input to the output
convert({
  inputPath: process.env.INPUT_CSV_PATH,
  outputPath: process.env.OUTPUT_NDJSON_PATH,
});
