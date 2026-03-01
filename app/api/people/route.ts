import { NextResponse } from "next/server";

export const revalidate = 30;

export async function GET() {
  const key = process.env.GOOGLE_SHEETS_API_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const range = process.env.GOOGLE_SHEET_RANGE;

  if (!key || !sheetId || !range) {
    return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
  }

  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(
      range
    )}?key=${key}`;

  const res = await fetch(url, { next: { revalidate: 30 } });
  const text = await res.text();

  if (!res.ok) {
    return NextResponse.json(
      { error: "Fetch sheet failed", status: res.status, details: text },
      { status: 500 }
    );
  }

  const data = JSON.parse(text);
  const values: string[][] = data.values || [];
  if (values.length < 2) return NextResponse.json({ people: [] });

  const headers = values[0].map((h) => (h ?? "").toString().trim());
  const rows = values.slice(1);

  const people = rows
    .filter((r) => r.some((c) => (c ?? "").toString().trim() !== ""))
    .map((r) => {
      const obj: any = {};
      headers.forEach((h, i) => (obj[h] = (r[i] ?? "").toString().trim()));

      obj.spouseIds = (obj.spouseIds || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);

      return obj;
    });

  return NextResponse.json({ people });
}