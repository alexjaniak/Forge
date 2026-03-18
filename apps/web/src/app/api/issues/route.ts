import { NextResponse } from "next/server";
import { getEmptyIssueSnapshot, getIssueSnapshot } from "@/lib/issues";

export async function GET() {
  try {
    return NextResponse.json(await getIssueSnapshot());
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ...getEmptyIssueSnapshot(), error: msg });
  }
}
