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

// ===== Layout tuning =====
const GAP_X = 420;
const GAP_Y = 240;
const PERSON_W = 260;

const CHILD_GAP = 360;
const MIN_NODE_GAP = PERSON_W + 90;

const HUB_OFFSET_Y = 160;
const CLUSTER_PAD = 180;
const CLUSTER_GAP = 120;

const HUB_SIZE = 18;
const COUPLE_SIZE = 34;

// ===== Mobile header height (fixed) =====
const MOBILE_HEADER_H = 92; // px (đổi nếu muốn cao/thấp hơn)

function useIsMobile(breakpoint = 900) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const apply = () => setIsMobile(mq.matches);
    apply();
    // safari old: addListener
    if ((mq as any).addEventListener) (mq as any).addEventListener("change", apply);
    else (mq as any).addListener(apply);
    return () => {
      if ((mq as any).removeEventListener) (mq as any).removeEventListener("change", apply);
      else (mq as any).removeListener(apply);
    };
  }, [breakpoint]);

  return isMobile;
}

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

// Couple node id
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

      <div style={{ fontSize: 11, opacity: 0.6, marginTop: 8 }}>
        ID: {p.id} • Đời {String(genFromId(p.id)).padStart(2, "0")} • #
        {String(orderFromId(p.id)).padStart(2, "0")}
      </div>

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

