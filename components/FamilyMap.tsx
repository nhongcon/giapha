"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  MarkerType,
  Node,
  Edge,
  ReactFlowInstance,
  NodeProps,
  Handle,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";

import type { Person, Indexes } from "../lib/family";
import {
  buildIndexes,
  uniq,
  genFromId,
  orderFromId,
  compareOlderLeft,
  showThreeGenerations,
} from "../lib/family";

import FamilyProfilePanel from "./FamilyProfilePanel";

const GAP_X = 420; // khoảng cách trong cùng 1 đời
const GAP_Y = 240; // khoảng cách giữa các đời
const PERSON_W = 260;
const CHILD_GAP = 360; // giãn con trong cùng 1 nhóm
const MIN_NODE_GAP = PERSON_W + 90; // chống đè trong 1 đời
const HUB_OFFSET_Y = 160; // hub nằm dưới cha/mẹ một chút
const CLUSTER_PAD = 180; // đệm mỗi cụm cha (tách biệt cụm con khác cha)
const CLUSTER_GAP = 120; // khoảng cách tối thiểu giữa 2 cụm cha
const HUB_SIZE = 18;
const COUPLE_SIZE = 34;

function resolveRowOverlaps(ids: string[], pos: Map<string, { x: number; y: number }>) {
  const byY = new Map<number, string[]>();

  for (const id of ids) {
    const p = pos.get(id);
    if (!p) continue;
    const y = Math.round(p.y);
    if (!byY.has(y)) byY.set(y, []);
    byY.get(y)!.push(id);
  }

  for (const [, rowIds] of byY.entries()) {
    rowIds.sort((a, b) => pos.get(a)!.x - pos.get(b)!.x);

    const beforeCenter =
      rowIds.reduce((s, id) => s + pos.get(id)!.x, 0) / Math.max(1, rowIds.length);

    let lastX = -Infinity;
    for (const id of rowIds) {
      const p = pos.get(id)!;
      if (p.x < lastX + MIN_NODE_GAP) p.x = lastX + MIN_NODE_GAP;
      pos.set(id, p);
      lastX = p.x;
    }

    const afterCenter =
      rowIds.reduce((s, id) => s + pos.get(id)!.x, 0) / Math.max(1, rowIds.length);

    const dx = beforeCenter - afterCenter;
    for (const id of rowIds) {
      const p = pos.get(id)!;
      p.x += dx;
      pos.set(id, p);
    }
  }
}

function centerXOfPerson(pos: Map<string, { x: number; y: number }>, id: string) {
  const p = pos.get(id);
  if (!p) return 0;
  return p.x + PERSON_W / 2;
}

function centerXOfParentKey(pos: Map<string, { x: number; y: number }>, parentKey: string) {
  if (parentKey.startsWith("c:")) {
    const c = parseCoupleId(parentKey);
    if (!c) return 0;

    const aHas = pos.has(c.a);
    const bHas = pos.has(c.b);

    if (!aHas && !bHas) return 0;
    if (aHas && !bHas) return centerXOfPerson(pos, c.a);
    if (!aHas && bHas) return centerXOfPerson(pos, c.b);

    const ax = centerXOfPerson(pos, c.a);
    const bx = centerXOfPerson(pos, c.b);
    return (ax + bx) / 2;
  }
  return centerXOfPerson(pos, parentKey);
}

function shiftX(pos: Map<string, { x: number; y: number }>, ids: string[], dx: number) {
  for (const id of ids) {
    const p = pos.get(id);
    if (!p) continue;
    pos.set(id, { x: p.x + dx, y: p.y });
  }
}

function genderBg(g?: string) {
  if (g === "M") return "#eef5ff";
  if (g === "F") return "#fff0f6";
  return "white";
}
function genderBorder(g?: string) {
  if (g === "M") return "rgba(30, 90, 200, 0.35)";
  if (g === "F") return "rgba(220, 40, 120, 0.35)";
  return "rgba(0,0,0,0.12)";
}
function hashHue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}
function branchAccent(branch?: string) {
  if (!branch) return "rgba(0,0,0,0.08)";
  const hue = hashHue(branch);
  return `hsl(${hue} 70% 75%)`;
}

function coupleId(a: string, b: string) {
  const [x, y] = [a, b].sort();
  return `c:${x}|${y}`;
}
function parseCoupleId(id: string) {
  if (!id.startsWith("c:")) return null;
  const rest = id.slice(2);
  const parts = rest.split("|");
  if (parts.length !== 2) return null;
  return { a: parts[0], b: parts[1] };
}

