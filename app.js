"use strict";
// 장비 프리셋 흐름 테스트. 버튼은 세 값 사이에서 데이터를 옮긴다.
//   실제 착용(S.items·S.crest) → [현재 장비 불러오기] → 화면 값(V.draft) → [저장] → 저장값(S.presets) → [장비 적용] → 실제 착용
const D = window.PRESET_DATA;
const HERO = D.heroes;
const SLOT_IDS = [1, 2, 3, 4, 5, 6, 7];
const SLOT_NAME = D.slots;
const MSG_PARTIAL = "프리셋의 일부 장비가 존재하지 않아 일부 장비가 교체되지 않았습니다.";
const MSG_NO_PRESET = "현재 저장된 프리셋이 없습니다.\n편성된 팀 기준으로 불러오시겠습니까?";
// A안: 편성을 바꿔도 저장값은 그대로. B안: 편성을 바꾸면 저장값도 바로 따라간다.
const VARIANT = new URLSearchParams(location.search).get("v") === "b" ? "B" : "A";
const VARIANT_RULE = {
  A: "편성을 바꿔도 프리셋 저장값은 그대로입니다. 새 영웅은 미설정이고, 빠진 영웅의 저장값은 덮어쓰기 전까지 남습니다.",
  B: "편성을 바꾸면 프리셋도 바로 바뀝니다. 새 영웅은 현재 장비로 자동 저장되고, 빠진 영웅의 저장값은 바로 삭제됩니다.",
};
const stage = document.getElementById("stage");
const stageBox = document.getElementById("stageBox");
const side = document.getElementById("side");

let S, V;

function fresh() {
  const items = {};
  D.items.forEach((i) => { items[i.uid] = { ...i }; });
  const crest = {};
  Object.values(HERO).forEach((h) => { crest[h.tid] = h.crest || 0; });
  const decks = {};
  D.decks.forEach((d) => { decks[d.index] = { ...d, cells: [...d.cells] }; });
  S = { items, deleted: {}, crest, decks, presets: {}, savedRoster: {}, battleAck: {}, deckIdx: D.decks[0].index };
  V = { screen: "team", draft: {}, drafts: {}, selected: 0, slot: 0, gearHero: 0, gearSlot: 2, modal: null, toast: "", inspect: 0,
        done: new Set(), loadedAfterChange: false, log: [] };
  log("테스트 시작: 계정 데이터 불러옴");
}

/* ---------- 데이터 조회 ---------- */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const deck = () => S.decks[S.deckIdx];
const deckHeroes = () => deck().cells.filter(Boolean);
const heroName = (t) => (HERO[t] ? HERO[t].name : "-");
const heroImg = (t) => `assets/hero/${HERO[t].icon}.png`;
const saved = () => S.presets[S.deckIdx];
const isArena = () => deck().mode === "arena";
const groupDecks = () => D.decks.filter((d) => d.group === deck().group);
const arenaDecks = () => D.decks.filter((d) => d.mode === "arena");
function draftFromSaved(idx) {
  const sv = S.presets[idx];
  const out = {};
  if (sv) S.decks[idx].cells.filter(Boolean).forEach((h) => { if (sv[h]) out[h] = { ...sv[h] }; });
  return out;
}
/* 같은 묶음의 다른 탭에 저장된 장비인지. 결투장은 공격·방어에 같은 장비를 함께 쓸 수 있다. */
function otherTabsUsing(s, uid) {
  if (!uid) return [];
  return groupDecks().filter((d) => d.index !== S.deckIdx && Object.values(S.presets[d.index] || {}).some((p) => p[s] === uid)).map((d) => d.tab);
}

function actualOf(h) {
  const r = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: S.crest[h] || 0 };
  Object.values(S.items).forEach((i) => { if (i.owner === h) r[i.slot] = i.uid; });
  return r;
}
function info(s, v) {
  if (!v) return null;
  if (s === 7) return D.crests[v] ? { ...D.crests[v], alive: true } : null;
  if (S.items[v]) return { ...S.items[v], alive: true };
  return S.deleted[v] ? { ...S.deleted[v], alive: false } : null;
}
function where(it) {
  return it.owner ? `${heroName(it.owner)} 착용 중` : "가방";
}
function sameSlots(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return SLOT_IDS.every((s) => (a[s] || 0) === (b[s] || 0));
}
function heroStatus(h) {
  const d = V.draft[h];
  if (!d) return "unset";
  const a = actualOf(h);
  let gone = false, diff = false;
  SLOT_IDS.forEach((s) => {
    const v = d[s];
    if (!v) return;
    if (s < 7 && !S.items[v]) gone = true;
    else if (v !== a[s]) diff = true;
  });
  // 결투장은 저장값으로 전투하므로 실제 착용과 달라도 문제가 아니다.
  return gone ? "gone" : diff && !isArena() ? "diff" : "ok";
}
const filled = (d) => SLOT_IDS.filter((s) => d[s] && (s === 7 || S.items[d[s]])).length;
function isDirty() {
  const sv = saved() || {};
  return deckHeroes().some((h) => !sameSlots(V.draft[h], sv[h]));
}
function hasOutOfDeck() {
  const sv = saved();
  if (!sv) return false;
  const cur = new Set(deckHeroes());
  return Object.keys(sv).some((h) => !cur.has(Number(h)));
}
function dirtyDeck(idx) {
  const dr = idx === S.deckIdx ? V.draft : V.drafts[idx];
  if (!dr) return false;
  const sv = S.presets[idx] || {};
  return S.decks[idx].cells.filter(Boolean).some((h) => !sameSlots(dr[h], sv[h]));
}
const anyDirty = () => groupDecks().some((d) => dirtyDeck(d.index));
const dirtyTabs = () => groupDecks().filter((d) => dirtyDeck(d.index));
const canSave = () => Object.keys(V.draft).length > 0 && (isDirty() || hasOutOfDeck());
/* 저장 후 팀 프리셋의 편성이 달라졌는지. 편성은 팀 프리셋이 맡고, 저장 때의 명단은 비교에만 쓴다. */
function rosterChange() {
  if (!saved()) return null;
  const was = S.savedRoster[S.deckIdx] || [];
  const now = deckHeroes();
  const added = now.filter((h) => !was.includes(h));
  const removed = was.filter((h) => !now.includes(h));
  return added.length || removed.length ? { added, removed } : null;
}
/* 저장값은 있지만 지금 편성에 없는 영웅. 다음 덮어쓰기 때 저장값이 지워진다. */
function gearDiffers() {
  if (isArena() || !saved()) return false;
  const plan = buildPlan();
  return plan.moves.length > 0 || plan.crests.length > 0;
}
/* B안 전용. 저장 버튼 없이 저장값이 편성을 따라간다. 같은 팀 안의 장비 중복은 비운다. */
function syncPresetRoster(h, joined) {
  if (VARIANT !== "B" || !saved()) return;
  const sv = saved();
  let cleared = 0;
  if (joined) {
    sv[h] = actualOf(h);
    Object.keys(sv).map(Number).filter((o) => o !== h).forEach((o) => {
      [1, 2, 3, 4, 5, 6].forEach((s) => {
        if (sv[h][s] && sv[o][s] === sv[h][s]) { sv[o][s] = 0; cleared++; }
      });
    });
  } else {
    delete sv[h];
  }
  S.savedRoster[S.deckIdx] = [...deckHeroes()];
  if (!Object.keys(sv).length) {
    delete S.presets[S.deckIdx];
    delete S.savedRoster[S.deckIdx];
  }
  log(`프리셋 자동 반영: ${heroName(h)} ${joined ? "현재 장비로 추가" : "저장값 삭제"}${cleared ? `, 겹친 슬롯 ${cleared}칸 비움` : ""}`);
  toast(`장비 프리셋에도 반영했습니다: ${heroName(h)} ${joined ? "추가" : "제외"}`);
}
function outOfDeckHeroes() {
  const sv = saved();
  if (!sv) return [];
  const now = deckHeroes();
  return Object.keys(sv).map(Number).filter((h) => !now.includes(h));
}

