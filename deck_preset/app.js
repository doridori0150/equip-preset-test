"use strict";
// 장비 프리셋 + 편성 저장 시안. 장비 프리셋 테스트 화면에 편성(인원·위치) 저장을 더했다.
//   실제 착용·편성 → [가져오기] → 화면 값(V.draft, V.form) → [저장] → 저장값(S.presets, S.forms) → [프리셋 불러오기] → 실제 착용·편성
// 편성은 프리셋 값이 아니라 현재 상태다. 영웅을 넣고 빼도 프리셋은 그대로 두고, 다르면 [편성 비교]에 보여 준다.
const D = window.PRESET_DATA;
/* 길드 레이드·거울의 환영: 덱 1/2/3끼리 영웅을 함께 쓸 수 없다. 적용할 때 다른 덱에서 빼 오고, 이미 사용한 영웅은 빼고 빈 칸으로 둔다.
   계정 데이터에 이 덱이 없어 테스트용 편성을 만든다. */
const NO_DUP = new Set(["길드 레이드", "거울의 환영"]);
const BY_POWER = Object.values(D.heroes).sort((a, b) => b.power - a.power).map((h) => h.tid);
const ADV1 = D.decks.find((d) => d.index === 1).cells;
function mockDeck(index, group, tab, heroes, at) {
  const cells = Array(9).fill(0);
  heroes.forEach((h, i) => { cells[at[i]] = h; });
  return { index, label: `${group} ${tab}`, group, tab, mode: "swap", max: 6, cells };
}
const pickHeroes = (skip, n) => BY_POWER.filter((h) => !skip.includes(h)).slice(0, n);
const G2 = pickHeroes(ADV1, 6), G3 = pickHeroes([...ADV1, ...G2], 5), M1 = pickHeroes([], 6), M2 = pickHeroes(M1, 6);
const DECKS = D.decks.concat([
  { ...mockDeck(9001, "길드 레이드", "덱 1", [], []), cells: [...ADV1] },
  mockDeck(9002, "길드 레이드", "덱 2", G2, [0, 1, 2, 3, 5, 7]),
  mockDeck(9003, "길드 레이드", "덱 3", G3, [1, 3, 4, 5, 7]),
  mockDeck(9101, "거울의 환영", "덱 1", M1, [0, 2, 3, 4, 6, 8]),
  mockDeck(9102, "거울의 환영", "덱 2", M2, [0, 1, 2, 4, 6, 7]),
  mockDeck(9103, "거울의 환영", "덱 3", [], []),
]);
const HERO = D.heroes;
const SLOT_IDS = [1, 2, 3, 4, 5, 6, 7, 8];
const SLOT_NAME = D.slots;
const MSG_PARTIAL = "프리셋의 일부 장비가 존재하지 않아 일부 장비가 교체되지 않았습니다.";
const MSG_NO_PRESET = "현재 저장된 프리셋이 없습니다.\n현재 편성과 장비를 가져오시겠습니까?";
const stage = document.getElementById("stage");
const stageBox = document.getElementById("stageBox");
const side = document.getElementById("side");

let S, V;

function fresh() {
  const items = {};
  D.items.forEach((i) => { items[i.uid] = { ...i }; });
  const crest = {};
  const wisdom = {};
  Object.values(HERO).forEach((h) => { crest[h.tid] = h.crest || 0; wisdom[h.tid] = h.wisdom || 0; });
  const decks = {};
  DECKS.forEach((d) => { decks[d.index] = { ...d, cells: [...d.cells] }; });
  S = { items, deleted: {}, crest, decks, wisdom, presets: {}, forms: {}, used: {}, conflict: {}, battleAck: {}, deckIdx: DECKS[0].index };
  V = { screen: "team", draft: {}, form: null, view: "gear", drafts: {}, selected: 0, slot: 0, gearHero: 0, gearSlot: 2, modal: null, toast: "", inspect: 0,
        done: new Set(), loadedAfterChange: false, log: [] };
  log("테스트 시작: 계정 데이터 불러옴");
}

/* ---------- 데이터 조회 ---------- */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const deck = () => S.decks[S.deckIdx];
const deckHeroes = () => deck().cells.filter(Boolean);
const heroName = (t) => (HERO[t] ? HERO[t].name : "-");
const heroImg = (t) => `../assets/hero/${HERO[t].icon}.png`;
const saved = () => S.presets[S.deckIdx];
const isArena = () => deck().mode === "arena";
const groupDecks = () => DECKS.filter((d) => d.group === deck().group);
const arenaDecks = () => DECKS.filter((d) => d.mode === "arena");
const heroesIn = (cells) => (cells || []).filter(Boolean);
const savedForm = () => S.forms[S.deckIdx] || null;
const draftForm = () => V.form || savedForm();
const sameCells = (a, b) => (!a && !b) || (!!a && !!b && a.length === b.length && a.every((h, i) => h === b[i]));
const noDup = () => NO_DUP.has(deck().group);
const isUsed = (h) => noDup() && !!S.used[deck().group] && S.used[deck().group].has(h);
function otherDeckOf(h, idx = S.deckIdx) {
  if (!noDup()) return null;
  return groupDecks().map((d) => S.decks[d.index]).find((d) => d.index !== idx && d.cells.includes(h)) || null;
}
/* 프리셋 창의 영웅 목록은 지금 편성 영웅만. 편성에서 뺀 영웅은 보여 주지 않고, 불러올 때 확인 팝업의 편성 비교에서 보인다. */
function listHeroes() {
  return deckHeroes();
}
/* 편성 차이. apply면 지금 편성 → 프리셋 편성으로 바꿀 때의 계획(다른 덱에서 빼 옴, 사용 완료 제외)까지 담는다. */
function formCompare(from, to, apply) {
  if (!from || !to) return null;
  const r = { add: [], out: [], move: [], pull: [], locked: [] };
  to.forEach((h, i) => {
    if (!h) return;
    const j = from.indexOf(h);
    if (j < 0) {
      if (apply && isUsed(h)) { r.locked.push({ h, i }); return; }
      r.add.push({ h, i });
      const o = apply ? otherDeckOf(h) : null;
      if (o) r.pull.push({ h, i, from: o });
    } else if (j !== i) r.move.push({ h, from: j, to: i });
  });
  from.forEach((h, j) => { if (h && !to.includes(h)) r.out.push({ h, j }); });
  r.same = !r.add.length && !r.out.length && !r.move.length && !r.locked.length;
  return r;
}
const SAME_FORM = { add: [], out: [], move: [], pull: [], locked: [], same: true };
const applyForm = () => formCompare(deck().cells, savedForm(), true) || SAME_FORM;
const viewForm = () => formCompare(deck().cells, draftForm(), true);
function formSummary(r) {
  const p = [];
  if (r.add.length) p.push(`추가 ${r.add.length}`);
  if (r.out.length) p.push(`제외 ${r.out.length}`);
  if (r.move.length) p.push(`이동 ${r.move.length}`);
  if (r.pull.length) p.push(`다른 덱에서 ${r.pull.length}`);
  if (r.locked.length) p.push(`사용 완료 ${r.locked.length}`);
  return p.join(" · ");
}
const cellNo = (i) => `${i + 1}번`;
function loadFormAndGear() {
  V.form = [...deck().cells];
  V.draft = {};
  deckHeroes().forEach((h) => { V.draft[h] = actualOf(h); });
}
function draftFromSaved(idx) {
  const sv = S.presets[idx];
  const out = {};
  if (sv) Object.keys(sv).forEach((h) => { out[h] = { ...sv[h] }; });
  return out;
}
/* 같은 묶음의 다른 탭에 저장된 장비인지. 결투장은 공격·방어에 같은 장비를 함께 쓸 수 있다. */
function otherTabsUsing(s, uid) {
  if (!uid) return [];
  return groupDecks().filter((d) => d.index !== S.deckIdx && Object.values(S.presets[d.index] || {}).some((p) => p[s] === uid)).map((d) => d.tab);
}

