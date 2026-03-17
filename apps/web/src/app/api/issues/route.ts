import { NextResponse } from "next/server";
import { getIssueSnapshot } from "@/lib/issues";

export async function GET() {
  try {
    return NextResponse.json(await getIssueSnapshot());
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ issues: [], repo: "", error: msg });
  }
}