/* 저장값 → 실제 착용 계획. 빈 값과 삭제된 장비는 벗기지 않고 현재 장비를 유지한다. */
function buildPlan() {
  const sv = saved();
  const plan = { moves: [], crests: [], missing: [], keep: [] };
  if (!sv) return plan;
  deckHeroes().forEach((h) => {
    const p = sv[h];
    if (!p) return;
    const a = actualOf(h);
    [1, 2, 3, 4, 5, 6].forEach((s) => {
      const v = p[s];
      if (!v) { if (a[s]) plan.keep.push({ h, s }); return; }
      const it = S.items[v];
      if (!it) { plan.missing.push({ h, s, name: S.deleted[v] ? S.deleted[v].name : "?" }); return; }
      if (it.owner !== h) plan.moves.push({ h, s, uid: v, from: it.owner, name: it.name });
    });
    if (p[7] && p[7] !== a[7]) plan.crests.push({ h, tid: p[7] });
  });
  return plan;
}

/* ---------- 체크리스트 ---------- */
const STEPS = [
  ["s1", "1. 팀 편성에서 [장비 프리셋] 누르기"],
  ["s2", "2. 빈 화면 확인"],
  ["s3", "3. 안내 팝업 확인"],
  ["s4", "4. 예 → 배치된 영웅 기준으로 불러오기"],
  ["s5", "5. [저장] 눌러 프리셋 저장"],
  ["s6", "6. [장비 적용] → 반응 없음"],
  ["s7", "7. 편성 또는 장비 교체"],
  ["s8", "8. [장비 프리셋] 다시 열기"],
  ["s9a", "9-1. 현재 장비 불러오기 → 저장"],
  ["s9b", "9-2. 장비 적용"],
  ["sx", "추가. 저장된 장비를 분해한 뒤 장비 적용 → 안내 문구"],
  ["st", "추가. 저장값과 장비가 다른 팀으로 [전투 시작] → 안내 팝업"],
];
const ARENA_STEPS = [
  ["a1", "1. 결투장 [장비 프리셋] 열기"],
  ["a2", "2. 공격팀 불러오기 → 저장"],
  ["a3", "3. 방어팀: [복사] 또는 불러오기 → 저장"],
  ["a4", "4. 편성 또는 실제 장비 교체 → 저장값 유지 확인"],
  ["a5", "5. 프리셋 장비 강화 → 자동 반영 확인"],
  ["a6", "추가. 프리셋 장비 분해 → 장비 없음 표시"],
];
const inArenaPreset = (uid) => arenaDecks().some((a) => Object.values(S.presets[a.index] || {}).some((p) => Object.values(p).includes(uid)));
function ev(name, arg) {
  const d = V.done;
  if (name === "enhance") { if (inArenaPreset(arg)) d.add("a5"); return; }
  if (isArena()) {
    if (name === "open") d.add("a1");
    else if (name === "save") d.add(deck().index === arenaDecks()[0].index ? "a2" : "a3");
    else if (name === "change" && arenaDecks().some((a) => S.presets[a.index])) d.add("a4");
    return;
  }
  if (name === "open") {
    d.add("s1");
    if (!saved()) { d.add("s2"); d.add("s3"); } else if (d.has("s7")) d.add("s8");
  } else if (name === "yes") d.add("s4");
  else if (name === "save") {
    d.add("s5");
    if (d.has("s8") && V.loadedAfterChange) d.add("s9a");
  } else if (name === "noop") { if (d.has("s5")) d.add("s6"); }
  else if (name === "change") { if (saved()) d.add("s7"); }
  else if (name === "load") { if (d.has("s8")) V.loadedAfterChange = true; }
  else if (name === "apply") { if (d.has("s8")) d.add("s9b"); }
  else if (name === "missing") d.add("sx");
  else if (name === "battlePop") d.add("st");
}
function log(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  V.log.unshift({ t, msg });
  V.log.length = Math.min(V.log.length, 60);
}
let toastTimer = 0;
function toast(msg) {
  V.toast = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { V.toast = ""; render(); }, 3200);
}