function actualOf(h) {
  const r = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: S.crest[h] || 0, 8: S.wisdom[h] || 0 };
  Object.values(S.items).forEach((i) => { if (i.owner === h) r[i.slot] = i.uid; });
  return r;
}
function info(s, v) {
  if (!v) return null;
  if (s === 7) return D.crests[v] ? { ...D.crests[v], alive: true } : null;
  if (s === 8) return D.wisdoms[v] ? { ...D.wisdoms[v], alive: true } : null;
  if (S.items[v]) return { ...S.items[v], alive: true };
  return S.deleted[v] ? { ...S.deleted[v], alive: false } : null;
}
function where(it) {
  return it.owner ? `${heroName(it.owner)} 착용 중` : "가방";
}
const s7value = (s, v) => (s >= 7 ? Number(v) : v);
function sameSlots(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return SLOT_IDS.every((s) => (a[s] || 0) === (b[s] || 0));
}
function heroStatus(h) {
  const d = V.draft[h];
  const f = draftForm();
  if (f && !f.includes(h)) return "notin";
  if (!d) return "unset";
  const a = actualOf(h);
  let gone = false, diff = false, removed = false;
  SLOT_IDS.forEach((s) => {
    const v = d[s];
    if (!v) return;
    if (s < 7 && !S.items[v]) gone = true;
    else if (!a[s]) removed = true;
    else if (v !== a[s]) diff = true;
  });
  if (removed && !isArena()) return gone ? "gone" : "removed";
  // 결투장은 저장값으로 전투하므로 실제 착용과 달라도 문제가 아니다.
  return gone ? "gone" : diff && !isArena() ? "diff" : "ok";
}
const filled = (d) => SLOT_IDS.filter((s) => d[s] && (s >= 7 || S.items[d[s]])).length;
/* 저장값과 비교해 영웅별로 빠진 칸(제거)과 바뀐 칸(변경)을 센다. */
function gearChanges(h) {
  const d = V.draft[h];
  if (!d) return { removed: 0, changed: 0 };
  const a = actualOf(h);
  let removed = 0, changed = 0;
  SLOT_IDS.forEach((s) => {
    const v = d[s];
    if (!v || (s < 7 && !S.items[v])) return;
    if (!a[s]) removed++;
    else if (v !== a[s]) changed++;
  });
  return { removed, changed };
}
function isDirty() {
  const sv = saved() || {};
  if (!sameCells(V.form, savedForm())) return true;
  return heroesIn(draftForm()).some((h) => !sameSlots(V.draft[h], sv[h]));
}
function dirtyDeck(idx) {
  if (idx === S.deckIdx) return V.screen === "preset" && isDirty();
  const t = V.drafts[idx];
  if (!t) return false;
  const sv = S.presets[idx] || {};
  if (!sameCells(t.form, S.forms[idx] || null)) return true;
  return heroesIn(t.form).some((h) => !sameSlots(t.draft[h], sv[h]));
}
const anyDirty = () => groupDecks().some((d) => dirtyDeck(d.index));
const dirtyTabs = () => groupDecks().filter((d) => dirtyDeck(d.index));
/* 화면은 저장값 그대로인데 실제 착용이나 편성만 달라진 상태. 이때 왼쪽 버튼은 [현재 장비로 저장]이 된다. */
function differsFromActual() {
  const sv = saved();
  if (!sv || isDirty()) return false;
  return !sameCells(savedForm(), deck().cells) || deckHeroes().some((h) => !sameSlots(sv[h], actualOf(h)));
}
function saveCurrentLines() {
  const sv = saved();
  const out = [];
  const fc = formCompare(savedForm(), deck().cells, false);
  if (fc && !fc.same) {
    if (fc.add.length) out.push(`편성 추가: ${fc.add.map((x) => `${heroName(x.h)}(${cellNo(x.i)})`).join(", ")}`);
    if (fc.out.length) out.push(`편성 제외: ${fc.out.map((x) => heroName(x.h)).join(", ")}`);
    if (fc.move.length) out.push(`자리 이동: ${fc.move.map((x) => `${heroName(x.h)} ${cellNo(x.from)} → ${cellNo(x.to)}`).join(", ")}`);
  }
  const nameOf = (s, v) => { const it = info(s, v); return it ? `${it.name}${s < 7 && it.alive ? ` +${it.lb}` : ""}` : "없음"; };
  deckHeroes().forEach((h) => {
    if (!sv[h]) { out.push(`${heroName(h)}: 새로 저장`); return; }
    const a = actualOf(h);
    SLOT_IDS.forEach((s) => {
      if ((sv[h][s] || 0) !== (a[s] || 0)) out.push(`${heroName(h)} ${SLOT_NAME[s]}: ${nameOf(s, sv[h][s])} → ${nameOf(s, a[s])}`);
    });
  });
  return out;
}
const canSave = () => Object.keys(V.draft).length > 0 && isDirty();
function gearDiffers() {
  if (isArena() || !saved() || !sameCells(savedForm(), deck().cells)) return false;
  const plan = buildPlan();
  return plan.moves.length > 0 || plan.crests.length > 0;
}
/* 저장값은 팀 프리셋 + 영웅 단위로 남는다. 빠져도 지우지 않고, 돌아오면 복원한다.
   처음 들어온 영웅은 현재 장비로 저장한다. 팀원과 겹치는 장비는 들어온 영웅 쪽 슬롯을 비운다. */
function syncPresetRoster(h, joined) {
  // 편성은 현재 상태라 프리셋을 바꾸지 않는다. 다르면 [편성 비교]와 배너에 보여 준다.
  if (saved()) log(`편성 ${joined ? "추가" : "제외"}: ${heroName(h)} (프리셋은 그대로)`);
}

/* 저장값 → 실제 착용 계획. 빈 값과 삭제된 장비는 벗기지 않고 현재 장비를 유지한다. */
function buildPlan() {
  const sv = saved();
  const plan = { moves: [], crests: [], missing: [], keep: [], form: SAME_FORM };
  if (!sv) return plan;
  plan.form = applyForm();
  // 적용하면 편성이 프리셋 편성으로 바뀌므로, 장비는 프리셋 편성 영웅 기준으로 계획한다 (사용 완료로 빠지는 영웅 제외).
  const hs = savedForm() ? heroesIn(savedForm()).filter((h) => !plan.form.locked.some((x) => x.h === h)) : deckHeroes();
  hs.forEach((h) => {
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
    [7, 8].forEach((s) => { if (p[s] && p[s] !== a[s]) plan.crests.push({ h, s, tid: p[s] }); });
  });
  return plan;
}

