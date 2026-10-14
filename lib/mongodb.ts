import { MongoClient } from "mongodb";
import { createLogger } from "@/lib/logger";

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

const log = createLogger("lib/mongodb");

let clientPromise: Promise<MongoClient> | undefined;
let warnedAboutDemoMode = false;

export async function getDatabase() {
  // Read at call time, so demo mode (no MONGODB_URI) is decided per request.
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    // Without a database, accounts cannot sign in — only guest room joins work.
    // Say so once instead of leaving people to wonder why sign-in 503s.
    if (!warnedAboutDemoMode) {
      warnedAboutDemoMode = true;
      log.warn("MONGODB_URI is not set — sign-in is disabled; only guest room links work");
    }
    return null;
  }
  const dbName = process.env.MONGODB_DB || "converge";

  try {
    if (!clientPromise) {
      const client = new MongoClient(uri);
      clientPromise = global._mongoClientPromise ?? client.connect();
      if (process.env.NODE_ENV !== "production") global._mongoClientPromise = clientPromise;
    }
    const client = await clientPromise;
    return client.db(dbName);
  } catch (error) {
    // Let a later request retry instead of caching the failed connection forever.
    clientPromise = undefined;
    if (process.env.NODE_ENV !== "production") global._mongoClientPromise = undefined;
    log.error("mongodb connection failed", { error, db: dbName });
    throw error;
  }
}
