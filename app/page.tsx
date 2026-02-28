import FamilyMap from "../components/FamilyMap";

export default async function Page() {
  const res = await fetch("http://localhost:3000/api/people", { cache: "no-store" });
  const data = await res.json().catch(() => ({} as any));
  const people = Array.isArray(data.people) ? data.people : [];

  return (
    <main style={{ padding: 14, fontFamily: "system-ui" }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 22, fontWeight: 950 }}>Gia phả</div>
        <div style={{ opacity: 0.75 }}>
          {data.error ? `API lỗi: ${data.error}` : `Đã tải: ${people.length} người`}
        </div>
      </div>
      <FamilyMap people={people} />
    </main>
  );
}