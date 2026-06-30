// Drizzle client over Neon's serverless HTTP driver. One-shot queries only.
//
// neon-http is fetch-based and lazy: constructing the client does NOT open a
// connection, so we can build it at import time (the Auth.js Drizzle adapter
// needs a real client to detect the Postgres dialect). A missing DATABASE_URL
// only fails when a query actually runs.
import "server-only";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn(
    "DATABASE_URL is not set — database queries will fail. See .env.local and the README.",
  );
}

// Placeholder keeps neon()'s URL parser happy at build/import; real queries need
// a real DATABASE_URL set in the environment.
const sql = neon(connectionString ?? "postgresql://user:pass@localhost/placeholder");
export const db = drizzle(sql, { schema });
export { schema };