function CoupleNode() {
  return (
    <div
      style={{
        width: COUPLE_SIZE,
        height: COUPLE_SIZE,
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
        width: HUB_SIZE,
        height: HUB_SIZE,
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

// Mobile: sau khi fitView, kéo viewport lên để phần cao nhất không bị che bởi header fixed
function pinTopMostBelowHeader(rf: ReactFlowInstance, headerPx: number, pad = 10) {
  try {
    const vp = rf.getViewport?.();
    const ns = rf.getNodes?.() || [];
    if (!vp || ns.length === 0) return;

    let minY = Infinity;
    for (const n of ns) {
      if (!Number.isFinite(n.position?.y)) continue;
      minY = Math.min(minY, n.position.y);
    }
    if (!Number.isFinite(minY)) return;

    // screenY = flowY*zoom + vp.y
    // muốn minY nằm ngay dưới header => target = headerPx + pad
    const target = headerPx + pad;
    const newY = target - minY * vp.zoom;

    rf.setViewport?.({ x: vp.x, y: newY, zoom: vp.zoom }, { duration: 260 });
  } catch {}
}

export default function FamilyMap({ people }: { people: Person[] }) {
  const idx = useMemo(() => buildIndexes(people), [people]);
  const rf = useRef<ReactFlowInstance | null>(null);

  const isMobile = useIsMobile(900);

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

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

      const n = g.children.length;
      if (n === 0) continue;

      const firstChildPos = pos.get(g.children[0]);
      if (!firstChildPos) continue;

      const childY = firstChildPos.y;
      const pcx = centerXOfParentKey(pos, g.parentKey);
      if (!pcx) continue;

      const startCenter = pcx - ((n - 1) * CHILD_GAP) / 2;
      g.children.forEach((cid, i) => {
        const cx = startCenter + i * CHILD_GAP;
        const left = cx - PERSON_W / 2;
        pos.set(cid, { x: left, y: childY });
      });
    }

    type Cluster = { key: string; y: number; x: number; halfW: number; moveIds: string[] };
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
        x: centerXOfParentKey(pos, g.parentKey),
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
    }

    resolveRowOverlaps(pack.peopleIds, pos);

    const personNodes: Node[] = [];
    for (const id of pack.peopleIds) {
      const p = idx.byId.get(id);
      const xy = pos.get(id);
      if (!p || !xy) continue;
      personNodes.push({ id: p.id, type: "person", position: { x: xy.x, y: xy.y }, data: { person: p } });
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
          const cx = centerXOfParentKey(pos, g.parentKey);
          coupleNodes.push(makeCoupleNode(g.parentKey, cx - COUPLE_SIZE / 2, parentPos.y));

          const c = parseCoupleId(g.parentKey);
          if (c && pos.has(c.a) && pos.has(c.b)) {
            pushEdge(makeEdge(c.a, g.parentKey, "link"));
            pushEdge(makeEdge(c.b, g.parentKey, "link"));
          }
        }
      }

      if (g.children.length <= 1) {
        if (g.children[0]) pushEdge(makeEdge(g.parentKey, g.children[0], "parent"));
        continue;
      }

      const hubId = `h:${g.parentKey}`;
      const pcx = centerXOfParentKey(pos, g.parentKey);
      const hubX = pcx ? pcx - HUB_SIZE / 2 : parentPos.x + PERSON_W / 2 - HUB_SIZE / 2;

      hubNodes.push({
        id: hubId,
        type: "hub",
        position: { x: hubX, y: parentPos.y + HUB_OFFSET_Y },
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

    const allNodes = [...personNodes, ...coupleNodes, ...hubNodes].filter((n) => {
      const x = n.position?.x;
      const y = n.position?.y;
      return Number.isFinite(x) && Number.isFinite(y);
    });

    setNodes(allNodes);
    setEdges(newEdges);

    // Fit + (mobile) pin topmost under header
    setTimeout(() => {
      if (!rf.current) return;
      rf.current.fitView({ padding: isMobile ? 0.18 : 0.22, duration: 320 });

      if (isMobile) {
        setTimeout(() => {
          if (!rf.current) return;
          pinTopMostBelowHeader(rf.current, 0, 8); // header không nằm trong map nữa (map đã nằm dưới header)
        }, 360);
      }
    }, 50);
  }

  function focus(id: string) {
    setSelectedId(id);
    rebuildGraph(id);
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
      const ag = genFromId(a);
      const bg = genFromId(b);
      if (ag !== bg) return ag - bg;
      return orderFromId(a) - orderFromId(b);
    });

    focus(all[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people]);

  // ========= Desktop render (tách hẳn) =========
  if (!isMobile) {
    return (
      <div className="pc-wrap">
        <header className="pc-top">
          <div className="pc-title">Tìm người</div>
          <div className="pc-search">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Gõ tên…"
              style={inputStyle}
            />
            {suggestions.length > 0 && (
              <div className="pc-suggest">
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
          <div className="pc-hint">
            Chọn 1 người sẽ tự hiện 3 đời: cha mẹ, anh em ruột, con… và anh em ruột của cha + con của họ.
          </div>
        </header>

        <main className="pc-main">
          <section className="pc-map">
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
              connectionLineType={"smoothstep" as any}
              panOnDrag
              zoomOnPinch
              zoomOnDoubleClick={false}
              preventScrolling
              selectionOnDrag={false}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
            >
              <Background />
              {nodes.length > 0 ? <MiniMap pannable zoomable /> : null}
              <Controls showInteractive={false} />
            </ReactFlow>
          </section>

          <aside className="pc-profile">
            <FamilyProfilePanel idx={idx} selectedId={selectedId} />
          </aside>
        </main>

        <style jsx>{`
          .pc-wrap {
            display: grid;
            gap: 12px;
            align-items: start;
          }
          .pc-top {
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
          .pc-title {
            font-weight: 950;
            font-size: 14px;
          }
          .pc-search {
            position: relative;
          }
          .pc-hint {
            font-size: 12px;
            opacity: 0.65;
            line-height: 1.35;
          }
          .pc-suggest {
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
          .pc-main {
            display: grid;
            grid-template-columns: 1fr 520px;
            gap: 12px;
            align-items: start;
          }
          .pc-map {
            height: calc(100vh - 170px);
            border-radius: 16px;
            border: 1px solid rgba(0, 0, 0, 0.08);
            overflow: hidden;
            background: white;
          }
          .pc-profile {
            height: calc(100vh - 170px);
            overflow: auto;
          }
        `}</style>
      </div>
    );
  }

  // ========= Mobile render (header fixed, map không bị che) =========
  return (
    <div className="m-wrap">
      <header className="m-header">
        <div className="m-title">Gia phả</div>

        <div className="m-searchWrap">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm theo tên…"
            className="m-input"
          />

          {suggestions.length > 0 && (
            <div className="m-suggest">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  className="m-item"
                  onClick={() => {
                    setQuery("");
                    focus(s.id);
                  }}
                >
                  <div className="m-name">{s.name}</div>
                  <div className="m-sub">{s.id}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="m-body">
        <section className="m-map">
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
            connectionLineType={"smoothstep" as any}
            panOnDrag
            zoomOnPinch
            zoomOnDoubleClick={false}
            preventScrolling
            selectionOnDrag={false}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </section>

        <section className="m-info">
          <FamilyProfilePanel idx={idx} selectedId={selectedId} />
        </section>
      </div>

      <style jsx>{`
        .m-wrap {
          height: 100vh;
          background: #0b0d12;
        }

        /* fixed header => map không bao giờ bị che */
        .m-header {
          position: fixed;
          left: 0;
          right: 0;
          top: 0;
          height: ${MOBILE_HEADER_H}px;
          padding: 10px 12px 12px 12px;
          background: rgba(15, 17, 24, 0.92);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          z-index: 100;
          backdrop-filter: blur(10px);
        }
        .m-title {
          color: white;
          font-weight: 950;
          font-size: 14px;
          letter-spacing: 0.2px;
          margin-bottom: 8px;
        }
        .m-searchWrap {
          position: relative;
        }
        .m-input {
          width: 100%;
          padding: 10px 12px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          outline: none;
          background: rgba(255, 255, 255, 0.08);
          color: white;
          font-weight: 700;
        }
        .m-input::placeholder {
          color: rgba(255, 255, 255, 0.55);
        }

        .m-suggest {
          position: absolute;
          top: calc(100% + 8px);
          left: 0;
          right: 0;
          z-index: 120;
          background: rgba(255, 255, 255, 0.96);
          border-radius: 16px;
          border: 1px solid rgba(0, 0, 0, 0.08);
          box-shadow: 0 18px 44px rgba(0, 0, 0, 0.25);
          max-height: 44vh;
          overflow: auto;
          padding: 10px;
        }
        .m-item {
          width: 100%;
          text-align: left;
          padding: 12px 12px;
          border-radius: 14px;
          border: 1px solid rgba(0, 0, 0, 0.06);
          background: white;
          margin-bottom: 10px;
        }
        .m-name {
          font-weight: 950;
        }
        .m-sub {
          font-size: 12px;
          opacity: 0.7;
          margin-top: 2px;
        }

        /* body nằm dưới header */
        .m-body {
          padding-top: ${MOBILE_HEADER_H}px;
          height: 100vh;
          display: grid;
          grid-template-rows: 40% 60%;
        }

        .m-map {
          background: white;
          overflow: hidden;
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        }

        .m-info {
          background: white;
          overflow: auto;
          min-height: 0;
          -webkit-overflow-scrolling: touch;
          padding: 10px;
        }
      `}</style>
    </div>
  );
}

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