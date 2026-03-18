import { NextResponse } from "next/server";
import { getIssueErrorSnapshot, getIssueSnapshot } from "@/lib/issues";

export async function GET() {
  try {
    return NextResponse.json(await getIssueSnapshot());
  } catch (error) {
    return NextResponse.json(getIssueErrorSnapshot(error));
  }
}