/* ---------- 동작 ---------- */
const ACT = {
  reset() { fresh(); },
  deck(el) {
    S.deckIdx = Number(el.value);
    V.itemPop = null;
    V.screen = "team";
    V.inspect = 0;
    log(`덱 변경: ${deck().group}`);
  },
  // 팀을 바꿔도 장비는 바꾸지 않고 묻지도 않는다. 저장값과 다르면 [전투 시작]에서 묻는다.
  variant(el) { location.search = `?v=${el.dataset.v}`; },
  teamTab(el) {
    const idx = Number(el.dataset.d);
    if (idx === S.deckIdx) return;
    S.deckIdx = idx;
    V.inspect = 0;
    log(`팀 전환: ${deck().label}`);
  },
  battle() {
    if (!deckHeroes().length) { toast("편성된 영웅이 없습니다."); return; }
    const row = presetCheck();
    const askGear = row.warn && !gearAcked();
    if (askGear || deckHeroes().length < deck().max) {
      V.modal = { type: "preBattle" };
      if (askGear) ev("battlePop");
      log(`전투 전 확인: 팀 편성 ${deckHeroes().length}/${deck().max}, 장비 프리셋 ${row.text}`);
      return;
    }
    if (row.warn) log("전투 전 확인 생략: 같은 장비 상태로 이미 확인함");
    startBattle(isArena() && saved() ? "프리셋 장비" : "현재 장비");
  },
  battleApply() {
    const plan = buildPlan();
    V.modal = { type: "apply", plan };
    ACT.applyYes();
    startBattle("저장된 장비");
    if (plan.missing.length) toast(MSG_PARTIAL);
  },
  battleGo() {
    V.modal = null;
    if (presetCheck().warn) S.battleAck[S.deckIdx] = gearSignature();
    startBattle(isArena() && saved() ? "프리셋 장비" : "현재 장비");
  },
  // 프리셋 안에서 탭을 옮겨도 저장 전 화면 값은 탭별로 남겨 둔다.
  presetTab(el) {
    const idx = Number(el.dataset.d);
    if (idx === S.deckIdx) return;
    if (!S.decks[idx].cells.some(Boolean)) { toast("편성된 영웅이 없습니다."); return; }
    V.drafts[S.deckIdx] = V.draft;
    S.deckIdx = idx;
    V.draft = V.drafts[idx] || draftFromSaved(idx);
    V.selected = deckHeroes()[0];
    V.inspect = V.selected;
    V.slot = 0;
    log(`프리셋 탭 전환: ${deck().label}`);
    if (!saved() && !Object.keys(V.draft).length) V.modal = { type: "noPreset" };
  },
  copyTeam() {
    const to = groupDecks().find((d) => d.index !== S.deckIdx);
    const targets = S.decks[to.index].cells.filter(Boolean);
    const hit = targets.filter((h) => V.draft[h]);
    if (!hit.length) { V.modal = { type: "alert", text: `${deck().tab}과 ${to.tab}에 겹치는 영웅의 장비 값이 없어 복사할 수 없습니다.` }; return; }
    const skip = deckHeroes().filter((h) => V.draft[h] && !targets.includes(h));
    V.modal = { type: "copy", to: to.index, hit, skip };
  },
  copyYes() {
    const { to, hit } = V.modal;
    const fromTab = deck().tab;
    const src = V.draft;
    const base = V.drafts[to] || draftFromSaved(to);
    hit.forEach((h) => { base[h] = { ...src[h] }; });
    // 대상 팀의 다른 영웅과 겹치는 장비는 그 슬롯을 비운다. 같은 팀 중복은 허용하지 않는다.
    let cleared = 0;
    Object.keys(base).map(Number).filter((h) => !hit.includes(h)).forEach((o) => {
      hit.forEach((h) => [1, 2, 3, 4, 5, 6].forEach((s) => {
        if (base[h][s] && base[o][s] === base[h][s]) { base[o][s] = 0; cleared++; }
      }));
    });
    V.drafts[S.deckIdx] = V.draft;
    S.deckIdx = to;
    V.draft = base;
    V.selected = hit[0];
    V.inspect = V.selected;
    V.slot = 0;
    V.modal = null;
    log(`복사: ${fromTab} → ${deck().tab} 영웅 ${hit.length}명 (저장 전)${cleared ? `, 겹친 슬롯 ${cleared}칸 비움` : ""}`);
    toast(`${fromTab} 장비를 복사했습니다. 저장해야 확정됩니다.`);
  },
  // 팀 편성
  openPreset() {
    if (!deckHeroes().length) { toast("편성된 영웅이 없습니다."); return; }
    const sv = saved();
    V.drafts = {};
    V.draft = draftFromSaved(S.deckIdx);
    V.selected = deckHeroes()[0];
    V.slot = 0;
    V.screen = "preset";
    ev("open");
    log(sv ? "장비 프리셋 열기: 저장값을 화면에 표시" : "장비 프리셋 열기: 저장값 없음, 빈 화면");
    if (!sv) V.modal = { type: "noPreset" };
  },
  toggleHero(el) {
    const t = Number(el.dataset.h);
    const d = deck();
    const i = d.cells.indexOf(t);
    if (i >= 0) { d.cells[i] = 0; log(`편성에서 제외: ${heroName(t)}`); ev("change"); syncPresetRoster(t, false); return; }
    const e = d.cells.indexOf(0);
    if (deckHeroes().length >= d.max || e < 0) { toast("최대 배치 가능인원을 넘었습니다."); return; }
    d.cells[e] = t;
    log(`편성에 추가: ${heroName(t)}`);
    ev("change");
    syncPresetRoster(t, true);
  },
  removeHero(el) {
    const t = Number(el.dataset.h);
    deck().cells[deck().cells.indexOf(t)] = 0;
    log(`편성에서 제외: ${heroName(t)}`);
    ev("change");
    syncPresetRoster(t, false);
  },
  openGear(el) {
    V.gearHero = Number(el.dataset.h);
    V.gearSlot = 2;
    V.inspect = V.gearHero;
    V.screen = "gear";
  },
  // 장비 교체 (게임의 영웅 장비 화면 역할)
  closeGear() { V.screen = "team"; },
  pickGearSlot(el) { V.gearSlot = Number(el.dataset.s); },
  equip(el) {
    const h = V.gearHero;
    const it = S.items[el.dataset.u];
    const a = actualOf(h);
    const from = it.owner;
    if (a[it.slot]) S.items[a[it.slot]].owner = 0;
    it.owner = h;
    log(`장비 교체: ${heroName(h)} ${SLOT_NAME[it.slot]} ← ${it.name}${from ? ` (${heroName(from)}에게서 해제)` : ""}`);
    ev("change");
  },
  unequip(el) {
    const it = S.items[el.dataset.u];
    it.owner = 0;
    log(`장비 해제: ${it.name} → 가방`);
    ev("change");
  },
  scrap(el) {
    const it = S.items[el.dataset.u];
    S.deleted[it.uid] = it;
    delete S.items[it.uid];
    const used = Object.entries(S.presets).filter(([, p]) => Object.values(p).some((x) => x[it.slot] === it.uid));
    log(`분해: ${it.name}${used.length ? " (프리셋에 저장된 장비)" : ""}`);
    if (inArenaPreset(it.uid)) V.done.add("a6");
    ev("change");
  },
  enhance(el) {
    const it = S.items[el.dataset.u];
    it.lb += 1;
    log(`강화: ${it.name} 돌파 ${it.lb} (같은 UUID를 저장한 프리셋에 자동 반영)`);
    ev("enhance", it.uid);
  },
  equipCrest(el) {
    const h = V.gearHero;
    S.crest[h] = Number(el.dataset.t);
    log(`문장 교체: ${heroName(h)} ← ${D.crests[el.dataset.t].name}`);
    ev("change");
  },
  // 장비 프리셋
  closePreset() {
    if (anyDirty()) { V.modal = { type: "leave" }; return; }
    V.drafts = {};
    V.screen = "team";
  },
  // 탭이 있는 콘텐츠는 저장 안 한 탭을 모두 저장하고 나간다. 보던 탭은 그대로 둔다.
  saveLeave() {
    const cur = S.deckIdx;
    const targets = dirtyTabs();
    V.drafts[cur] = V.draft;
    targets.forEach((d) => {
      S.deckIdx = d.index;
      V.draft = V.drafts[d.index];
      doSave();
    });
    S.deckIdx = cur;
    V.modal = null;
    V.drafts = {};
    V.draft = {};
    V.screen = "team";
    log(`저장 후 나가기: ${targets.map((d) => d.tab || d.label).join(", ")}`);
  },
  leaveYes() { V.modal = null; V.drafts = {}; V.screen = "team"; log("저장하지 않고 나가기: 화면 값 버림"); },
  selectHero(el) { V.selected = Number(el.dataset.h); V.inspect = V.selected; V.slot = 0; },
  pickSlot(el) {
    const s = Number(el.dataset.s);
    V.slot = s;
    const v = V.draft[V.selected] && V.draft[V.selected][s];
    if (v && info(s, v)) V.itemPop = { s, v };
  },
  itemPop(el) { V.itemPop = { s: Number(el.dataset.s), v: el.dataset.v }; },
  closeItemPop() { V.itemPop = null; },
  nextIssue() {
    const want = bannerState().status;
    if (!want) return;
    const list = deckHeroes().filter((h) => heroStatus(h) === want);
    const i = list.indexOf(V.selected);
    V.selected = list[(i + 1) % list.length];
    V.inspect = V.selected;
  },
  loadAll() {
    if (deckHeroes().every((h) => sameSlots(V.draft[h], actualOf(h)))) {
      log("전체 불러오기: 화면 값과 실제 착용이 같아 반응 없음");
      return;
    }
    deckHeroes().forEach((h) => { V.draft[h] = actualOf(h); });
    ev("load");
    log(`전체 불러오기: 편성 영웅 ${deckHeroes().length}명 (저장 전)`);
  },
  yes() {
    deckHeroes().forEach((h) => { V.draft[h] = actualOf(h); });
    V.modal = null;
    ev("yes");
    log("예: 배치된 영웅의 현재 장비를 화면에 불러옴 (저장 전)");
  },
  no() {
    V.modal = null;
    log("아니오: 빈 화면 유지");
  },
  loadCurrent() {
    const h = V.selected;
    V.draft[h] = actualOf(h);
    // 같은 팀의 다른 영웅 화면 값에 같은 장비가 있으면 그 슬롯을 비운다.
    let cleared = 0;
    deckHeroes().forEach((o) => {
      if (o === h || !V.draft[o]) return;
      [1, 2, 3, 4, 5, 6].forEach((s) => {
        if (V.draft[h][s] && V.draft[o][s] === V.draft[h][s]) { V.draft[o][s] = 0; cleared++; }
      });
    });
    ev("load");
    log(`현재 장비 불러오기: ${heroName(h)} (저장 전)${cleared ? `, 다른 영웅과 겹친 슬롯 ${cleared}칸 비움` : ""}`);
  },
  save() {
    if (!canSave()) { log("저장: 변경 사항 없음, 반응 없음"); return; }
    if (saved()) { V.modal = { type: "overwrite" }; return; }
    doSave();
  },
  overwriteYes() { V.modal = null; doSave(); },
  apply() {
    if (!saved()) { log("장비 적용: 저장된 프리셋 없음, 반응 없음"); return; }
    if (isDirty()) { V.modal = { type: "alert", text: "저장하지 않은 변경 사항이 있습니다.\n저장한 뒤 적용해 주세요." }; return; }
    const plan = buildPlan();
    if (!plan.moves.length && !plan.crests.length) {
      if (plan.missing.length) { toast(MSG_PARTIAL); ev("missing"); log(`장비 적용: 교체할 장비 없음, 삭제된 장비 ${plan.missing.length}개`); return; }
      ev("noop");
      log("장비 적용: 저장값과 실제 착용이 같아 반응 없음");
      return;
    }
    V.modal = { type: "apply", plan };
  },
  applyYes() {
    const { plan } = V.modal;
    plan.moves.forEach((m) => {
      const cur = actualOf(m.h)[m.s];
      if (cur && cur !== m.uid) S.items[cur].owner = 0;
      S.items[m.uid].owner = m.h;
    });
    plan.crests.forEach((c) => { S.crest[c.h] = c.tid; });
    V.modal = null;
    ev("apply");
    log(`장비 적용: 교체 ${plan.moves.length}개, 문장 ${plan.crests.length}개, 유지 ${plan.keep.length}칸, 삭제된 장비 ${plan.missing.length}개`);
    if (plan.missing.length) { ev("missing"); toast(MSG_PARTIAL); } else toast("저장된 장비로 교체했습니다.");
  },
  closeModal() { V.modal = null; },
};