/* ---------- 체크리스트 ---------- */
const STEPS = [
  ["s1", "1. 팀 편성에서 [장비 프리셋] 누르기"],
  ["s2", "2. 빈 화면 확인"],
  ["s3", "3. 안내 팝업 확인"],
  ["s4", "4. 예 → 현재 편성과 장비 가져오기"],
  ["s5", "5. [저장] 눌러 프리셋 저장"],
  ["s6", "6. [프리셋 불러오기] → 반응 없음"],
  ["s7", "7. 편성 또는 장비 교체"],
  ["s8", "8. [장비 프리셋] 다시 열기"],
  ["s9a", "9-1. 현재 장비 가져오기 → 저장"],
  ["s9b", "9-2. 프리셋 불러오기"],
  ["sx", "추가. 저장된 장비를 분해한 뒤 프리셋 불러오기 → 안내 문구"],
  ["st", "추가. 저장값과 장비가 다른 팀으로 [전투 시작] → 안내 팝업"],
];
const FORM_STEPS = [
  ["f1", "편성. 프리셋 저장 후 편성을 바꾸고 다시 열기 (배너, 프리셋에 없음 태그)"],
  ["f2", "편성. [프리셋 불러오기]로 편성과 장비를 함께 되돌리기"],
];
const LOCK_STEPS = [
  ["f3", "길드. 덱 1 영웅을 덱 2로 옮긴 뒤 덱 1 불러오기 → 빼 옴"],
  ["f4", "길드. 빠진 영웅을 사용 완료로 표시 → 불러오기에서 제외"],
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
    V.swap = null;
    V.screen = "team";
    V.inspect = 0;
    log(`덱 변경: ${deck().group}`);
  },
  // 팀을 바꿔도 장비는 바꾸지 않고 묻지도 않는다. 저장값과 다르면 [전투 시작]에서 묻는다.
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
    V.drafts[S.deckIdx] = { draft: V.draft, form: V.form };
    S.deckIdx = idx;
    const t = V.drafts[idx];
    V.draft = t ? t.draft : draftFromSaved(idx);
    V.form = t ? t.form : savedForm() ? [...savedForm()] : null;
    V.selected = listHeroes()[0];
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
    V.form = savedForm() ? [...savedForm()] : null;
    V.selected = listHeroes()[0];
    if (saved() && !applyForm().same) V.done.add("f1");
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
    placeHero(t, -1);
    return;
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
  equipWisdom(el) {
    const h = V.gearHero;
    S.wisdom[h] = Number(el.dataset.t);
    log(`지식 교체: ${heroName(h)} ← ${D.wisdoms[el.dataset.t].name}`);
    ev("change");
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
    V.drafts[cur] = { draft: V.draft, form: V.form };
    targets.forEach((d) => {
      S.deckIdx = d.index;
      V.draft = V.drafts[d.index].draft;
      V.form = V.drafts[d.index].form;
      doSave();
    });
    S.deckIdx = cur;
    V.modal = null;
    V.drafts = {};
    V.draft = {};
    V.form = null;
    V.screen = "team";
    log(`저장 후 나가기: ${targets.map((d) => d.tab || d.label).join(", ")}`);
  },
  leaveYes() { V.modal = null; V.drafts = {}; V.screen = "team"; log("저장하지 않고 나가기: 화면 값 버림"); },
  selectHero(el) { V.selected = Number(el.dataset.h); V.inspect = V.selected; V.slot = 0; },
  // 슬롯을 누르면 교체 팝업. [교체]는 실제 장비를 바꾼다. 프리셋은 [현재 장비로 저장]으로 따로 남긴다.
  pickSlot(el) {
    const s = Number(el.dataset.s);
    const h = V.selected;
    V.slot = s;
    V.swap = { h, s, pick: actualOf(h)[s] || 0, hideWorn: false, asc: false };
  },
  closeSwap() { V.swap = null; },
  swapPick(el) { V.swap.pick = s7value(V.swap.s, el.dataset.v); },
  swapHide() { V.swap.hideWorn = !V.swap.hideWorn; },
  swapSort() { V.swap.asc = !V.swap.asc; },
  swapDo() {
    const { h, s, pick } = V.swap;
    if (s < 7 && S.items[pick].owner && S.items[pick].owner !== h) { V.modal = { type: "swapConfirm" }; return; }
    doSwap();
  },
  swapConfirmYes() { V.modal = null; doSwap(); },
  swapClear() {
    const { h, s, pick } = V.swap;
    S.items[pick].owner = 0;
    log(`실제 장비 해제: ${heroName(h)} ${SLOT_NAME[s]}`);
    ev("change");
    V.swap = null;
  },
  itemPop(el) { V.itemPop = { s: Number(el.dataset.s), v: el.dataset.v }; },
  closeItemPop() { V.itemPop = null; },
  nextIssue() {
    const want = bannerState().status;
    if (!want) return;
    if (want === "form") {
      const f = draftForm();
      const list = listHeroes().filter((x) => !deck().cells.includes(x) || !f.includes(x));
      V.selected = list[(list.indexOf(V.selected) + 1) % list.length] || V.selected;
      V.inspect = V.selected;
      return;
    }
    const list = deckHeroes().filter((h) => heroStatus(h) === want);
    const i = list.indexOf(V.selected);
    V.selected = list[(i + 1) % list.length];
    V.inspect = V.selected;
  },
  loadAll() {
    if (sameCells(V.form, deck().cells) && deckHeroes().every((h) => sameSlots(V.draft[h], actualOf(h)))) {
      log("전체 가져오기: 화면 값과 실제 착용이 같아 반응 없음");
      return;
    }
    loadFormAndGear();
    ev("load");
    log(`전체 가져오기: 편성과 영웅 ${deckHeroes().length}명 장비 (저장 전)`);
  },
  yes() {
    loadFormAndGear();
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
    log(`현재 장비 가져오기: ${heroName(h)} (저장 전)${cleared ? `, 다른 영웅과 겹친 슬롯 ${cleared}칸 비움` : ""}`);
  },
  save() {
    if (!canSave()) { log("저장: 변경 사항 없음, 반응 없음"); return; }
    if (saved()) { V.modal = { type: "overwrite" }; return; }
    doSave();
  },
  overwriteYes() { V.modal = null; doSave(); },
  saveCurrent() { V.modal = { type: "saveCurrent", lines: saveCurrentLines() }; },
  saveCurrentYes() {
    V.modal = null;
    loadFormAndGear();
    ev("load");
    log("현재 편성·장비 저장: 편성과 영웅 전원");
    doSave();
  },
  apply() {
    if (!saved()) { log("프리셋 불러오기: 저장된 프리셋 없음, 반응 없음"); return; }
    if (isDirty()) { V.modal = { type: "alert", text: "저장하지 않은 변경 사항이 있습니다.\n저장한 뒤 불러와 주세요." }; return; }
    const plan = buildPlan();
    if (plan.form.same && !plan.moves.length && !plan.crests.length) {
      if (plan.missing.length) { toast(MSG_PARTIAL); ev("missing"); log(`프리셋 불러오기: 교체할 장비 없음, 삭제된 장비 ${plan.missing.length}개`); return; }
      ev("noop");
      log("프리셋 불러오기: 저장값과 실제 착용이 같아 반응 없음");
      return;
    }
    V.modal = { type: "apply", plan };
  },
  applyYes() {
    const { plan } = V.modal;
    const f = plan.form;
    f.pull.forEach((p) => { p.from.cells[p.from.cells.indexOf(p.h)] = 0; });
    if (!f.same) {
      deck().cells = savedForm().map((h) => (h && f.locked.some((x) => x.h === h) ? 0 : h));
      V.done.add("f2");
      if (f.pull.length) V.done.add("f3");
      if (f.locked.length) V.done.add("f4");
    }
    plan.moves.forEach((m) => {
      const cur = actualOf(m.h)[m.s];
      if (cur && cur !== m.uid) S.items[cur].owner = 0;
      S.items[m.uid].owner = m.h;
    });
    plan.crests.forEach((c) => { if (c.s === 8) S.wisdom[c.h] = c.tid; else S.crest[c.h] = c.tid; });
    V.modal = null;
    ev("apply");
    log(`프리셋 불러오기: ${f.same ? "편성 같음" : `편성 ${formSummary(f)}`}, 교체 ${plan.moves.length}개, 문장·지식 ${plan.crests.length}개, 유지 ${plan.keep.length}칸, 삭제된 장비 ${plan.missing.length}개`);
    const lines = [f.same ? "저장된 장비를 불러왔습니다." : "저장된 편성과 장비를 불러왔습니다."];
    if (f.pull.length) lines.push(`${f.pull.map((p) => `${p.from.tab}의 ${heroName(p.h)}`).join(", ")}을(를) 빼 왔습니다.`);
    if (f.locked.length) lines.push(`이미 사용한 영웅 ${f.locked.length}명은 빼고 빈 칸으로 두었습니다.`);
    if (plan.missing.length) { ev("missing"); lines.push(MSG_PARTIAL); }
    toast(lines.join("\n"));
    if (!listHeroes().includes(V.selected)) V.selected = listHeroes()[0];
  },
  closeModal() { V.modal = null; },
  toggleUsed(el) {
    const h = Number(el.dataset.h);
    const g = deck().group;
    S.used[g] = S.used[g] || new Set();
    if (S.used[g].has(h)) S.used[g].delete(h); else S.used[g].add(h);
    log(`사용 완료 ${S.used[g].has(h) ? "표시" : "해제"}: ${heroName(h)}`);
  },
};

