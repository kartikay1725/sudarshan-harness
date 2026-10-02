import { NextResponse } from "next/server";
import clientPromise, { COLLECTIONS, databaseName, ensureIndexes } from "@/lib/mongodb";

// Force this route to always be server-rendered; never statically collected
// during `next build` (which would fail without a live MONGODB_URI).
export const dynamic = "force-dynamic";

/**
 * Best-effort, per-instance rate limiter.
 *
 * HONEST LIMITATION: serverless functions do not share memory, so on Vercel this
 * only throttles repeat hits that land on the *same* instance. It is a courtesy
 * brake, not a security boundary. Real abuse protection for this endpoint must
 * live in front of the function (Vercel WAF / Upstash Rate Limit / a bot
 * challenge). Do not mistake this Map for that.
 *
 * The Map is capped and pruned so a flood of distinct IPs cannot grow it
 * without bound.
 */
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_PER_IP_MAX ?? 10);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 5 * 60 * 1000);
const RATE_LIMIT_MAP_CAP = 10_000;

const ipRequestCounts = new Map<string, { count: number; expiresAt: number }>();
let lastPrune = 0;

function checkRateLimit(ip: string): boolean {
  if (!Number.isFinite(RATE_LIMIT_MAX) || RATE_LIMIT_MAX <= 0) return true; // disabled
  const now = Date.now();

  if (now - lastPrune > RATE_LIMIT_WINDOW_MS) {
    lastPrune = now;
    for (const [key, entry] of ipRequestCounts) {
      if (entry.expiresAt < now) ipRequestCounts.delete(key);
    }
    if (ipRequestCounts.size > RATE_LIMIT_MAP_CAP) {
      // Drop the oldest half rather than reject legitimate traffic.
      const drop = Math.floor(ipRequestCounts.size / 2);
      let removed = 0;
      for (const key of ipRequestCounts.keys()) {
        if (removed >= drop) break;
        ipRequestCounts.delete(key);
        removed++;
      }
    }
  }

  const entry = ipRequestCounts.get(ip);
  if (!entry || entry.expiresAt < now) {
    ipRequestCounts.set(ip, { count: 1, expiresAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }
  entry.count++;
  return true;
}

export async function POST(request: Request) {
  try {
    const forwardedFor = request.headers.get("x-forwarded-for");
    const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : "127.0.0.1";

    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { name, email } = body;

    // Validate Name
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Name is required." },
        { status: 400 }
      );
    }
    if (name.trim().length > 100) {
      return NextResponse.json(
        { error: "Name must not exceed 100 characters." },
        { status: 400 }
      );
    }

    // Validate Email
    if (!email || typeof email !== "string" || email.trim().length === 0) {
      return NextResponse.json(
        { error: "Work email is required." },
        { status: 400 }
      );
    }
    const normalizedEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail) || normalizedEmail.length > 254) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 }
      );
    }

    const client = await clientPromise;
    const collection = client.db(databaseName()).collection(COLLECTIONS.preRegistrations);

    // Indexes are ensured once per process, not once per request.
    await ensureIndexes();

    // Check if already registered
    const existing = await collection.findOne({ email: normalizedEmail });
    if (existing) {
      return NextResponse.json(
        {
          success: true,
          status: "existing",
          message: "You're already on the list."
        },
        { status: 200 }
      );
    }

    const now = new Date();
    await collection.insertOne({
      name: name.trim(),
      email: normalizedEmail,
      product: "sudarshan-ai",
      source: "landing-page",
      status: "pending",
      created_at: now,
      updated_at: now,
    });

    return NextResponse.json(
      {
        success: true,
        status: "created",
        message: "You're on the list. We'll reach out as early access opens."
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    // Duplicate key: someone raced us to the same email. Idempotent success.
    if ((error as { code?: number })?.code === 11000) {
      return NextResponse.json(
        {
          success: true,
          status: "existing",
          message: "You're already on the list."
        },
        { status: 200 }
      );
    }

    console.error("Early access registration error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