/* 전투 화면은 없으므로 어떤 장비로 시작했는지만 기록한다. */
function startBattle(what) {
  log(`전투 시작: ${deck().label}, ${what}`);
  toast(`${what}로 전투를 시작합니다. (테스트)`);
}
/* 전투 전 확인 팝업의 장비 프리셋 줄. 프리셋을 안 쓰는 유저에게는 팝업을 띄우지 않는다.
   lines는 영웅별로 어느 슬롯이 왜 걸렸는지, kinds는 원인 종류(diff·gone·unset)다. */
function presetCheck() {
  const sv = saved();
  if (!sv) return { text: "미저장", cls: "none", warn: false, lines: [], kinds: [] };
  const by = new Map();
  const kinds = new Set();
  const add = (h, label, kind) => {
    if (!by.has(h)) by.set(h, []);
    by.get(h).push(label);
    kinds.add(kind);
  };
  if (isArena()) {
    deckHeroes().forEach((h) => {
      if (!sv[h]) return;
      [1, 2, 3, 4, 5, 6].forEach((s) => { if (sv[h][s] && !S.items[sv[h][s]]) add(h, `${SLOT_NAME[s]}(저장 장비 분해됨)`, "gone"); });
    });
  } else {
    const plan = buildPlan();
    plan.moves.forEach((m) => add(m.h, SLOT_NAME[m.s], "diff"));
    plan.crests.forEach((c) => add(c.h, SLOT_NAME[7], "diff"));
    plan.missing.forEach((m) => add(m.h, `${SLOT_NAME[m.s]}(저장 장비 분해됨)`, "gone"));
  }
  deckHeroes().forEach((h) => { if (!sv[h]) add(h, "저장 안 함", "unset"); });
  if (!by.size) return { text: isArena() ? "저장됨" : "일치", cls: "ok", warn: false, lines: [], kinds: [] };
  // 프리셋은 필요할 때 쓰는 기능이다. 저장을 안 했거나 편성을 바꾼 것만으로는 전투를 막지 않는다.
  const warn = kinds.has("diff") || (isArena() && kinds.has("gone"));
  const n = by.size;
  const only = kinds.size === 1 ? [...kinds][0] : "";
  const text = only === "gone" ? `영웅 ${n}명 저장 장비 분해됨` : only === "unset" ? `영웅 ${n}명 저장 안 함` : `영웅 ${n}명 다름`;
  // 전투에 영향이 없으면(현재 장비로 그대로 싸움) 상세 줄은 보이지 않는다.
  const lines = warn ? [...by].map(([h, labels]) => `${heroName(h)}: ${labels.join(", ")}`) : [];
  return { text, cls: warn ? "bad" : "none", warn, lines, kinds: [...kinds] };
}
/* 이 값이 그대로면 유저가 이미 확인하고 넘긴 상태로 보고 다시 묻지 않는다. */
function gearSignature() {
  return JSON.stringify([deckHeroes(), deckHeroes().map(actualOf), saved() || null]);
}
const gearAcked = () => S.battleAck[S.deckIdx] === gearSignature();
function preBattleMessage(row) {
  if (deckHeroes().length < deck().max) return "팀 편성이 완료되지 않았습니다.";
  if (isArena()) return "저장한 장비 중 분해된 장비가 있어 그 칸 없이 전투합니다.";
  return "저장된 장비와 현재 장비가 다릅니다.";
}

function doSave() {
  const out = {};
  deckHeroes().forEach((h) => {
    if (!V.draft[h]) return;
    const c = { ...V.draft[h] };
    [1, 2, 3, 4, 5, 6].forEach((s) => { if (c[s] && !S.items[c[s]]) c[s] = 0; });
    out[h] = c;
  });
  delete V.drafts[S.deckIdx];
  const first = !saved();
  const dropped = outOfDeckHeroes();
  S.presets[S.deckIdx] = out;
  S.savedRoster[S.deckIdx] = [...deckHeroes()];
  V.draft = {};
  Object.entries(out).forEach(([h, c]) => { V.draft[h] = { ...c }; });
  ev("save");
  log(`${first ? "저장" : "덮어쓰기"}: 영웅 ${Object.keys(out).length}명${dropped.length ? `, 제외된 영웅 저장값 삭제: ${dropped.map(heroName).join(", ")}` : ""}`);
  toast("프리셋을 저장했습니다.");
}

/* ---------- 화면 ---------- */
function teamScreen() {
  const d = deck();
  const hs = deckHeroes();
  const power = hs.reduce((a, h) => a + (HERO[h].power || 0), 0);
  const sv = saved();
  const tiles = d.cells.map((t) => (t
    ? `<div class="tile"><div data-act="openGear" data-h="${t}" title="장비 교체"><img src="${heroImg(t)}" alt=""><span class="nm">${esc(heroName(t))}</span></div>
         <button class="x" data-act="removeHero" data-h="${t}" title="편성에서 제외">✕</button></div>`
    : `<div class="tile"></div>`)).join("");
  const onDeck = new Set(hs);
  const roster = Object.values(HERO)
    .sort((a, b) => (onDeck.has(b.tid) ? 1 : 0) - (onDeck.has(a.tid) ? 1 : 0) || b.power - a.power)
    .map((h) => `<div class="rcard ${onDeck.has(h.tid) ? "on" : ""}" data-act="toggleHero" data-h="${h.tid}">
        <img src="${heroImg(h.tid)}" alt="">${onDeck.has(h.tid) ? '<span class="chk"></span>' : ""}
        <div class="nm">${esc(h.name)}</div>
        <button class="gearBtn" data-act="openGear" data-h="${h.tid}">장비</button></div>`).join("");
  const pst = sv
    ? `장비 프리셋: <b>저장됨</b> (영웅 ${Object.keys(sv).length}명)${rosterChange() ? "<br>저장 후 편성이 변경됨" : ""}${gearDiffers() ? "<br>저장된 장비와 다름" : ""}`
    : "장비 프리셋: 없음";
  return `<div class="team">
    <div class="topbar">팀 편성</div>
    <div class="power"><small>팀 전투력</small><b>${power.toLocaleString()}</b><br><span class="count">${hs.length}/${d.max}</span></div>
    <div class="hint">판 위의 영웅을 누르면 장비를 바꿀 수 있습니다.<br><br>아래 목록을 누르면 편성에 넣거나 뺍니다.</div>
    <div class="board ${d.max > 9 ? "c4" : "c3"}">${tiles}</div>
    <div class="teamRight">
      <h3>${esc(d.group)}</h3>
      ${d.tab ? `<div class="tabs">${groupDecks().map((g) => `<button class="tab ${g.index === d.index ? "on" : ""}" data-act="teamTab" data-d="${g.index}">${esc(g.tab)}${S.presets[g.index] ? " ✓" : ""}</button>`).join("")}</div>` : ""}
      <div class="pstate">${pst}</div>
      <div class="grow"></div>
      <button class="btn gold" data-act="openPreset">장비 프리셋</button>
      <div class="teamBtnRow"><button class="btn green dim">배치 확인</button><button class="btn gold" data-act="battle">전투 시작</button></div>
    </div>
    <div class="roster" data-keep="roster">${roster}</div>
  </div>`;
}