function doSwap() {
  const { h, s, pick } = V.swap;
  const name = info(s, pick).name;
  let taken = 0;
  if (s === 7) S.crest[h] = pick;
  else if (s === 8) S.wisdom[h] = pick;
  else {
    const it = S.items[pick];
    const from = it.owner;
    const cur = actualOf(h)[s];
    if (cur) S.items[cur].owner = 0;
    it.owner = h;
    if (from && from !== h) {
      log(`${heroName(from)}에게서 해제: ${name}`);
      if (deckHeroes().includes(from)) taken = from;
    }
  }
  log(`실제 장비 교체: ${heroName(h)} ${SLOT_NAME[s]} ← ${name}`);
  ev("change");
  V.swap = null;
  toast(taken ? `${heroName(taken)}의 ${SLOT_NAME[s]}이(가) 제거되었습니다. 영웅 목록에서 확인하세요.` : "실제 장비를 교체했습니다. 프리셋에 남기려면 [현재 장비로 저장]을 누르세요.");
}
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
  // 편성까지 다르면 일부러 바꾼 것으로 보고 묻지 않는다. 장비 확인은 편성이 같을 때만 한다.
  if (!sameCells(savedForm(), deck().cells)) return { text: "편성 다름", cls: "none", warn: false, lines: [], kinds: [] };
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
    plan.crests.forEach((c) => add(c.h, SLOT_NAME[c.s], "diff"));
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
  const form = V.form ? [...V.form] : [...deck().cells];
  const out = {};
  heroesIn(form).forEach((h) => {
    const c = { ...(V.draft[h] || actualOf(h)) };
    [1, 2, 3, 4, 5, 6].forEach((s) => { if (c[s] && !S.items[c[s]]) c[s] = 0; });
    out[h] = c;
  });
  delete V.drafts[S.deckIdx];
  const first = !saved();
  S.presets[S.deckIdx] = out;
  S.forms[S.deckIdx] = form;
  V.draft = draftFromSaved(S.deckIdx);
  V.form = [...form];
  ev("save");
  log(`${first ? "저장" : "덮어쓰기"}: 편성(위치)과 영웅 ${heroesIn(form).length}명 장비`);
  toast("프리셋을 저장했습니다.");
}

/* ---------- 화면 ---------- */
function teamScreen() {
  const d = deck();
  const hs = deckHeroes();
  const power = hs.reduce((a, h) => a + (HERO[h].power || 0), 0);
  const sv = saved();
  const tiles = d.cells.map((t, i) => (t
    ? `<div class="tile" data-i="${i}" data-h="${t}"><span class="no">${i + 1}</span><div data-act="openGear" data-h="${t}" title="장비 교체"><img src="${heroImg(t)}" alt="" draggable="false"><span class="nm">${esc(heroName(t))}</span></div>
         <button class="x" data-act="removeHero" data-h="${t}" title="편성에서 제외">✕</button></div>`
    : `<div class="tile" data-i="${i}"><span class="no">${i + 1}</span></div>`)).join("");
  const onDeck = new Set(hs);
  const roster = Object.values(HERO)
    .sort((a, b) => (onDeck.has(b.tid) ? 1 : 0) - (onDeck.has(a.tid) ? 1 : 0) || b.power - a.power)
    .map((h) => {
      const o = otherDeckOf(h.tid);
      const tag = isUsed(h.tid) ? '<span class="rt red">사용 완료</span>' : o ? `<span class="rt">${esc(o.tab)}</span>` : "";
      return `<div class="rcard ${onDeck.has(h.tid) ? "on" : ""} ${isUsed(h.tid) ? "used" : ""}" data-act="toggleHero" data-h="${h.tid}">
        <img src="${heroImg(h.tid)}" alt="" draggable="false">${onDeck.has(h.tid) ? '<span class="chk"></span>' : ""}${tag}
        <div class="nm">${esc(h.name)}</div>
        <button class="gearBtn" data-act="openGear" data-h="${h.tid}">장비</button></div>`;
    }).join("");
  const fc = applyForm();
  const pst = sv
    ? `프리셋: <b>저장됨</b> (편성 + 영웅 ${heroesIn(savedForm()).length}명 장비)${fc.same ? "" : `<br>편성 다름 (${formSummary(fc)})`}${gearDiffers() ? "<br>저장된 장비와 다름" : ""}`
    : "프리셋: 없음";
  return `<div class="team">
    <div class="topbar">팀 편성</div>
    <div class="power"><small>팀 전투력</small><b>${power.toLocaleString()}</b><br><span class="count">${hs.length}/${d.max}</span></div>
    <div class="hint">판 위의 영웅을 누르면 장비를 바꿀 수 있습니다. 끌어서 다른 칸에 놓으면 자리를 옮깁니다.<br><br>아래 목록을 누르면 편성에 넣거나 빼고, 위로 끌어 원하는 칸에 놓을 수도 있습니다.${noDup() ? "<br><br>이 콘텐츠는 덱끼리 영웅을 함께 쓸 수 없습니다." : ""}</div>
    <div class="board ${d.max > 9 ? "c4" : "c3"}">${tiles}</div>
    <div class="teamRight">
      <h3>${esc(d.group)}</h3>
      ${d.tab ? `<div class="tabs">${groupDecks().map((g) => `<button class="tab ${g.index === d.index ? "on" : ""}" data-act="teamTab" data-d="${g.index}">${esc(g.tab)}${S.presets[g.index] ? " ✓" : ""}</button>`).join("")}</div>` : ""}
      <div class="pstate">${pst}</div>
      <div class="grow"></div>
      <button class="btn gold" data-act="openPreset">프리셋</button>
      <div class="teamBtnRow"><button class="btn green dim">배치 확인</button><button class="btn gold" data-act="battle">전투 시작</button></div>
    </div>
    <div class="roster" data-keep="roster">${roster}</div>
  </div>`;
}

