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

export default clientPromise;
