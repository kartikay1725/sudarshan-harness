import { NextResponse } from "next/server";
import clientPromise from "@/lib/mongodb";

// Force this route to always be server-rendered; never statically collected
// during `next build` (which would fail without a live MONGODB_URI).
export const dynamic = "force-dynamic";

// Simple in-memory rate limiter (per IP, 10 requests per 5 minutes)
const ipRequestCounts = new Map<string, { count: number; expiresAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipRequestCounts.get(ip);
  if (!entry || entry.expiresAt < now) {
    ipRequestCounts.set(ip, { count: 1, expiresAt: now + 5 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 10) {
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
    const db = client.db();
    const collection = db.collection("pre_registrations");

    // Ensure unique index on email
    await collection.createIndex({ email: 1 }, { unique: true });

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
  } catch (error: any) {
    if (error?.code === 11000) {
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