const STATUS_TAG = {
  notin: '<span class="tag keep">프리셋에 없음</span>',
  unset: '<span class="tag unset">미설정</span>',
  gone: '<span class="tag gone">분해</span>',
  diff: "",
  removed: "",
  ok: "",
};
function bannerState() {
  const fv = viewForm();
  if (fv && !fv.same) return { status: "form", text: `편성이 프리셋과 다름 (${formSummary(fv)}) · 불러올 때 비교 화면으로 확인` };
  const hs = listHeroes().filter((h) => heroStatus(h) !== "notin");
  const c = (st) => hs.filter((h) => heroStatus(h) === st).length;
  if (c("unset")) return { status: "unset", text: `장비 미설정 영웅 ${c("unset")}명` };
  if (c("removed")) return { status: "removed", text: `장비가 제거된 영웅 ${c("removed")}명` };
  if (c("gone")) return { status: "gone", text: `저장 장비가 분해된 영웅 ${c("gone")}명` };
  if (c("diff")) return { status: "diff", text: `현재 장비와 다른 영웅 ${c("diff")}명` };
  if (isDirty()) return { status: "", text: "저장 전 변경 사항이 있습니다" };
  return { status: "", text: isArena() ?"모든 영웅의 장비가 저장되어 있습니다" : "모든 영웅의 장비가 저장값과 같습니다" };
}
function cmpSlot(s, v, it, emptyText) {
  if (it && it.alive) return `<div class="slot g${it.grade}"><img src="../assets/item/${it.icon}.png" alt="">${s < 7 ? `<span class="plus">+${it.lb}</span>` : ""}</div>`;
  if (it) return '<div class="slot empty"><span>분해됨</span></div>';
  return `<div class="slot empty"><span>${emptyText}</span></div>`;
}
function compareState(h, s) {
  const d = V.draft[h];
  if (!d) return { cls: "", tag: "" };
  const v = d[s] || 0;
  const cur = actualOf(h)[s] || 0;
  const it = info(s, v);
  const mate = S.conflict[`${S.deckIdx}:${h}:${s}`];
  if (!v && mate) return { cls: "keep", tag: `${heroName(mate)} 사용`, count: true };
  if (it && !it.alive) return { cls: "gone", tag: "장비 없음", count: true };
  if (v && !cur) return { cls: "gone", tag: "제거됨", count: true };
  if (v && v !== cur) return { cls: "diff", tag: "다름", count: true };
  if (!v && cur) return { cls: "keep", tag: "저장 안 함", count: true };
  return { cls: "", tag: "" };
}
/* 슬롯 8칸을 한 줄로 놓고, 프리셋과 다른 슬롯만 현재 장비 아래에 프리셋 장비를 보여 준다. */
function compareHTML(h) {
  const a = actualOf(h);
  const d = V.draft[h];
  const cells = SLOT_IDS.map((s) => {
    const v = d ? d[s] || 0 : 0;
    const cur = a[s] || 0;
    const st = compareState(h, s);
    const under = st.count
      ? `<div class="pUnder"><small>프리셋</small>${cmpSlot(s, v, info(s, v), "없음")}<div class="pTag">${esc(st.tag)}</div></div>`
      : "";
    return `<div class="pSlot ${st.cls} ${V.slot === s ? "picked" : ""}" data-act="pickSlot" data-s="${s}" title="${SLOT_NAME[s]} 교체">
      <div class="pName">${SLOT_NAME[s]}</div>${cmpSlot(s, cur, info(s, cur), "비어 있음")}${under}</div>`;
  }).join("");
  return `<div class="pGrid">${cells}</div>`;
}
function compareInfo(h) {
  const f = draftForm();
  if (f && !f.includes(h)) return "프리셋에 없는 영웅입니다. [프리셋 불러오기]를 누르면 편성에서 빠집니다. 슬롯을 누르면 실제 장비를 교체합니다.";
  if (f && !deck().cells.includes(h)) return "지금 편성에 없는 영웅입니다. [프리셋 불러오기]를 누르면 편성에 들어가고 이 장비로 맞춥니다.";
  if (!V.draft[h]) return "프리셋에 저장된 장비가 없습니다. 슬롯을 누르면 실제 장비를 교체합니다.";
  const n = SLOT_IDS.filter((s) => compareState(h, s).count).length;
  return `${n ? `현재 장비와 다른 슬롯 ${n}칸` : "현재 장비와 프리셋이 같습니다"} · 슬롯을 누르면 실제 장비를 교체합니다.`;
}
/* 편성 비교: 지금 편성과 프리셋 편성을 판 두 개로 놓고, 바뀌는 칸에 표시를 단다. */
function formBoard(cells, n, marks) {
  const cs = cells.map((h, i) => {
    const m = marks[i] || { cls: "", tags: [] };
    const tags = m.tags.map(([t, c]) => `<span class="ft ${c}">${esc(t)}</span>`).join("");
    return `<div class="fc ${m.cls}" ${h ? `data-act="selectHero" data-h="${h}"` : ""}><span class="no">${i + 1}</span>${h ? `<img src="${heroImg(h)}" alt="" title="${esc(heroName(h))}"><span class="nm">${esc(heroName(h))}</span>` : ""}<div class="ftg">${tags}</div></div>`;
  }).join("");
  return `<div class="fb" style="grid-template-columns:repeat(${n},auto)">${cs}</div>`;
}
function formCompareHTML(r, target, small) {
  const d = deck();
  const n = d.max > 9 ? 4 : 3;
  const cur = {}, tgt = {};
  r.out.forEach((x) => { cur[x.j] = { cls: "out", tags: [["제외", "red"]] }; });
  r.move.forEach((x) => {
    cur[x.from] = { cls: "move", tags: [[`${cellNo(x.to)}으로`, "yellow"]] };
    tgt[x.to] = { cls: "move", tags: [[`${cellNo(x.from)}에서`, "yellow"]] };
  });
  r.add.forEach((x) => {
    const p = r.pull.find((y) => y.h === x.h);
    tgt[x.i] = { cls: "add", tags: [["추가", "green"]].concat(p ? [[`${p.from.tab}에서`, "blue"]] : []) };
  });
  r.locked.forEach((x) => { tgt[x.i] = { cls: "locked", tags: [["사용 완료", "red"], ["빈 칸", "red"]] }; });
  target.forEach((h, i) => {
    if (!h || r.locked.some((x) => x.h === h)) return;
    const k = SLOT_IDS.filter((s) => compareState(h, s).count).length;
    if (!k) return;
    tgt[i] = tgt[i] || { cls: "", tags: [] };
    tgt[i].tags = tgt[i].tags.concat([[`장비 ${k}`, "violet"]]);
  });
  return `<div class="fcmp ${small ? "sm" : ""}">
    <div class="fw"><h4>현재 편성<small>${heroesIn(d.cells).length}/${d.max}</small></h4>${formBoard(d.cells, n, cur)}</div>
    <div class="farrow">➜</div>
    <div class="fw"><h4>프리셋 편성<small>불러오면 이렇게 바뀝니다</small></h4>${formBoard(target, n, tgt)}</div></div>`;
}
function presetScreen() {
  const hs = listHeroes();
  if (!hs.includes(V.selected)) V.selected = hs[0];
  const b = bannerState();
  const h = V.selected;
  const cards = hs.map((t) => {
    const st = heroStatus(t);
    const dr = V.draft[t];
    // 현재 착용 칸이 다 차지 않으면 카드 자체를 강조한다. 팀 내 교체로 장비가 빠진 경우를 바로 알 수 있게 한다.
    const worn = filled(actualOf(t));
    const low = worn < SLOT_IDS.length;
    const ch = gearChanges(t);
    const chTags = `${ch.removed ? `<span class="tag gone">제거 ${ch.removed}</span>` : ""}${ch.changed ? `<span class="tag diff">변경 ${ch.changed}</span>` : ""}`;
    return `<div class="card ${t === h ? "sel" : ""} ${low ? "low" : ""}" data-act="selectHero" data-h="${t}" title="${esc(heroName(t))}">
      <img src="${heroImg(t)}" alt="${esc(heroName(t))}">
      <div class="cInfo"><span class="cnt">${worn}/${SLOT_IDS.length}</span>${STATUS_TAG[st]}${chTags}</div></div>`;
  }).join("");
  const allSame = sameCells(V.form, deck().cells) && deckHeroes().every((t) => sameSlots(V.draft[t], actualOf(t)));
  const dirty = isDirty();
  const plan = buildPlan();
  const canApply = saved() && !dirty && (!plan.form.same || plan.moves.length || plan.crests.length || plan.missing.length);
  const arena = isArena();
  let msg = arena ? "프리셋을 저장하면 이 장비로 전투합니다. 실제 착용은 바뀌지 않습니다." : "프리셋을 저장하면 이 편성의 편성과 장비를 언제든 다시 불러올 수 있습니다.";
  if (dirty) msg = "저장하지 않은 변경 사항이 있습니다.";
  else if (arena && saved()) msg = "저장된 장비로 전투합니다. 실제 착용은 바뀌지 않습니다.";
  else if (saved() && canApply) msg = `저장된 프리셋과 현재 ${plan.form.same ? "장비" : "편성·장비"}가 다릅니다. [현재 상태로 저장] 또는 [프리셋 불러오기]를 선택할 수 있습니다.`;
  else if (saved() && differsFromActual()) msg = "저장된 프리셋과 현재 장비가 다릅니다. [현재 상태로 저장]을 선택할 수 있습니다.";
  else if (saved()) msg = "저장된 프리셋과 현재 편성·장비가 같습니다.";
  const tabs = deck().tab
    ? `<div class="tabs">${groupDecks().map((g) => `<button class="tab ${g.index === S.deckIdx ? "on" : ""}" data-act="presetTab" data-d="${g.index}">${esc(g.tab)}${dirtyDeck(g.index) ? " *" : S.presets[g.index] ? " ✓" : ""}</button>`).join("")}</div>`
    : "";
  const other = arena ? groupDecks().find((g) => g.index !== S.deckIdx) : null;
  const rightBtn = arena
    ? `<button class="btn line" data-act="copyTeam">${esc(other.tab)}으로 복사</button>`
    : `<button class="btn green ${canApply ? "" : "dim"}" data-act="apply">프리셋 불러오기</button>`;
  return `<div class="dimmer"></div><div class="sheet preset ${deck().max > 6 ? "many" : ""}">
    <button class="close" data-act="closePreset">✕</button>
    <div class="pTop"><b>${esc(deck().group)} 프리셋</b>${tabs}<span>참가 영웅 ${deckHeroes().length}/${deck().max}</span></div>
    <div class="pLeft">
      <div class="cards" data-keep="cards">${cards}</div>
    </div>
    <div class="pRight">
      <div class="pHead"><div class="banner ${b.status ? "" : "none"}" ${b.status ? 'data-act="nextIssue"' : ""}><span>${b.text}</span>${b.status ? "<span>확인 ›</span>" : ""}</div></div>
      <div class="pHero"><img src="${heroImg(h)}" alt=""><div class="t"><b>${esc(heroName(h))}</b><div>선택한 영웅의 장비</div></div>
        <button class="btn line" data-act="loadCurrent">현재 장비 가져오기</button>
        <button class="btn line ${allSame ? "dim" : ""}" data-act="loadAll">전체 가져오기</button></div>
      ${compareHTML(h)}
      <div class="pInfo">${compareInfo(h)}</div>
    </div>
    <div class="pFoot"><div class="msg">${msg}</div>
      ${differsFromActual()
    ? '<button class="btn gold" data-act="saveCurrent">현재 상태로 저장</button>'
    : `<button class="btn gold ${canSave() ? "" : "dim"}" data-act="save">${saved() ? "덮어쓰기" : "저장"}</button>`}
      ${rightBtn}</div>
  </div>`;
}
function gearScreen() {
  const h = V.gearHero;
  const a = actualOf(h);
  const slots = SLOT_IDS.map((s) => {
    const it = info(s, a[s]);
    const inner = it ? `<img src="../assets/item/${it.icon}.png" alt="">${s < 7 ? `<span class="plus">+${it.lb}</span>` : ""}` : "<span>비어 있음</span>";
    return `<div class="slotBox" data-act="pickGearSlot" data-s="${s}"><div class="slot ${it ? `g${it.grade}` : "empty"} ${V.gearSlot === s ? "picked" : ""}">${inner}</div><div class="lb">${SLOT_NAME[s]}</div></div>`;
  }).join("");
  let rows;
  const s = V.gearSlot;
  if (s === 8) {
    rows = Object.values(D.wisdoms).map((c) => `<div class="cand click" data-act="itemPop" data-s="8" data-v="${c.tid}"><img src="../assets/item/${c.icon}.png" alt=""><div class="c"><b>${esc(c.name)}</b><span>여러 영웅 부여 가능</span></div>
      ${a[8] === c.tid ? '<span class="tag ok">부여 중</span>' : `<button class="mini" data-act="equipWisdom" data-t="${c.tid}">부여</button>`}</div>`).join("");
  } else if (s === 7) {
    rows = Object.values(D.crests).map((c) => `<div class="cand click" data-act="itemPop" data-s="7" data-v="${c.tid}"><img src="../assets/item/${c.icon}.png" alt=""><div class="c"><b>${esc(c.name)}</b><span>등록된 문장 · 여러 영웅 착용 가능</span></div>
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
        return `<div class="cand click" data-act="itemPop" data-s="${i.slot}" data-v="${i.uid}"><img src="../assets/item/${i.icon}.png" alt=""><div class="c"><b>${esc(i.name)}${i.test ? " (테스트 장비)" : ""}</b><span>${where(i)} · 돌파 ${i.lb} · 품질 ${i.q}</span></div>${btn}</div>`;
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
function itemBody(s, v) {
  const it = info(s, v);
  if (!it) return "";
  const stars = "★".repeat(it.grade || 0);
  const label = (it.grade >= 7 && s < 7 ? "각성" : `★${it.grade}`);
  const owner = s < 7 && it.alive && it.owner
    ? `<img src="${heroImg(it.owner)}" alt=""><span>${esc(heroName(it.owner))} 장착 중</span>`
    : `<span>${s === 8 ? "지식 · 여러 영웅에게 부여 가능" : s === 7 ? "등록된 문장 · 여러 영웅이 함께 착용 가능" : it.alive ? "장착 중인 영웅 없음 (가방)" : "분해되어 사라진 장비입니다"}</span>`;
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
  return `
      <div class="ipHead"><div class="ipIcon g${it.grade}"><img src="../assets/item/${it.icon}.png" alt=""><div class="ipStars">${stars}</div></div>
        <div class="ipTitle"><h4>${esc(it.name)}</h4><div class="ipSub">${esc(it.tname || "")}<span></span><b>${label}</b></div>${meta}${reroll}</div></div>
      <div class="ipDesc">${richText(it.desc || "")}</div>
      ${grow}
      <div class="ipSec">장착 효과</div>
      <div class="ipOwner">${owner}</div>
      ${awake}${base}${rnd}`;
}
function itemPopHTML() {
  if (!V.itemPop) return "";
  const { s, v } = V.itemPop;
  if (!info(s, v)) return "";
  return `<div class="ipDim" data-act="closeItemPop"></div><div class="sheet itemPop">
    <button class="close" data-act="closeItemPop">✕</button>
    <div class="ipScroll" data-keep="itemPop">${itemBody(s, v)}</div></div>`;
}
/* 프리셋 슬롯에 낄 수 있는 후보. 장비 교체 창과 같은 조건을 쓴다. */
function swapCandidates(h, s) {
  if (s >= 7) return Object.values(s === 8 ? D.wisdoms : D.crests).map((c) => ({ ...c, val: c.tid, owner: 0, power: 0 }));
  return Object.values(S.items)
    .filter((i) => i.slot === s && (s === 1 ? i.htid === h : s === 2 ? i.type === HERO[h].weapon : true))
    .map((i) => ({ ...i, val: i.uid }));
}
function swapHTML() {
  if (!V.swap) return "";
  const { h, s, pick, hideWorn, asc } = V.swap;
  const cur = actualOf(h)[s] || 0;
  const inPreset = (V.draft[h] && V.draft[h][s]) || 0;
  const dir = asc ? 1 : -1;
  const list = swapCandidates(h, s)
    .filter((c) => !hideWorn || !c.owner || c.val === cur || c.owner === h)
    .sort((a, b) => (b.val === cur) - (a.val === cur) || (b.val === inPreset) - (a.val === inPreset) || dir * (a.grade - b.grade) || dir * ((a.power || 0) - (b.power || 0)));
  const cells = list.map((c) => `<div class="swCell" data-act="swapPick" data-v="${c.val}">
      <div class="swIcon g${c.grade} ${c.val === pick ? "picked" : ""}"><img src="../assets/item/${c.icon}.png" alt="">${s < 7 ? `<span class="plus">+${c.lb}</span>` : ""}
        ${c.owner ? `<img class="swOwner" src="${heroImg(c.owner)}" alt="${esc(heroName(c.owner))}" title="${esc(heroName(c.owner))} 착용 중">` : ""}</div>
      <div class="swPow">${c.power ? `◈ ${c.power}` : `★${c.grade}`}</div>
      ${c.val === cur ? '<span class="swTag cur">현재 착용</span>' : ""}${c.val === inPreset ? '<span class="swTag mate">프리셋</span>' : ""}</div>`).join("");
  const it = info(s, pick);
  const notes = [];
  if (it && it.alive && pick !== cur) {
    notes.push("실제 장비가 바로 바뀝니다. 프리셋은 그대로이며 [현재 장비로 저장]으로 남길 수 있습니다.");
    if (s < 7 && it.owner && it.owner !== h) notes.push(`${heroName(it.owner)}에게서 해제 후 장착합니다.`);
  }
  const btn = !pick ? "" : pick !== cur
    ? '<button class="btn gold" data-act="swapDo">교체</button>'
    : s < 7 ? '<button class="btn green" data-act="swapClear">해제</button>' : "";
  return `<div class="ipDim" data-act="closeSwap"></div>
    <div class="sheet swInfo">
      <div class="ipScroll" data-keep="swapInfo">${it ? itemBody(s, pick) : `<div class="swEmpty">${esc(heroName(h))}의 ${SLOT_NAME[s]} 슬롯이 비어 있습니다.<br>오른쪽에서 장비를 고르세요.</div>`}</div>
      ${btn || notes.length ? `<div class="swFoot">${notes.map((t) => `<p>${esc(t)}</p>`).join("")}${btn}</div>` : ""}
    </div>
    <div class="sheet swList">
      <div class="swHead">${esc(heroName(h))} · ${SLOT_NAME[s]} 교체</div>
      <div class="swGrid" data-keep="swapList">${cells || '<div class="swEmpty">고를 수 있는 장비가 없습니다.</div>'}</div>
      <div class="swBar"><label class="swHide" data-act="swapHide"><i class="${hideWorn ? "on" : ""}"></i>장착중인 장비 리스트에서 감추기</label>
        <button class="swSort" data-act="swapSort">희귀도 ${asc ? "▲" : "▼"}</button></div>
    </div>
    <button class="close swClose" data-act="closeSwap">✕</button>`;
}
function modalHTML() {
  const m = V.modal;
  if (!m) return "";
  let body = "", wide = false;
  if (m.type === "noPreset") {
    body = `<p>${MSG_NO_PRESET}</p><div class="row"><button class="btn line" data-act="no">아니오</button><button class="btn gold" data-act="yes">예</button></div>`;
  } else if (m.type === "swapConfirm") {
    const it = S.items[V.swap.pick];
    body = `<p>${esc(heroName(it.owner))}이(가) 착용 중인 장비입니다.\n해제 후 장착하시겠습니까?</p><div class="row"><button class="btn line" data-act="closeModal">취소</button><button class="btn gold" data-act="swapConfirmYes">해제 후 장착</button></div>`;
  } else if (m.type === "saveCurrent") {
    body = `<p>현재 편성과 장비로 프리셋을 저장하시겠습니까?</p><ul>${m.lines.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
      
      <div class="row"><button class="btn line" data-act="closeModal">취소</button><button class="btn gold" data-act="saveCurrentYes">저장</button></div>`;
  } else if (m.type === "overwrite") {
    body = `<p>저장된 프리셋을 현재 화면 내용으로 덮어쓰시겠습니까?</p><div class="row"><button class="btn line" data-act="closeModal">취소</button><button class="btn gold" data-act="overwriteYes">덮어쓰기</button></div>`;
  } else if (m.type === "leave") {
    const tabs = dirtyTabs();
    body = `<p>변경 사항이 저장되지 않았습니다.\n정말로 나가시겠습니까?</p>
      ${tabs.length > 1 ? `<div class="sub">저장 안 한 탭: ${tabs.map((d) => esc(d.tab)).join(", ")}</div>` : ""}
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
      <div class="pbRows">${line("팀 편성", `${n}/${deck().max}`, n >= deck().max ? "ok" : "bad")}${line("앙상블", "장착중", "ok")}${line("공진 태엽", "장착중", "ok")}${line("프리셋", row.text, row.cls)}${detail}</div>
      ${gearDiffers()
    ? '<div class="row"><button class="btn line" data-act="closeModal">팀 편성</button><button class="btn line" data-act="battleGo">현재 장비로 전투</button><button class="btn gold" data-act="battleApply">불러온 후 전투</button></div>'
    : '<div class="row"><button class="btn gold" data-act="battleGo">전투 시작</button><button class="btn line" data-act="closeModal">팀 편성</button></div>'}`;
  } else if (m.type === "apply") {
    const p = m.plan;
    const list = p.moves.map((x) => `<li>${esc(heroName(x.h))} ${SLOT_NAME[x.s]}: ${esc(x.name)}${x.from ? ` <b>(${esc(heroName(x.from))}에게서 해제)</b>` : ""}</li>`)
      .concat(p.crests.map((x) => `<li>${esc(heroName(x.h))} ${SLOT_NAME[x.s]}: ${esc(info(x.s, x.tid).name)}</li>`))
      .concat(p.missing.map((x) => `<li>${esc(heroName(x.h))} ${SLOT_NAME[x.s]}: ${esc(x.name)} 없음, 현재 장비 유지</li>`));
    const f = p.form;
    const notes = f.pull.map((x) => `<li>${esc(heroName(x.h))}: ${esc(x.from.tab)}에서 빼 옵니다. ${esc(x.from.tab)}의 ${cellNo(x.from.cells.indexOf(x.h))} 칸은 비게 됩니다.</li>`)
      .concat(f.locked.map((x) => `<li>${esc(heroName(x.h))}: 이미 사용한 영웅이라 빼고 ${cellNo(x.i)} 칸을 비워 둡니다.</li>`));
    wide = !f.same;
    body = `<p>${f.same ? "저장된 장비를 불러와 실제로 교체합니다." : "저장된 편성과 장비를 불러옵니다."}</p>
      ${f.same ? "" : `${formCompareHTML(f, savedForm(), true)}<div class="sub">편성: ${formSummary(f)}</div>`}
      ${notes.length ? `<ul>${notes.join("")}</ul>` : ""}
      ${list.length ? `<div class="sub">장비</div><ul>${list.join("")}</ul>` : ""}
      <div class="row"><button class="btn line" data-act="closeModal">취소</button><button class="btn green" data-act="applyYes">불러오기</button></div>`;
  }
  return `<div class="dimmer" style="z-index:30"></div><div class="sheet modal ${wide ? "wide" : ""}" style="z-index:31">${body}</div>`;
}
function sidePanel() {
  // 결투장은 후속 작업이라 목록에서 뺀다.
  const groups = DECKS.filter((d, i) => d.mode !== "arena" && DECKS.findIndex((x) => x.group === d.group) === i);
  const opts = groups.map((d) => {
    const members = DECKS.filter((x) => x.group === d.group);
    const n = members.filter((x) => S.presets[x.index]).length;
    return `<option value="${d.group === deck().group ? S.deckIdx : d.index}" ${d.group === deck().group ? "selected" : ""}>${esc(d.group)}${n ? (members.length > 1 ? ` · 저장 ${n}/${members.length}` : " · 저장됨") : ""}</option>`;
  }).join("");
  const steps = (isArena() ? ARENA_STEPS : STEPS.concat(FORM_STEPS, noDup() ? LOCK_STEPS : [])).map(([k, t]) => `<div class="step ${V.done.has(k) ? "done" : ""}"><i>${V.done.has(k) ? "✓" : ""}</i><span>${esc(t)}</span></div>`).join("");
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
    <div class="note">장비 프리셋에 편성(인원·위치) 저장을 더한 시안입니다. 상태는 새로 고치면 처음으로 돌아갑니다.</div>
    <div class="ctl"><select data-change="deck">${opts}</select><button class="reset" data-act="reset">처음부터</button></div>
    ${usedPanel()}
    <h3>진행 순서 (자동 체크)</h3>${steps}
    <h3>세 값 비교</h3>${tbl}
    <h3>동작 기록</h3><div id="log" data-keep="log">${logs}</div>`;
}

function usedPanel() {
  const rule = noDup()
    ? "<b>덱끼리 영웅 중복 불가.</b> 프리셋을 불러오면 다른 덱의 영웅을 빼 오고, 이미 사용한 영웅은 빼고 빈 칸으로 둔다. (테스트용으로 만든 편성)"
    : "<b>덱끼리 영웅 중복 허용.</b> 프리셋을 불러와도 다른 덱은 바뀌지 않는다.";
  if (!noDup()) return `<div class="rule">${rule}</div>`;
  const set = S.used[deck().group] || new Set();
  const hs = [...new Set(groupDecks().flatMap((d) => heroesIn(S.decks[d.index].cells)).concat(Object.values(S.forms).flatMap(heroesIn)).concat(BY_POWER.slice(0, 16)))];
  return `<div class="rule">${rule}</div><h3>사용 완료 영웅 (눌러서 표시)</h3><div class="usedGrid">${hs.map((h) => `<img class="${set.has(h) ? "on" : ""}" src="${heroImg(h)}" alt="" title="${esc(heroName(h))}" data-act="toggleUsed" data-h="${h}">`).join("")}</div>`;
}
function render() {
  const keep = {};
  document.querySelectorAll("[data-keep]").forEach((e) => { keep[e.dataset.keep] = [e.scrollLeft, e.scrollTop]; });
  let html = teamScreen();
  if (V.screen === "preset") html += presetScreen();
  if (V.screen === "gear") html += gearScreen();
  html += swapHTML();
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

/* 판 안에서 자리 옮기기. 빈 칸이면 이동, 영웅이 있으면 맞바꾼다. */
function moveCell(from, to) {
  const c = deck().cells;
  if (from === to || !c[from]) return;
  const a = c[from];
  [c[from], c[to]] = [c[to], c[from]];
  log(`자리 이동: ${heroName(a)} ${cellNo(from)} → ${cellNo(to)}${c[from] ? ` (${heroName(c[from])}와 맞바꿈)` : ""}`);
  ev("change");
}
/* 목록의 영웅을 편성에 넣는다. at < 0이면 첫 빈 칸, 아니면 그 칸 (영웅이 있으면 그 영웅을 뺀다). */
function placeHero(h, at) {
  const d = deck();
  const c = d.cells;
  const cur = c.indexOf(h);
  if (cur >= 0) { if (at >= 0) moveCell(cur, at); return; }
  if (isUsed(h)) { toast("이미 사용한 영웅은 편성할 수 없습니다."); return; }
  const target = at >= 0 ? at : c.indexOf(0);
  const replaced = at >= 0 ? c[at] : 0;
  if (!replaced && (deckHeroes().length >= d.max || target < 0)) { toast("최대 배치 가능인원을 넘었습니다."); return; }
  const o = otherDeckOf(h);
  if (o) { o.cells[o.cells.indexOf(h)] = 0; toast(`${heroName(h)}을(를) ${o.tab}에서 옮겼습니다.`); }
  c[target] = h;
  log(`편성에 추가: ${heroName(h)} ${cellNo(target)}${replaced ? ` (${heroName(replaced)} 제외)` : ""}${o ? ` (${o.tab}에서 옮김)` : ""}`);
  ev("change");
  if (replaced) syncPresetRoster(replaced, false);
  syncPresetRoster(h, true);
}
/* 판의 영웅을 끌어 다른 칸에 놓으면 자리를 옮긴다. 목록의 영웅을 위로 끌어 칸에 놓으면 그 칸에 넣는다.
   마우스와 터치를 함께 받으려고 포인터 이벤트를 쓴다. 끄는 동안에는 화면을 다시 그리지 않는다. */
let drag = null;
let skipClick = false;
document.addEventListener("pointerdown", (e) => {
  if (V.screen !== "team" || V.modal || e.button > 0 || e.target.closest(".x, .gearBtn")) return;
  const tile = e.target.closest(".tile[data-h]");
  const card = e.target.closest(".rcard");
  if (!tile && !card) return;
  drag = { from: tile ? Number(tile.dataset.i) : -1, h: Number((tile || card).dataset.h), roster: !card ? false : true, x: e.clientX, y: e.clientY, on: false, el: tile || card, ghost: null, over: null };
});
document.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.on) {
    // 목록은 가로로 스크롤되므로 위쪽으로 끌 때만 드래그로 본다.
    if (drag.roster ? dy > -12 || Math.abs(dx) > Math.abs(dy) : Math.hypot(dx, dy) < 8) return;
    if (drag.roster && isUsed(drag.h)) { drag = null; return; }
    drag.on = true;
    drag.ghost = document.createElement("img");
    drag.ghost.className = "ghost";
    drag.ghost.src = heroImg(drag.h);
    document.body.appendChild(drag.ghost);
    drag.el.classList.add("dragging");
  }
  e.preventDefault();
  drag.ghost.style.left = `${e.clientX}px`;
  drag.ghost.style.top = `${e.clientY}px`;
  const t = document.elementFromPoint(e.clientX, e.clientY);
  const over = t && t.closest(".tile");
  if (drag.over && drag.over !== over) drag.over.classList.remove("over");
  if (over && over !== drag.over) over.classList.add("over");
  drag.over = over;
});
function endDrag(cancel) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.on) return;
  d.ghost.remove();
  skipClick = true;
  setTimeout(() => { skipClick = false; }, 0);
  if (!cancel && d.over) {
    const to = Number(d.over.dataset.i);
    if (d.roster) placeHero(d.h, to); else moveCell(d.from, to);
  }
  render();
}
document.addEventListener("pointerup", () => endDrag(false));
document.addEventListener("pointercancel", () => endDrag(true));
document.addEventListener("dragstart", (e) => { if (e.target.closest(".team")) e.preventDefault(); });

document.addEventListener("click", (e) => {
  if (skipClick) return;
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
  ...Object.values(HERO).map((h) => `../assets/hero/${h.icon}.png`),
  ...D.items.map((i) => `../assets/item/${i.icon}.png`),
  ...Object.values(D.crests).map((c) => `../assets/item/${c.icon}.png`),
  ...Object.values(D.wisdoms).map((c) => `../assets/item/${c.icon}.png`),
].filter((u, i, a) => a.indexOf(u) === i).map((u) => { const m = new Image(); m.src = u; return m; });

fresh();
render();
fit();
