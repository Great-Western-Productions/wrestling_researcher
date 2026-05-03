// Schema bootstrapped via `pnpm db:pull` against the existing
// wrestling_bibliography Postgres. Single tables.ts file for now; will split
// per entity if it grows unwieldy.
//
// Important: column names and types match what the Python ingest scripts
// expect. Do not rename columns or change types here without coordinating
// with bibliography/, calendar/, covers/, magazine_downloader/.

export * from "./relations";
export * from "./tables";
