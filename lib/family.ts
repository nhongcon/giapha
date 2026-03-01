export type Person = {
  id: string;
  name: string;
  gender?: "M" | "F";
  branch?: string;
  birth?: string;
  death?: string;
  spouse?: string;
  address?: string;
  fatherId?: string;
  motherId?: string;

  phone?: string; // ✅ thêm dòng này
};

export type Indexes = {
  byId: Map<string, Person>;
  childrenOf: Map<string, string[]>;
  spousesOf: Map<string, string[]>;
};

export function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

export function genFromId(id: string): number {
  if (!id || id.length < 2) return 999999;
  const n = parseInt(id.slice(0, 2), 10);
  return Number.isFinite(n) ? n : 999999;
}

export function orderFromId(id: string): number {
  if (!id || id.length < 2) return 999999;
  const n = parseInt(id.slice(-2), 10);
  return Number.isFinite(n) ? n : 999999;
}

function birthYear(birth?: string): number {
  if (!birth) return Number.POSITIVE_INFINITY;
  const m = birth.match(/\d{4}/);
  if (!m) return Number.POSITIVE_INFINITY;
  const y = parseInt(m[0], 10);
  return Number.isFinite(y) ? y : Number.POSITIVE_INFINITY;
}

export function compareOlderLeft(a?: Person, b?: Person): number {
  // lớn -> bé: năm sinh nhỏ đứng trước
  const ay = birthYear(a?.birth);
  const by = birthYear(b?.birth);
  if (ay !== by) return ay - by;

  // fallback: order trong ID
  const ao = orderFromId(a?.id || "");
  const bo = orderFromId(b?.id || "");
  if (ao !== bo) return ao - bo;

  // fallback: tên rồi id
  const an = (a?.name || "").toLowerCase();
  const bn = (b?.name || "").toLowerCase();
  if (an !== bn) return an.localeCompare(bn);
  return (a?.id || "").localeCompare(b?.id || "");
}

export function buildIndexes(peopleRaw: Person[]): Indexes {
  const people = Array.isArray(peopleRaw) ? peopleRaw : [];

  const byId = new Map(people.map((p) => [p.id, p]));
  const childrenOf = new Map<string, string[]>();
  const spousesOf = new Map<string, string[]>();

  for (const p of people) {
    // children
    const parents = [p.fatherId, p.motherId].filter(Boolean) as string[];
    for (const par of parents) {
      if (!childrenOf.has(par)) childrenOf.set(par, []);
      childrenOf.get(par)!.push(p.id);
    }

    // spouses (2 chiều)
    const sids = (p.spouseIds || [])
      .map((s) => s.trim())
      .filter((sid) => sid && byId.has(sid));

    if (!spousesOf.has(p.id)) spousesOf.set(p.id, []);
    spousesOf.get(p.id)!.push(...sids);

    for (const sid of sids) {
      if (!spousesOf.has(sid)) spousesOf.set(sid, []);
      if (!spousesOf.get(sid)!.includes(p.id)) spousesOf.get(sid)!.push(p.id);
    }
  }

  // sort children stable
  for (const [k, arr] of childrenOf.entries()) {
    arr.sort((a, b) => compareOlderLeft(byId.get(a), byId.get(b)));
    childrenOf.set(k, arr);
  }

  return { byId, childrenOf, spousesOf };
}

export function childrenOfPerson(idx: Indexes, id: string): string[] {
  const kids = idx.childrenOf.get(id) || [];
  return [...kids].sort((a, b) => compareOlderLeft(idx.byId.get(a), idx.byId.get(b)));
}

export function siblingsFull(idx: Indexes, id: string): string[] {
  const p = idx.byId.get(id);
  if (!p) return [];
  const f = (p.fatherId || "").trim();
  const m = (p.motherId || "").trim();
  if (!f && !m) return [];

  const sibs: string[] = [];
  for (const [pid, pp] of idx.byId.entries()) {
    if (pid === id) continue;
    if ((pp.fatherId || "").trim() === f && (pp.motherId || "").trim() === m) {
      sibs.push(pid);
    }
  }
  sibs.sort((a, b) => compareOlderLeft(idx.byId.get(a), idx.byId.get(b)));
  return sibs;
}