function makePersonNode(p: Person, x: number, y: number): Node {
  return { id: p.id, type: "person", position: { x, y }, data: { person: p } };
}
function makeCoupleNode(id: string, x: number, y: number): Node {
  return { id, type: "couple", position: { x, y }, data: {} };
}
function makeEdge(source: string, target: string, kind: "parent" | "link"): Edge {
  if (kind === "link") {
    return {
      id: `lk-${source}->${target}`,
      source,
      target,
      type: "smoothstep",
      sourceHandle: "bottom",
      targetHandle: "top",
      style: { strokeDasharray: "6 6", opacity: 0.75 },
    };
  }
  return {
    id: `pa-${source}->${target}`,
    source,
    target,
    type: "smoothstep",
    sourceHandle: "bottom",
    targetHandle: "top",
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  };
}

function PersonNode({ data }: NodeProps<any>) {
  const p: Person = data.person;
  const accent = branchAccent(p.branch);
  const bg = genderBg(p.gender);

  return (
    <div
      style={{
        width: PERSON_W,
        borderRadius: 16,
        border: `2px solid ${genderBorder(p.gender)}`,
        background: bg,
        boxShadow: "0 10px 26px rgba(0,0,0,0.10)",
        padding: 10,
        fontFamily: "system-ui",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          height: 8,
          width: "100%",
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          background: accent,
        }}
      />

      <div style={{ fontWeight: 900, fontSize: 13, marginTop: 6 }}>{p.name}</div>

      <div style={{ display: "flex", gap: 10, marginTop: 4, fontSize: 12, opacity: 0.85 }}>
        <span>{p.gender === "M" ? "♂ Nam" : p.gender === "F" ? "♀ Nữ" : "⚪"}</span>
        {p.branch ? <span style={{ fontWeight: 800 }}>{p.branch}</span> : null}
      </div>

      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
        {p.birth ? `* ${p.birth}` : ""}
        {p.death ? `  ✝ ${p.death}` : ""}
      </div>

      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
        Vợ/Chồng: {p.spouse && p.spouse.trim() ? p.spouse : "—"}
      </div>

      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
        📞 {p.phone && p.phone.trim() ? p.phone : "—"}
      </div>

      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
        📍 {p.address && p.address.trim() ? p.address : "—"}
      </div>

      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 8 }}>
        ID: {p.id} • Đời {String(genFromId(p.id)).padStart(2, "0")} • #
        {String(orderFromId(p.id)).padStart(2, "0")}
      </div>

      <Handle
        id="top"
        type="target"
        position={Position.Top}
        style={{
          left: "50%",
          transform: "translateX(-50%)",
          width: 10,
          height: 10,
          opacity: 0,
        }}
      />

      <Handle
        id="bottom"
        type="source"
        position={Position.Bottom}
        style={{
          left: "50%",
          transform: "translateX(-50%)",
          width: 10,
          height: 10,
          opacity: 0,
        }}
      />
    </div>
  );
}

function CoupleNode() {
  return (
    <div
      style={{
        width: 34,
        height: 34,
        borderRadius: 999,
        border: "2px solid rgba(0,0,0,0.18)",
        background: "white",
        boxShadow: "0 8px 18px rgba(0,0,0,0.10)",
        display: "grid",
        placeItems: "center",
        fontFamily: "system-ui",
        fontWeight: 950,
        fontSize: 12,
      }}
      title="Couple"
    >
      ❤
      <Handle
        id="top"
        type="target"
        position={Position.Top}
        style={{ left: "50%", transform: "translateX(-50%)", width: 10, height: 10, opacity: 0 }}
      />
      <Handle
        id="bottom"
        type="source"
        position={Position.Bottom}
        style={{ left: "50%", transform: "translateX(-50%)", width: 10, height: 10, opacity: 0 }}
      />
    </div>
  );
}

function HubNode() {
  return (
    <div
      style={{
        width: 18,
        height: 18,
        borderRadius: 999,
        border: "2px solid rgba(0,0,0,0.25)",
        background: "white",
        boxShadow: "0 6px 14px rgba(0,0,0,0.08)",
      }}
      title="hub"
    >
      <Handle
        id="top"
        type="target"
        position={Position.Top}
        style={{ left: "50%", transform: "translateX(-50%)", width: 10, height: 10, opacity: 0 }}
      />
      <Handle
        id="bottom"
        type="source"
        position={Position.Bottom}
        style={{ left: "50%", transform: "translateX(-50%)", width: 10, height: 10, opacity: 0 }}
      />
    </div>
  );
}

