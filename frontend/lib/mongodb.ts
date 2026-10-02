import { MongoClient } from "mongodb";

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient>;

function createClientPromise(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Please add your MONGODB_URI to .env.local");
  }

  const client = new MongoClient(uri, {});
  return client.connect();
}

if (process.env.NODE_ENV === "development") {
  // In development, reuse the global promise across hot-reloads to avoid
  // exhausting MongoDB connection limits.
  if (!global._mongoClientPromise) {
    global._mongoClientPromise = createClientPromise();
  }
  clientPromise = global._mongoClientPromise;
} else {
  // In production, always create a fresh promise per module instantiation.
  // The guard fires only when this branch is reached at runtime, not at
  // build time (the API route is force-dynamic).
  clientPromise = createClientPromise();
}

/**
 * The database name must be explicit. `client.db()` with no argument falls back
 * to whatever database is embedded in the connection string — which on Atlas is
 * often "test" — so writes silently land in the wrong place.
 */
export function databaseName(): string {
  return process.env.MONGODB_DB ?? "sudarshan";
}

export const COLLECTIONS = {
  preRegistrations: "pre_registrations",
} as const;

/**
 * Indexes are schema, not per-request work. Ensuring them on every POST paid a
 * round trip per signup and raced itself under load; ensure them once per
 * process and treat failure as fatal-at-startup rather than silent.
 */
let indexesEnsured: Promise<void> | undefined;

export function ensureIndexes(): Promise<void> {
  indexesEnsured ??= (async () => {
    const client = await clientPromise;
    const collection = client.db(databaseName()).collection(COLLECTIONS.preRegistrations);
    await collection.createIndex({ email: 1 }, { unique: true, name: "uniq_email" });
    await collection.createIndex({ created_at: -1 }, { name: "created_at_desc" });
  })();
  return indexesEnsured;
}

export default clientPromise;