const STATUS_TAG = {
  unset: '<span class="tag unset">미설정</span>',
  gone: '<span class="tag gone">저장 장비 분해</span>',
  diff: '<span class="tag diff">변경</span>',
  ok: "",
};
function bannerState() {
  const hs = deckHeroes();
  const c = (st) => hs.filter((h) => heroStatus(h) === st).length;
  if (c("unset")) return { status: "unset", text: `장비 미설정 영웅 ${c("unset")}명` };
  if (c("gone")) return { status: "gone", text: `저장 장비가 분해된 영웅 ${c("gone")}명` };
  if (c("diff")) return { status: "diff", text: `현재 장비와 다른 영웅 ${c("diff")}명` };
  if (isDirty()) return { status: "", text: "저장 전 변경 사항이 있습니다" };
  return { status: "", text: isArena() ?"모든 영웅의 장비가 저장되어 있습니다" : "모든 영웅의 장비가 저장값과 같습니다" };
}
function slotHTML(s, v, h, act) {
  const a = actualOf(h);
  const it = info(s, v);
  let inner, cls = "empty", tag = "";
  if (it && it.alive) {
    cls = `g${it.grade}`;
    inner = `<img src="assets/item/${it.icon}.png" alt="">${s < 7 ? `<span class="plus">+${it.lb}</span>` : ""}`;
    if (v !== a[s]) tag = `<span class="tag diff">${isArena() ? "현재와 다름" : "변경"}</span>`;
  } else if (it) {
    inner = "<span>저장 장비<br>분해됨</span>";
    tag = `<span class="tag gone">${isArena() ? "이 칸 없이 전투" : a[s] ? "현재 장비 유지" : "비어 있음"}</span>`;
  } else {
    inner = "<span>비어 있음</span>";
    if (V.draft[h] && a[s] && !isArena()) tag = '<span class="tag keep">현재 유지</span>';
  }
  return `<div class="slotBox" data-act="${act}" data-s="${s}">
      <div class="slot ${cls} ${V.slot === s ? "picked" : ""}">${inner}</div>
      <div class="lb">${SLOT_NAME[s]}</div>${tag}</div>`;
}
function slotInfoText(h) {
  if (!V.draft[h]) return "저장된 장비가 없습니다. [현재 장비 불러오기]로 이 영웅의 현재 장비를 가져올 수 있습니다.";
  if (!V.slot) return "슬롯을 누르면 장비 정보를 볼 수 있습니다.";
  const v = V.draft[h][V.slot];
  const it = info(V.slot, v);
  const a = info(V.slot, actualOf(h)[V.slot]);
  const cur = `현재 착용: ${a ? esc(a.name) : "없음"}`;
  if (!it) return `${SLOT_NAME[V.slot]}: 저장값 비어 있음 · ${isArena() ? "이 칸 없이 전투" : "적용해도 벗기지 않음"} · ${cur}`;
  if (V.slot === 7) return `${esc(it.name)} · TID ${it.tid} · 여러 영웅이 함께 착용 가능 · ${cur}`;
  if (!it.alive) return `${esc(it.name)}: 분해되어 없음 · ${isArena() ? "이 칸 없이 전투" : "적용해도 교체되지 않음"} · ${cur}`;
  const shared = isArena() ? otherTabsUsing(V.slot, v) : [];
  return `${esc(it.name)} · 돌파 ${it.lb} · 품질 ${it.q} · UID ${it.uid} · 위치: ${where(it)} · ${cur}${shared.length ? ` · ${shared.join(", ")}에도 저장됨` : ""}`;
}
/* 프리셋 값이 현재 착용과 다른 슬롯이면 나란히 비교한다. 같으면 null을 돌려 기존 장비 정보를 쓴다. */
function cmpCard(label, s, it, extra) {
  let icon = '<div class="slot empty"><span>없음</span></div>';
  let name = "장비 없음";
  let sub = extra || "";
  if (it && it.alive) {
    icon = `<div class="slot g${it.grade}"><img src="assets/item/${it.icon}.png" alt="">${s < 7 ? `<span class="plus">+${it.lb}</span>` : ""}</div>`;
    name = esc(it.name);
    const stat = s < 7 ? `돌파 ${it.lb} · 품질 ${it.q}` : "등록된 문장";
    sub = extra ? `${stat}<br>${extra}` : stat;
  } else if (it) {
    icon = '<div class="slot empty"><span>분해됨</span></div>';
    name = esc(it.name);
    sub = "저장한 장비가 분해됨";
  }
  const click = it ? `data-act="itemPop" data-s="${s}" data-v="${it.uid || it.tid}"` : "";
  return `<div class="cmpCard ${it ? "click" : ""}" ${click}><div class="cmpLabel">${label}</div><div class="cmpBody">${icon}<div class="cmpText"><b>${name}</b><span>${sub}</span></div></div></div>`;
}
function slotCompareHTML(h) {
  const s = V.slot;
  if (!s || !V.draft[h]) return null;
  const av = actualOf(h)[s] || 0;
  const v = V.draft[h][s] || 0;
  if (v === av) return null;
  const a = info(s, av);
  const it = info(s, v);
  let extra = "";
  let note;
  if (isArena()) {
    if (!it) extra = "프리셋에 저장된 장비 없음";
    else if (it.alive && s < 7) extra = where(it);
    const shared = otherTabsUsing(s, v);
    note = it && it.alive
      ? `결투장은 프리셋 장비로 전투합니다. 실제 착용은 바뀌지 않습니다.${shared.length ? ` ${shared.join(", ")}에도 저장된 장비입니다.` : ""}`
      : "프리셋에 장비가 없어 이 칸 없이 전투합니다. 실제 착용은 바뀌지 않습니다.";
  } else if (!it) {
    extra = "프리셋에 저장된 장비 없음";
    note = "프리셋 칸이 비어 있어 [장비 적용]을 해도 현재 장비를 그대로 둡니다.";
  } else if (!it.alive) {
    note = a ? "프리셋 장비가 없어 [장비 적용]을 해도 현재 장비를 그대로 둡니다." : "프리셋 장비가 없어 [장비 적용]을 해도 이 칸은 비어 있습니다.";
  } else if (s === 7) {
    note = "[장비 적용]을 하면 프리셋 문장으로 바뀝니다. 현재 문장은 사라지지 않습니다.";
  } else {
    extra = where(it);
    const out = a ? `${esc(a.name)}은(는) 가방으로 이동합니다.` : "";
    const from = it.owner ? ` ${esc(heroName(it.owner))}에게서 해제됩니다.` : "";
    note = `[장비 적용]을 하면 프리셋 장비로 교체합니다.${from} ${out}`.trim();
  }
  return `<div class="pInfo cmp"><div class="cmpRow">${cmpCard("현재 착용", s, a)}<div class="cmpArrow">${isArena() ? "≠" : "→"}</div>${cmpCard("프리셋", s, it, extra)}</div><div class="cmpNote">${note}</div></div>`;
}
function presetScreen() {
  const hs = deckHeroes();
  const b = bannerState();
  const h = V.selected;
  const d = V.draft[h];
  const cards = hs.map((t, i) => {
    const st = heroStatus(t);
    const dr = V.draft[t];
    return `<div class="card ${t === h ? "sel" : ""}" data-act="selectHero" data-h="${t}">
      <img src="${heroImg(t)}" alt="">
      <div style="min-width:0"><div class="ct">${String(i + 1).padStart(2, "0")}</div><div class="nm">${esc(heroName(t))}</div>
      <div class="ct">${dr ? `${filled(dr)}/7 ` : ""}${STATUS_TAG[st]}</div></div></div>`;
  }).join("");
  const slots = SLOT_IDS.map((s) => slotHTML(s, d ? d[s] : 0, h, "pickSlot")).join("");
  const allSame = hs.every((t) => sameSlots(V.draft[t], actualOf(t)));
  const dirty = isDirty();
  const plan = buildPlan();
  const canApply = saved() && !dirty && (plan.moves.length || plan.crests.length || plan.missing.length);
  const arena = isArena();
  let msg = arena ? "프리셋을 저장하면 이 장비로 전투합니다. 실제 착용은 바뀌지 않습니다." : "프리셋을 저장하면 이 편성의 장비 상태를 다시 적용할 수 있습니다.";
  if (dirty) msg = "저장하지 않은 변경 사항이 있습니다.";
  else if (arena && saved() && !rosterChange()) msg = "저장된 장비로 전투합니다. 실제 착용은 바뀌지 않습니다.";
  else if (saved() && canApply) msg = "저장된 장비와 현재 장비가 다릅니다. [장비 적용] 또는 [현재 장비 불러오기] 후 저장을 선택할 수 있습니다.";
  else if (saved() && rosterChange()) msg = "저장 후 편성이 변경되었습니다. [전체 불러오기] 후 덮어쓰면 현재 편성 기준으로 저장됩니다.";
  else if (saved()) msg = "저장된 프리셋과 현재 장비가 같습니다.";
  const change = rosterChange();
  const outs = outOfDeckHeroes();
  const changeNote = change
    ? `<div class="fmtNote"><div class="fmtText"><div>저장 후 편성 변경: 추가 ${change.added.length}명, 제외 ${change.removed.length}명</div>${outs.length ? "<div>제외된 영웅의 저장값은 덮어쓰면 삭제됩니다.</div>" : ""}</div>
        ${outs.length ? `<div class="outHeroes">${outs.map((t) => `<img src="${heroImg(t)}" alt="${esc(heroName(t))}" title="${esc(heroName(t))}">`).join("")}</div>` : ""}</div>`
    : "";
  const tabs = deck().tab
    ? `<div class="tabs">${groupDecks().map((g) => `<button class="tab ${g.index === S.deckIdx ? "on" : ""}" data-act="presetTab" data-d="${g.index}">${esc(g.tab)}${dirtyDeck(g.index) ? " *" : S.presets[g.index] ? " ✓" : ""}</button>`).join("")}</div>`
    : "";
  const other = arena ? groupDecks().find((g) => g.index !== S.deckIdx) : null;
  const rightBtn = arena
    ? `<button class="btn line" data-act="copyTeam">${esc(other.tab)}으로 복사</button>`
    : `<button class="btn green ${canApply ? "" : "dim"}" data-act="apply">장비 적용</button>`;
  return `<div class="dimmer"></div><div class="sheet preset ${deck().max > 9 ? "many" : ""}">
    <button class="close" data-act="closePreset">✕</button>
    <div class="pTop"><b>${esc(deck().group)} 장비 프리셋</b>${tabs}<span>참가 영웅 ${hs.length}/${deck().max}</span></div>
    <div class="pLeft">
      <div class="pHead"><div class="banner ${b.status ? "" : "none"}" ${b.status ? 'data-act="nextIssue"' : ""}><span>${b.text}</span>${b.status ? "<span>확인 ›</span>" : ""}</div></div>
      ${changeNote}
      <div class="cards" data-keep="cards">${cards}</div>
      <button class="btn line loadAll ${allSame ? "dim" : ""}" data-act="loadAll">전체 불러오기</button>
    </div>
    <div class="pRight">
      <div class="pHero"><img src="${heroImg(h)}" alt=""><div class="t"><b>${esc(heroName(h))}</b><div>선택한 영웅의 장비</div></div>
        <button class="btn line" data-act="loadCurrent">현재 장비 불러오기</button></div>
      <div class="slots">${slots}</div>
      ${slotCompareHTML(h) || `<div class="pInfo">${slotInfoText(h)}</div>`}
    </div>
    <div class="pFoot"><div class="msg">${msg}</div>
      <button class="btn gold ${canSave() ? "" : "dim"}" data-act="save">${saved() ? "덮어쓰기" : "저장"}</button>
      ${rightBtn}</div>
  </div>`;
}
function gearScreen() {
  const h = V.gearHero;
  const a = actualOf(h);
  const slots = SLOT_IDS.map((s) => {
    const it = info(s, a[s]);
    const inner = it ? `<img src="assets/item/${it.icon}.png" alt="">${s < 7 ? `<span class="plus">+${it.lb}</span>` : ""}` : "<span>비어 있음</span>";
    return `<div class="slotBox" data-act="pickGearSlot" data-s="${s}"><div class="slot ${it ? `g${it.grade}` : "empty"} ${V.gearSlot === s ? "picked" : ""}">${inner}</div><div class="lb">${SLOT_NAME[s]}</div></div>`;
  }).join("");
  let rows;
  const s = V.gearSlot;
  if (s === 7) {
    rows = Object.values(D.crests).map((c) => `<div class="cand click" data-act="itemPop" data-s="7" data-v="${c.tid}"><img src="assets/item/${c.icon}.png" alt=""><div class="c"><b>${esc(c.name)}</b><span>등록된 문장 · 여러 영웅 착용 가능</span></div>
      ${a[7] === c.tid ? '<span class="tag ok">착용 중</span>' : `<button class="mini" data-act="equipCrest" data-t="${c.tid}">장착</button>`}</div>`).join("");
  } else {
    rows = Object.values(S.items)
      .filter((i) => i.slot === s && (s === 1 ? i.htid === h : s === 2 ? i.type === HERO[h].weapon : true))
      .sort((x, y) => (x.owner === h ? -1 : y.owner === h ? 1 : 0) || (x.owner ? 1 : 0) - (y.owner ? 1 : 0) || y.grade - x.grade)
      .map((i) => {
        const up = `<button class="mini" data-act="enhance" data-u="${i.uid}">강화</button>`;
        const btn = i.owner === h
          ? `${up}<button class="mini" data-act="unequip" data-u="${i.uid}">해제</button>`
          : `${up}<button class="mini" data-act="equip" data-u="${i.uid}">장착</button>${i.owner ? "" : `<button class="mini red" data-act="scrap" data-u="${i.uid}">분해</button>`}`;
        return `<div class="cand click" data-act="itemPop" data-s="${i.slot}" data-v="${i.uid}"><img src="assets/item/${i.icon}.png" alt=""><div class="c"><b>${esc(i.name)}${i.test ? " (테스트 장비)" : ""}</b><span>${where(i)} · 돌파 ${i.lb} · 품질 ${i.q}</span></div>${btn}</div>`;
      }).join("");
  }
  return `<div class="dimmer"></div><div class="sheet gear">
    <button class="close" data-act="closeGear">✕</button>
    <div class="gLeft">
      <div class="pHero" style="padding-right:0"><img src="${heroImg(h)}" alt=""><div class="t"><b>${esc(heroName(h))}</b><div>실제 착용 중인 장비 (게임의 영웅 장비 화면 역할)</div></div></div>
      <div class="slots" style="grid-template-columns:repeat(4,104px)">${slots}</div>
      <div class="pInfo" style="position:static;margin-top:18px">착용 중인 장비는 분해할 수 없습니다. 해제해서 가방으로 옮긴 뒤 분해하세요. 다른 영웅의 장비를 고르면 그 영웅에게서 해제됩니다.</div>
    </div>
    <div class="gRight"><h4>${SLOT_NAME[s]} 교체</h4><div class="cands" data-keep="cands">${rows || '<div class="cand">교체할 수 있는 장비가 없습니다.</div>'}</div></div>
  </div>`;
}
/* 게임 설명 문구의 줄바꿈과 [#색상] 태그를 화면용으로 바꾼다. */
function richText(t) {
  return esc(t).replace(/\\n|\n/g, "<br>")
    .replace(/\[#([0-9a-fA-F]{6})\]((?:(?!\[#).)*)(?:\[#\])?/g, '<span style="color:#$1">$2</span>');
}
function itemPopHTML() {
  if (!V.itemPop) return "";
  const { s, v } = V.itemPop;
  const it = info(s, v);
  if (!it) return "";
  const stars = "★".repeat(it.grade || 0);
  const label = (it.grade >= 7 && s < 7 ? "각성" : `★${it.grade}`);
  const owner = s < 7 && it.alive && it.owner
    ? `<img src="${heroImg(it.owner)}" alt=""><span>${esc(heroName(it.owner))} 장착 중</span>`
    : `<span>${s === 7 ? "등록된 문장 · 여러 영웅이 함께 착용 가능" : it.alive ? "장착 중인 영웅 없음 (가방)" : "분해되어 사라진 장비입니다"}</span>`;
  const meta = s < 7 && it.power ? `<div class="ipMeta"><b>장비 위력</b><i>${it.power}</i><em></em><b>티어</b><i>${it.tier}</i></div>` : "";
  const reroll = s < 7 && it.reroll ? `<div class="ipMeta bar"><b>남은 변환 횟수</b><i>${it.reroll}</i></div>` : "";
  const grow = s < 7 ? `<div class="ipGrow">돌파 ${it.lb} · 품질 ${it.q}${it.test ? " · 테스트 장비" : ""}</div>` : "";
  let awake = "";
  if (s < 7 && it.grade >= 7) {
    const rows = [0, 1].map((k) => (it.awake[k]
      ? `<div class="ipOpt on"><span class="ipOrb"></span><span>${esc(it.awake[k].n)}</span><i>Lv.${it.awake[k].lv}</i></div>`
      : '<div class="ipOpt"><span class="ipLock">🔒</span><span>아직 해당 슬롯이 개방되지 않았습니다.</span></div>')).join("");
    awake = `<h5>각성 옵션</h5>${rows}`;
  }
  const base = s < 7 ? (it.base || []).map((b) => `<div class="ipBase"><span>${b.n}</span><i>${b.v}${b.u}</i></div>`).join("") : "";
  const rnd = s < 7 ? (it.rnd || []).map((b) => `<div class="ipRnd"><span class="ipOrb"></span><span>${b.n}</span><em class="u${b.ui}">★</em><i>${b.v}${b.u}</i></div>`).join("") : "";
  return `<div class="ipDim" data-act="closeItemPop"></div><div class="sheet itemPop">
    <button class="close" data-act="closeItemPop">✕</button>
    <div class="ipScroll" data-keep="itemPop">
      <div class="ipHead"><div class="ipIcon g${it.grade}"><img src="assets/item/${it.icon}.png" alt=""><div class="ipStars">${stars}</div></div>
        <div class="ipTitle"><h4>${esc(it.name)}</h4><div class="ipSub">${esc(it.tname || "")}<span></span><b>${label}</b></div>${meta}${reroll}</div></div>
      <div class="ipDesc">${richText(it.desc || "")}</div>
      ${grow}
      <div class="ipSec">장착 효과</div>
      <div class="ipOwner">${owner}</div>
      ${awake}${base}${rnd}
    </div></div>`;
}
function modalHTML() {
  const m = V.modal;
  if (!m) return "";
  let body = "";
  if (m.type === "noPreset") {
    body = `<p>${MSG_NO_PRESET}</p><div class="row"><button class="btn line" data-act="no">아니오</button><button class="btn gold" data-act="yes">예</button></div>`;
  } else if (m.type === "overwrite") {
    const outs = outOfDeckHeroes();
    body = `<p>저장된 프리셋을 현재 화면 내용으로 덮어쓰시겠습니까?</p>${outs.length ? `<div class="sub">편성에서 제외된 영웅 ${outs.length}명의 저장값이 삭제됩니다.</div><ul>${outs.map((t) => `<li>${esc(heroName(t))}</li>`).join("")}</ul>` : ""}<div class="row"><button class="btn line" data-act="closeModal">취소</button><button class="btn gold" data-act="overwriteYes">덮어쓰기</button></div>`;
  } else if (m.type === "leave") {
    const tabs = dirtyTabs();
    const outs = tabs.flatMap((d) => Object.keys(S.presets[d.index] || {}).map(Number).filter((h) => !S.decks[d.index].cells.includes(h)));
    const names = [...new Set(outs)].map((t) => esc(heroName(t))).join(", ");
    body = `<p>변경 사항이 저장되지 않았습니다.\n정말로 나가시겠습니까?</p>
      ${tabs.length > 1 ? `<div class="sub">저장 안 한 탭: ${tabs.map((d) => esc(d.tab)).join(", ")}</div>` : ""}
      ${names ? `<div class="sub">저장하면 편성에서 제외된 영웅의 저장값이 삭제됩니다: ${names}</div>` : ""}
      <div class="row"><button class="btn line" data-act="closeModal">취소</button><button class="btn line" data-act="leaveYes">나가기</button><button class="btn gold" data-act="saveLeave">저장 후 나가기</button></div>`;
  } else if (m.type === "alert") {
    body = `<p>${esc(m.text)}</p><div class="row"><button class="btn gold" data-act="closeModal">확인</button></div>`;
  } else if (m.type === "copy") {
    const to = S.decks[m.to];
    body = `<p>${esc(deck().tab)} 장비를 ${esc(to.tab)}으로 복사하시겠습니까?\n편성은 바뀌지 않고, 저장해야 확정됩니다.</p>
      <div class="sub">같은 영웅 ${m.hit.length}명 복사</div><ul>${m.hit.map((t) => `<li>${esc(heroName(t))}</li>`).join("")}</ul>
      ${m.skip.length ? `<div class="sub">${esc(to.tab)}에 없어 제외 ${m.skip.length}명: ${m.skip.map((t) => esc(heroName(t))).join(", ")}</div>` : ""}
      <div class="row"><button class="btn line" data-act="closeModal">취소</button><button class="btn gold" data-act="copyYes">복사</button></div>`;
  } else if (m.type === "preBattle") {
    const n = deckHeroes().length;
    const row = presetCheck();
    const line = (name, text, cls) => `<div class="pbRow"><b>${name}</b><span class="${cls}">${text}</span></div>`;
    const LIMIT = 4;
    const shown = row.lines.slice(0, LIMIT).map((t) => `<div>· ${esc(t)}</div>`).join("");
    const more = row.lines.length > LIMIT ? `<div>· 외 ${row.lines.length - LIMIT}명</div>` : "";
    const detail = shown ? `<div class="pbDetail">${shown}${more}</div>` : "";
    body = `<div class="pbTitle">알림</div><p>${preBattleMessage(row)}\n이대로 전투를 시작하시겠습니까?</p>
      <div class="pbRows">${line("팀 편성", `${n}/${deck().max}`, n >= deck().max ? "ok" : "bad")}${line("앙상블", "장착중", "ok")}${line("공진 태엽", "장착중", "ok")}${line("장비 프리셋", row.text, row.cls)}${detail}</div>
      ${gearDiffers()
    ? '<div class="row"><button class="btn line" data-act="closeModal">팀 편성</button><button class="btn line" data-act="battleGo">현재 장비로 전투</button><button class="btn gold" data-act="battleApply">적용 후 전투</button></div>'
    : '<div class="row"><button class="btn gold" data-act="battleGo">전투 시작</button><button class="btn line" data-act="closeModal">팀 편성</button></div>'}`;
  } else if (m.type === "apply") {
    const p = m.plan;
    const list = p.moves.map((x) => `<li>${esc(heroName(x.h))} ${SLOT_NAME[x.s]}: ${esc(x.name)}${x.from ? ` <b>(${esc(heroName(x.from))}에게서 해제)</b>` : ""}</li>`)
      .concat(p.crests.map((x) => `<li>${esc(heroName(x.h))} 문장: ${esc(D.crests[x.tid].name)}</li>`))
      .concat(p.missing.map((x) => `<li>${esc(heroName(x.h))} ${SLOT_NAME[x.s]}: ${esc(x.name)} 없음, 현재 장비 유지</li>`));
    body = `<p>저장된 장비로 실제 교체합니다.</p><ul>${list.join("")}</ul>
      <div class="row"><button class="btn line" data-act="closeModal">취소</button><button class="btn green" data-act="applyYes">적용</button></div>`;
  }
  return `<div class="dimmer" style="z-index:30"></div><div class="sheet modal" style="z-index:31">${body}</div>`;
}
function sidePanel() {
  const groups = D.decks.filter((d, i) => D.decks.findIndex((x) => x.group === d.group) === i);
  const opts = groups.map((d) => {
    const members = D.decks.filter((x) => x.group === d.group);
    const n = members.filter((x) => S.presets[x.index]).length;
    return `<option value="${d.group === deck().group ? S.deckIdx : d.index}" ${d.group === deck().group ? "selected" : ""}>${esc(d.group)}${n ? (members.length > 1 ? ` · 저장 ${n}/${members.length}` : " · 저장됨") : ""}</option>`;
  }).join("");
  const steps = (isArena() ? ARENA_STEPS : STEPS).map(([k, t]) => `<div class="step ${V.done.has(k) ? "done" : ""}"><i>${V.done.has(k) ? "✓" : ""}</i><span>${esc(t)}</span></div>`).join("");
  const h = V.screen === "preset" ? V.selected : V.screen === "gear" ? V.gearHero : (V.inspect && HERO[V.inspect] ? V.inspect : deckHeroes()[0]);
  let tbl = '<div class="note">편성된 영웅이 없습니다.</div>';
  if (h) {
    const a = actualOf(h);
    const sv = saved() ? saved()[h] : null;
    const dr = V.screen === "preset" ? V.draft[h] : null;
    const short = (s, v) => {
      if (!v) return "-";
      const it = info(s, v);
      if (!it) return String(v);
      return `${esc(it.name)}${it.alive ? "" : " (분해됨)"}`;
    };
    const rows = SLOT_IDS.map((s) => {
      const cls = (v) => {
        if (!v) return "";
        const it = info(s, v);
        if (it && !it.alive) return "g";
        return v !== a[s] ? "d" : "";
      };
      return `<tr><th>${SLOT_NAME[s]}</th><td>${short(s, a[s])}</td>
        <td class="${cls(dr && dr[s])}">${V.screen === "preset" ? (dr ? short(s, dr[s]) : "미설정") : "·"}</td>
        <td class="${cls(sv && sv[s])}">${sv ? short(s, sv[s]) : "없음"}</td></tr>`;
    }).join("");
    tbl = `<div class="note" style="margin-bottom:4px">${esc(deck().label)} · ${esc(heroName(h))} · 주황 = 실제 착용과 다름, 빨강 = 분해됨${isArena() ? " · 전투 장비 = 저장값" : ""}</div>
      <table class="tbl"><tr><th>슬롯</th><th>실제 착용</th><th>화면 값</th><th>저장값</th></tr>${rows}</table>`;
  }
  const logs = V.log.map((l) => `<div><span>${l.t}</span>${esc(l.msg)}</div>`).join("");
  return `<h2>테스트 도구</h2>
    <div class="note">게임 화면이 아닌 확인용 패널입니다. 상태는 새로 고치면 처음으로 돌아갑니다.</div>
    <div class="variant">${["A", "B"].map((v) => `<button class="${v === VARIANT ? "on" : ""}" data-act="variant" data-v="${v.toLowerCase()}">${v}안</button>`).join("")}<p>${VARIANT_RULE[VARIANT]}</p></div>
    <div class="ctl"><select data-change="deck">${opts}</select><button class="reset" data-act="reset">처음부터</button></div>
    <h3>진행 순서 (자동 체크)</h3>${steps}
    <h3>세 값 비교</h3>${tbl}
    <h3>동작 기록</h3><div id="log" data-keep="log">${logs}</div>`;
}

function render() {
  const keep = {};
  document.querySelectorAll("[data-keep]").forEach((e) => { keep[e.dataset.keep] = [e.scrollLeft, e.scrollTop]; });
  let html = teamScreen();
  if (V.screen === "preset") html += presetScreen();
  if (V.screen === "gear") html += gearScreen();
  html += itemPopHTML();
  html += modalHTML();
  if (V.toast) html += `<div class="toast">${esc(V.toast)}</div>`;
  stage.innerHTML = html;
  side.innerHTML = sidePanel();
  document.querySelectorAll("[data-keep]").forEach((e) => {
    const k = keep[e.dataset.keep];
    if (k) { e.scrollLeft = k[0]; e.scrollTop = k[1]; }
  });
}
function fit() {
  const stacked = window.innerWidth <= 1040;
  const availW = stageBox.parentElement.clientWidth;
  const availH = stacked ? Infinity : window.innerHeight - 24;
  const sc = Math.min(availW / 1280, availH / 720);
  stage.style.transform = `scale(${sc})`;
  stageBox.style.width = `${1280 * sc}px`;
  stageBox.style.height = `${720 * sc}px`;
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  ACT[t.dataset.act](t);
  render();
});
document.addEventListener("change", (e) => {
  const t = e.target.closest("[data-change]");
  if (!t) return;
  ACT[t.dataset.change](t);
  render();
});
window.addEventListener("resize", fit);

// 화면을 통째로 다시 그리므로 아이콘을 미리 받아 깜빡임을 없앤다.
window.PRELOAD = [
  ...Object.values(HERO).map((h) => `assets/hero/${h.icon}.png`),
  ...D.items.map((i) => `assets/item/${i.icon}.png`),
  ...Object.values(D.crests).map((c) => `assets/item/${c.icon}.png`),
].filter((u, i, a) => a.indexOf(u) === i).map((u) => { const m = new Image(); m.src = u; return m; });

fresh();
render();
fit();
