import FamilyMap from "../components/FamilyMap";
import { headers } from "next/headers";

export default async function Page() {
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const baseUrl = `${proto}://${host}`;

  const res = await fetch(`${baseUrl}/api/people`, { cache: "no-store" });
  const data = await res.json().catch(() => ({} as any));
  const people = Array.isArray(data.people) ? data.people : [];

  return (
    <main style={{ padding: 14, fontFamily: "system-ui" }}>
      {/* ... */}
      <FamilyMap people={people} />
    </main>
  );
}