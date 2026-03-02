"use client";

import React from "react";
import type { Indexes, Person } from "../lib/family";
import { computeProfile } from "../lib/family";

function birthYear(p?: Person | null): number {
  if (!p?.birth) return 9999;
  const m = String(p.birth).match(/\d{4}/);
  return m ? parseInt(m[0], 10) : 9999;
}

function getFather(idx: Indexes, p: Person): Person | null {
  if (!p.fatherId) return null;
  return idx.byId.get(p.fatherId) || null;
}

function getMotherNameByFatherSpouse(idx: Indexes, p: Person): string {
  const father = getFather(idx, p);
  const fromFatherSpouse = father?.spouse?.trim();
  if (fromFatherSpouse) return fromFatherSpouse;

  // fallback: nếu có motherId thì lấy tên mẹ theo record mẹ
  if (p.motherId) {
    const mother = idx.byId.get(p.motherId);
    if (mother?.name?.trim()) return mother.name.trim();
    return p.motherId;
  }

  return "—";
}

function getFatherName(idx: Indexes, p: Person): string {
  const father = getFather(idx, p);
  if (father?.name?.trim()) return father.name.trim();
  return p.fatherId ? p.fatherId : "—";
}

function getFullSiblings(idx: Indexes, p: Person): Person[] {
  const fatherId = p.fatherId || "";
  const motherId = p.motherId || "";
  if (!fatherId && !motherId) return [];

  const sibs: Person[] = [];
  for (const other of idx.byId.values()) {
    if (!other || other.id === p.id) continue;
    if ((other.fatherId || "") === fatherId && (other.motherId || "") === motherId) {
      sibs.push(other);
    }
  }

  // ✅ sort theo năm sinh (không theo ID)
  sibs.sort((a, b) => {
    const ay = birthYear(a);
    const by = birthYear(b);
    if (ay !== by) return ay - by;
    return (a.name || "").localeCompare(b.name || "");
  });

  return sibs;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, margin: "8px 0" }}>
      <div style={{ fontSize: 13, opacity: 0.75 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 800, textAlign: "right" }}>{value}</div>
    </div>
  );
}

function pill(alive: boolean): React.CSSProperties {
  return {
    border: "1px solid rgba(0,0,0,0.10)",
    borderRadius: 999,
    padding: "8px 10px",
    fontSize: 12,
    fontWeight: 900,
    background: alive ? "rgba(0, 200, 0, 0.10)" : "rgba(0,0,0,0.06)",
  };
}

/**
 * ✅ Quan trọng:
 * - Không scroll ở đây nữa (mobile sẽ scroll ở fm-mProfile)
 * - PC scroll ở .fm-profile (FamilyMap) nên vẫn OK
 */
const panelStyle: React.CSSProperties = {
  border: "1px solid rgba(0,0,0,0.08)",
  borderRadius: 16,
  padding: 12,
  background: "white",
  boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
  fontFamily: "system-ui",
  height: "auto", // ✅
  overflow: "visible", // ✅
};

const hr: React.CSSProperties = {
  margin: "14px 0",
  border: "none",
  borderTop: "1px solid rgba(0,0,0,0.08)",
};

export default function FamilyProfilePanel({
  idx,
  selectedId,
}: {
  idx: Indexes;
  selectedId: string | null;
}) {
  if (!selectedId) {
    return (
      <div style={panelStyle}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>Thông tin</div>
        <div style={{ marginTop: 10, opacity: 0.7, fontSize: 13 }}>
          Bấm vào 1 người trên bản đồ để xem chi tiết.
        </div>
      </div>
    );
  }

  const res = computeProfile(idx, selectedId);
  if (!res) {
    return (
      <div style={panelStyle}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>Thông tin</div>
        <div style={{ marginTop: 10, opacity: 0.7, fontSize: 13 }}>
          Không tìm thấy dữ liệu cho ID: {selectedId}
        </div>
      </div>
    );
  }

  const { person, stats } = res;

  const fatherName = getFatherName(idx, person);
  const motherName = getMotherNameByFatherSpouse(idx, person);
  const siblings = getFullSiblings(idx, person);

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div style={{ fontWeight: 950, fontSize: 18 }}>{person.name}</div>
          <div style={{ marginTop: 4, fontSize: 12, opacity: 0.75 }}>
            ID: {person.id} • Đời {String(stats.generation).padStart(2, "0")} • Thứ tự{" "}
            {String(stats.order).padStart(2, "0")}
          </div>
        </div>
        <div style={{ ...pill(stats.alive), whiteSpace: "nowrap" }}>
          {stats.alive ? "🟢 Còn sống" : "⚫ Đã mất"}
        </div>
      </div>

      <hr style={hr} />

      <Row
        label="Giới tính"
        value={person.gender === "M" ? "Nam" : person.gender === "F" ? "Nữ" : "Chưa rõ"}
      />
      <Row label="Ngày sinh" value={person.birth || "Chưa rõ"} />
      <Row label="Ngày mất" value={person.death || (stats.alive ? "—" : "Chưa rõ")} />
      <Row label="Chi họ" value={person.branch || "—"} />

      <Row label="SĐT" value={(person as any).phone?.trim() ? (person as any).phone.trim() : "—"} />
      <Row label="Địa chỉ" value={(person as any).address?.trim() ? (person as any).address.trim() : "—"} />

      <hr style={hr} />

      <div style={{ fontWeight: 900, marginBottom: 8 }}>Bố mẹ</div>
      <Row label="Bố" value={fatherName} />
      <Row label="Mẹ" value={motherName} />

      {siblings.length > 0 ? (
        <>
          <hr style={hr} />
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Anh/Chị/Em ruột (cùng cha mẹ)</div>
          <div style={{ display: "grid", gap: 8 }}>
            {siblings.map((s) => (
              <div
                key={s.id}
                style={{
                  border: "1px solid rgba(0,0,0,0.06)",
                  borderRadius: 12,
                  padding: "8px 10px",
                  background: "white",
                }}
              >
                <div style={{ fontWeight: 900, fontSize: 13 }}>
                  {s.name || s.id}{" "}
                  <span style={{ fontWeight: 800, fontSize: 12, opacity: 0.7 }}>({s.id})</span>
                </div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                  {s.birth ? `* ${s.birth}` : "—"} {s.death ? `  ✝ ${s.death}` : ""}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <hr style={hr} />

      <div style={{ fontWeight: 900, marginBottom: 8 }}>Vợ/Chồng</div>
      <div style={{ fontSize: 13, fontWeight: 800 }}>
        {person.spouse && person.spouse.trim() ? person.spouse : "—"}
      </div>

      <hr style={hr} />

      <div style={{ fontWeight: 900, marginBottom: 8 }}>Con cái</div>
      <Row label="Con trai" value={stats.sons.toString()} />
      <Row label="Con gái" value={stats.daughters.toString()} />

      <hr style={hr} />

      <div style={{ fontWeight: 900, marginBottom: 8 }}>Cháu</div>
      <Row label="Cháu nội" value={`${stats.grandsonsPaternal} trai, ${stats.granddaughtersPaternal} gái`} />
      <Row label="Cháu ngoại" value={`${stats.grandsonsMaternal} trai, ${stats.granddaughtersMaternal} gái`} />
      <Row label="Tổng cháu" value={stats.totalGrandchildren.toString()} />
    </div>
  );
}