export function paternalUnclesAndCousins(idx: Indexes, focusId: string) {
  const focus = idx.byId.get(focusId);
  const fatherId = (focus?.fatherId || "").trim();
  if (!fatherId) return { uncles: [] as string[], cousins: [] as string[] };

  const uncles = siblingsFull(idx, fatherId);
  const cousins = uniq(uncles.flatMap((u) => childrenOfPerson(idx, u)));
  return { uncles, cousins };
}

/**
 * 3 đời trung tâm + mở rộng nội:
 * - Cha mẹ
 * - Focus + anh em ruột (cùng cha mẹ)
 * - Con của focus + con của anh em ruột
 * - Anh em ruột của cha + con của họ
 * Spouse: chỉ “đính kèm” theo owner, không tham gia sắp xếp.
 */
export function showThreeGenerations(idx: Indexes, focusId: string) {
  const focus = idx.byId.get(focusId);
  if (!focus) return { focusId, peopleIds: [] as string[] };

  const father = (focus.fatherId || "").trim();
  const mother = (focus.motherId || "").trim();
  const parents = uniq([father, mother]);

  const sibs = siblingsFull(idx, focusId);
  const midRow = uniq([focusId, ...sibs]);

  const kidsFocus = childrenOfPerson(idx, focusId);
  const kidsSibs = sibs.flatMap((s) => childrenOfPerson(idx, s));
  const downRow = uniq([...kidsFocus, ...kidsSibs]);

  const { uncles, cousins } = paternalUnclesAndCousins(idx, focusId);

  const peopleIds = uniq([
    ...parents,
    ...midRow,
    ...downRow,
    ...uncles,
    ...cousins,
  ]);

  return { focusId, peopleIds };
}

export type ProfileStats = {
  alive: boolean;
  generation: number;
  order: number;
  spouses: Person[];
  sons: number;
  daughters: number;
  grandsonsPaternal: number;
  granddaughtersPaternal: number;
  grandsonsMaternal: number;
  granddaughtersMaternal: number;
  totalGrandchildren: number;
};

export function computeProfile(idx: Indexes, id: string): { person: Person; stats: ProfileStats } | null {
  const p = idx.byId.get(id);
  if (!p) return null;

  const alive = !p.death;

  const spouses = (idx.spousesOf.get(id) || [])
    .map((sid) => idx.byId.get(sid))
    .filter(Boolean) as Person[];

  const kids = childrenOfPerson(idx, id).map((kidId) => idx.byId.get(kidId)).filter(Boolean) as Person[];
  const sons = kids.filter((k) => k.gender === "M").length;
  const daughters = kids.filter((k) => k.gender === "F").length;

  let grandsonsPaternal = 0;
  let granddaughtersPaternal = 0;
  let grandsonsMaternal = 0;
  let granddaughtersMaternal = 0;

  for (const child of kids) {
    const gkids = childrenOfPerson(idx, child.id).map((x) => idx.byId.get(x)).filter(Boolean) as Person[];
    for (const gk of gkids) {
      const isSon = gk.gender === "M";
      const isDaughter = gk.gender === "F";
      if (child.gender === "M") {
        if (isSon) grandsonsPaternal++;
        else if (isDaughter) granddaughtersPaternal++;
      } else if (child.gender === "F") {
        if (isSon) grandsonsMaternal++;
        else if (isDaughter) granddaughtersMaternal++;
      }
    }
  }

  const totalGrandchildren =
    grandsonsPaternal + granddaughtersPaternal + grandsonsMaternal + granddaughtersMaternal;

  return {
    person: p,
    stats: {
      alive,
      generation: genFromId(p.id),
      order: orderFromId(p.id),
      spouses,
      sons,
      daughters,
      grandsonsPaternal,
      granddaughtersPaternal,
      grandsonsMaternal,
      granddaughtersMaternal,
      totalGrandchildren,
    },
  };
}