function layoutByGeneration(idx: Indexes, peopleIds: string[]) {
  const visible = peopleIds.filter((id) => idx.byId.has(id));

  const groups = new Map<number, string[]>();
  for (const id of visible) {
    const g = genFromId(id);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(id);
  }

  for (const [g, ids] of groups.entries()) {
    ids.sort((a, b) => {
      const ao = orderFromId(a);
      const bo = orderFromId(b);
      if (ao !== bo) return ao - bo;
      return compareOlderLeft(idx.byId.get(a), idx.byId.get(b));
    });
    groups.set(g, ids);
  }

  const pos = new Map<string, { x: number; y: number }>();
  const gens = Array.from(groups.keys()).sort((a, b) => a - b);

  for (const g of gens) {
    const ids = groups.get(g)!;
    const y = (g - 1) * GAP_Y;
    const rowWidth = (ids.length - 1) * GAP_X;
    const startX = -rowWidth / 2;

    ids.forEach((id, i) => {
      pos.set(id, { x: startX + i * GAP_X, y });
    });
  }

  return pos;
}

export default function FamilyMap({ people }: { people: Person[] }) {
  const idx = useMemo(() => buildIndexes(people), [people]);
  const rf = useRef<ReactFlowInstance | null>(null);

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const [showSearch, setShowSearch] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const nameList = useMemo(() => {
    const list = Array.from(idx.byId.values()).map((p) => ({
      id: p.id,
      name: p.name || p.id,
      nameLower: (p.name || "").toLowerCase(),
    }));
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [idx]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return nameList.filter((x) => x.nameLower.includes(q)).slice(0, 12);
  }, [query, nameList]);

  function rebuildGraph(focusId: string) {
    const pack = showThreeGenerations(idx, focusId);

    const pos = layoutByGeneration(idx, pack.peopleIds);

    type Group = { parentKey: string; children: string[] };
    const groups = new Map<string, Group>();

    for (const childId of pack.peopleIds) {
      const child = idx.byId.get(childId);
      if (!child) continue;

      const f = child.fatherId && pos.has(child.fatherId) ? child.fatherId : "";
      const m = child.motherId && pos.has(child.motherId) ? child.motherId : "";

      let parentKey = "";
      if (f && m) parentKey = coupleId(f, m);
      else if (f) parentKey = f;
      else if (m) parentKey = m;
      else continue;

      if (!groups.has(parentKey)) groups.set(parentKey, { parentKey, children: [] });
      groups.get(parentKey)!.children.push(childId);
    }

    for (const g of groups.values()) {
      if (!g.parentKey.startsWith("c:")) continue;
      const c = parseCoupleId(g.parentKey);
      if (!c) continue;
      if (pos.has(g.parentKey)) continue;
      if (!pos.has(c.a) || !pos.has(c.b)) continue;

      const pa = pos.get(c.a)!;
      const pb = pos.get(c.b)!;
      pos.set(g.parentKey, { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 + 10 });
    }

    for (const g of groups.values()) {
      g.children = uniq(g.children);
      g.children.sort((a, b) => orderFromId(a) - orderFromId(b));

      const parentPos = pos.get(g.parentKey);
      if (!parentPos) continue;

      const n = g.children.length;
      if (n === 0) continue;

      const firstChildPos = pos.get(g.children[0]);
      if (!firstChildPos) continue;

      const childY = firstChildPos.y;
      const startX = parentPos.x - ((n - 1) * CHILD_GAP) / 2;

      g.children.forEach((cid, i) => {
        pos.set(cid, { x: startX + i * CHILD_GAP, y: childY });
      });

      const first = pos.get(g.children[0]);
      const last = pos.get(g.children[n - 1]);
      if (first && last) {
        parentPos.x = (first.x + last.x) / 2;
        pos.set(g.parentKey, parentPos);
      }
    }

    type Cluster = {
      key: string;
      y: number;
      x: number;
      halfW: number;
      moveIds: string[];
    };

    const clusters: Cluster[] = [];

    for (const g of groups.values()) {
      const parentPos = pos.get(g.parentKey);
      if (!parentPos) continue;

      const moveIds: string[] = [];

      if (g.parentKey.startsWith("c:")) {
        const c = parseCoupleId(g.parentKey);
        if (c) {
          if (pos.has(c.a)) moveIds.push(c.a);
          if (pos.has(c.b)) moveIds.push(c.b);
        }
        moveIds.push(g.parentKey);
      } else {
        moveIds.push(g.parentKey);
      }

      moveIds.push(...g.children);

      const n = g.children.length;
      const childrenSpan = Math.max(PERSON_W, (n - 1) * CHILD_GAP);
      const halfW = childrenSpan / 2 + CLUSTER_PAD;

      let y = parentPos.y;
      if (g.parentKey.startsWith("c:")) {
        const c = parseCoupleId(g.parentKey);
        if (c && pos.has(c.a)) y = pos.get(c.a)!.y;
        else if (c && pos.has(c.b)) y = pos.get(c.b)!.y;
      }

      clusters.push({
        key: g.parentKey,
        y,
        x: parentPos.x,
        halfW,
        moveIds: uniq(moveIds),
      });
    }

    const byParentRow = new Map<number, Cluster[]>();
    for (const cl of clusters) {
      const yy = Math.round(cl.y);
      if (!byParentRow.has(yy)) byParentRow.set(yy, []);
      byParentRow.get(yy)!.push(cl);
    }

    for (const row of byParentRow.values()) {
      row.sort((a, b) => a.x - b.x);

      let cursor = -Infinity;
      for (const cl of row) {
        const minCenter = cursor + cl.halfW + CLUSTER_GAP;
        if (cl.x < minCenter) {
          const dx = minCenter - cl.x;
          cl.x += dx;
          shiftX(pos, cl.moveIds, dx);
        }
        cursor = cl.x + cl.halfW;
      }

      const beforeCenter = row.reduce((s, c) => s + c.x, 0) / Math.max(1, row.length);
      const afterCenter =
        row.reduce((s, c) => s + (pos.get(c.key)?.x ?? c.x), 0) / Math.max(1, row.length);

      const dxRow = beforeCenter - afterCenter;
      for (const cl of row) shiftX(pos, cl.moveIds, dxRow);
    }

    resolveRowOverlaps(pack.peopleIds, pos);

    const personNodes: Node[] = [];
    for (const id of pack.peopleIds) {
      const p = idx.byId.get(id);
      const xy = pos.get(id);
      if (!p || !xy) continue;
      personNodes.push({
        id: p.id,
        type: "person",
        position: { x: xy.x, y: xy.y },
        data: { person: p },
      });
    }

    const coupleNodes: Node[] = [];
    const hubNodes: Node[] = [];
    const newEdges: Edge[] = [];
    const edgeIds = new Set<string>();
    const coupleSet = new Set<string>();

    const pushEdge = (e: Edge) => {
      if (edgeIds.has(e.id)) return;
      edgeIds.add(e.id);
      newEdges.push(e);
    };

    for (const g of groups.values()) {
      const parentPos = pos.get(g.parentKey);
      if (!parentPos) continue;

      if (g.parentKey.startsWith("c:")) {
        if (!coupleSet.has(g.parentKey)) {
          coupleSet.add(g.parentKey);
          coupleNodes.push(makeCoupleNode(g.parentKey, parentPos.x, parentPos.y));

          const c = parseCoupleId(g.parentKey);
          if (c && pos.has(c.a) && pos.has(c.b)) {
            pushEdge(makeEdge(c.a, g.parentKey, "link"));
            pushEdge(makeEdge(c.b, g.parentKey, "link"));
          }
        }
      }

      if (g.children.length <= 1) {
        pushEdge(makeEdge(g.parentKey, g.children[0], "parent"));
        continue;
      }

      const hubId = `h:${g.parentKey}`;
      hubNodes.push({
        id: hubId,
        type: "hub",
        position: { x: parentPos.x, y: parentPos.y + HUB_OFFSET_Y },
        data: {},
      });

      pushEdge({
        id: `hub-in-${g.parentKey}->${hubId}`,
        source: g.parentKey,
        target: hubId,
        type: "smoothstep",
        sourceHandle: "bottom",
        targetHandle: "top",
        style: { opacity: 0.85 },
      });

      for (const cid of g.children) {
        pushEdge({
          id: `hub-out-${hubId}->${cid}`,
          source: hubId,
          target: cid,
          type: "smoothstep",
          sourceHandle: "bottom",
          targetHandle: "top",
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        });
      }
    }

    // ✅ lọc node có position NaN/Infinity để tránh MiniMap/Background warning
    const allNodes = [...personNodes, ...coupleNodes, ...hubNodes].filter((n) => {
      const x = n.position?.x;
      const y = n.position?.y;
      return Number.isFinite(x) && Number.isFinite(y);
    });

    setNodes(allNodes);
    setEdges(newEdges);

    const fxy = pos.get(focusId);
    if (fxy && rf.current) {
      rf.current.setCenter(fxy.x + PERSON_W / 2, fxy.y + 40, { zoom: 1.05, duration: 420 });
      setTimeout(() => rf.current?.fitView({ duration: 360, padding: 0.22 }), 60);
    }
  }

  function focus(id: string) {
    setSelectedId(id);
    rebuildGraph(id);

    if (typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches) {
      setShowProfile(true);
      setShowSearch(false);
    }
  }

  const onNodeClick = (_: any, node: Node) => {
    if (node.id.startsWith("c:")) {
      const c = parseCoupleId(node.id);
      if (c) focus(c.a);
      return;
    }
    focus(node.id);
  };

  useEffect(() => {
    if (!people?.length) return;

    const all = people.map((p) => p.id);
    all.sort((a, b) => {
      const ag = genFromId(a),
        bg = genFromId(b);
      if (ag !== bg) return ag - bg;
      return orderFromId(a) - orderFromId(b);
    });

    focus(all[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people]); // ✅ chắc chắn chạy lại khi data đổi

   return (
    <div className="fm-wrap">
      {/* Top search bar (PC) */}
      <header className="fm-top fm-desktop">
        <div className="fm-topTitle">Tìm người</div>

        <div className="fm-topSearch">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Gõ tên…"
            style={inputStyle}
          />

          {suggestions.length > 0 && (
            <div className="fm-suggestBox">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setQuery("");
                    focus(s.id);
                  }}
                  style={suggestBtn}
                >
                  <div style={{ fontWeight: 900 }}>{s.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{s.id}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="fm-topHint">
          Chọn 1 người sẽ tự hiện 3 đời: cha mẹ, anh em ruột, con… và anh em ruột của cha + con của họ.
        </div>
      </header>

      {/* Main 2 columns (PC): Map left, Profile right */}
      <main className="fm-main">
        {/* ✅ MAP (chỉ 1 ReactFlow duy nhất) */}
        <section className="fm-map">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={{ person: PersonNode, couple: CoupleNode, hub: HubNode }}
            onInit={(instance) => (rf.current = instance)}
            onNodeClick={onNodeClick}
            fitView
            minZoom={0.02}
            maxZoom={3.5}
            proOptions={{ hideAttribution: true }}
            connectionLineType="smoothstep"
          >
            <Background />
            {nodes.length > 0 ? <MiniMap pannable zoomable /> : null}
            <Controls showInteractive={false} />
          </ReactFlow>

          {/* Mobile floating buttons */}
          <div className="fm-mobilebar fm-mobile">
            <button
              className="fm-btn"
              onClick={() => {
                setShowSearch(true);
                setShowProfile(false);
              }}
            >
              🔎 Tìm
            </button>
            <button
              className="fm-btn"
              onClick={() => {
                setShowProfile(true);
                setShowSearch(false);
              }}
              disabled={!selectedId}
              style={!selectedId ? { opacity: 0.5 } : undefined}
            >
              👤 Thông tin
            </button>
          </div>
        </section>

        {/* ✅ PANEL (PC only) */}
        <aside className="fm-profile fm-desktop">
          <FamilyProfilePanel idx={idx} selectedId={selectedId} />
        </aside>
      </main>

      {/* Mobile sheets */}
      {showSearch && (
        <div className="fm-sheet fm-mobile" onClick={() => setShowSearch(false)}>
          <div className="fm-sheetCard" onClick={(e) => e.stopPropagation()}>
            <div className="fm-sheetHandle" />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 950 }}>Tìm người</div>
              <button className="fm-x" onClick={() => setShowSearch(false)}>
                ✕
              </button>
            </div>

            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Gõ tên…"
              style={inputStyle}
            />

            {suggestions.length > 0 && (
              <div style={{ marginTop: 10 }}>
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setQuery("");
                      focus(s.id);
                      setShowSearch(false);
                    }}
                    style={suggestBtn}
                  >
                    <div style={{ fontWeight: 900 }}>{s.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>{s.id}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showProfile && (
        <div className="fm-sheet fm-mobile" onClick={() => setShowProfile(false)}>
          <div className="fm-sheetCard" onClick={(e) => e.stopPropagation()}>
            <div className="fm-sheetHandle" />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 950 }}>Thông tin</div>
              <button className="fm-x" onClick={() => setShowProfile(false)}>
                ✕
              </button>
            </div>

            <div style={{ marginTop: 10 }}>
              <FamilyProfilePanel idx={idx} selectedId={selectedId} />
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .fm-wrap {
          display: grid;
          gap: 12px;
          align-items: start;
        }

        /* PC top bar */
        .fm-top {
          display: grid;
          grid-template-columns: 120px 420px 1fr;
          gap: 12px;
          align-items: center;
          padding: 10px 12px;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 16px;
          background: white;
          box-shadow: 0 8px 22px rgba(0, 0, 0, 0.06);
        }
        .fm-topTitle {
          font-weight: 950;
          font-size: 14px;
        }
        .fm-topSearch {
          position: relative;
        }
        .fm-topHint {
          font-size: 12px;
          opacity: 0.65;
          line-height: 1.35;
        }

        /* suggestion dropdown on PC */
        .fm-suggestBox {
          position: absolute;
          top: calc(100% + 8px);
          left: 0;
          right: 0;
          z-index: 80;
          background: white;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 14px;
          padding: 10px;
          box-shadow: 0 18px 44px rgba(0, 0, 0, 0.14);
          max-height: 56vh;
          overflow: auto;
        }

        /* Main layout: default = 1 column (mobile) */
        .fm-main {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
          align-items: start;
        }

        .fm-map {
          height: calc(100vh - 88px);
          border-radius: 0;
          border: none;
          overflow: hidden;
          position: relative;
        }

        /* PC override: 2 columns */
        @media (min-width: 901px) {
          .fm-main {
            grid-template-columns: 1fr 520px;
          }
          .fm-map {
            height: calc(100vh - 170px);
            border-radius: 16px;
            border: 1px solid rgba(0, 0, 0, 0.08);
          }
          .fm-profile {
            height: calc(100vh - 170px);
            overflow: auto;
          }
        }

        /* Mobile bar + sheets */
        .fm-btn {
          border: 1px solid rgba(0, 0, 0, 0.12);
          background: white;
          border-radius: 999px;
          padding: 10px 14px;
          font-weight: 900;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.12);
        }

        .fm-mobilebar {
          position: absolute;
          left: 50%;
          bottom: 14px;
          transform: translateX(-50%);
          display: flex;
          gap: 10px;
          z-index: 50;
        }

        .fm-sheet {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.28);
          z-index: 100;
          display: flex;
          align-items: flex-end;
        }

        .fm-sheetCard {
          width: 100%;
          max-height: 85vh;
          background: white;
          border-top-left-radius: 18px;
          border-top-right-radius: 18px;
          padding: 12px;
          box-shadow: 0 -12px 28px rgba(0, 0, 0, 0.18);
          overflow: auto;
        }

        .fm-sheetHandle {
          width: 44px;
          height: 5px;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.18);
          margin: 6px auto 10px auto;
        }

        .fm-x {
          border: 1px solid rgba(0, 0, 0, 0.1);
          background: white;
          border-radius: 10px;
          padding: 6px 10px;
          font-weight: 900;
        }

        /* visibility helpers */
        @media (max-width: 900px) {
          .fm-desktop {
            display: none;
          }
          .fm-mobile {
            display: block;
          }
        }
        @media (min-width: 901px) {
          .fm-mobile {
            display: none;
          }
          .fm-desktop {
            display: block;
          }
        }
      `}</style>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  border: "1px solid rgba(0,0,0,0.08)",
  borderRadius: 16,
  padding: 12,
  background: "white",
  boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
  fontFamily: "system-ui",
  height: "82vh",
  overflow: "auto",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  marginTop: 0,
  padding: "8px 10px",
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.12)",
  outline: "none",
};

const suggestBtn: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  padding: "10px 10px",
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.06)",
  background: "white",
  marginBottom: 8,
  cursor: "pointer",
};

const mapStyle: React.CSSProperties = {
  height: "82vh",
  borderRadius: 16,
  overflow: "hidden",
  border: "1px solid rgba(0,0,0,0.08)",
};