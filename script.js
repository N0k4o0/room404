"use strict";

/* ===========================================================
   ECHO PROTOCOL — 囚われた被験者
   進行状態は Firebase Realtime Database の
   rooms/{roomCode}/state に集約し、SUBJECT / OPERATOR 双方の
   端末がリアルタイムリスナーで同じ状態を共有することで、
   離れた端末同士でも非対称協力プレイを成立させる。
   各ステージは「どちらか一方の情報だけでは解けない」設計にして
   あるため、判定ロジックは片方の入力だけで完結する。
   =========================================================== */

const ROLE_KEY = "echo_protocol_role_v1";
const ROOM_KEY = "echo_protocol_room_v1";

const TIME_LIMIT_MS = 15 * 60 * 1000;
const SEED_DURATION_MS = 20 * 1000;
const TICK_INTERVAL_MS = 1000;

// --- 正解の定義 -------------------------------------------------
// Stage1: 警告灯の色列「紫→橙→白→紫」を、被験者の消火器ラベル
// (橙=5) とオペレーターのソースコード断片(紫=2, 白=8) を
// 突き合わせて数値化すると 2582 になる。
const STAGE1_CODE = "2582";

// Stage2: 壁のメモ「◆→？→▲→●」と、オペレーターの依存関係
// 「■は◆の直後」を組み合わせると ◆→■→▲→● が正解順序になる。
const STAGE2_ORDER = ["diamond", "square", "triangle", "circle"];

// Stage3: オペレーターが送るシードは固定値。被験者は壁のメモ
// 「各桁に4を足す（10は0）」を適用して入力する。
// 041 -> 4,8,5 -> "485"
const STAGE3_SEED = "041";
const STAGE3_ANSWER = "485";

/* -----------------------------------------------------------
   Firebase 初期化
   ----------------------------------------------------------- */

let firebaseReady = false;
try {
  firebase.initializeApp(firebaseConfig);
  firebaseReady = true;
} catch (err) {
  console.error("Firebase の初期化に失敗しました。firebase-config.js を確認してください。", err);
}

let dbRef = null; // rooms/{roomCode}/state への参照

/* -----------------------------------------------------------
   状態の読み書き
   進行状態は currentState にキャッシュし、render() は常に
   これを参照する。書き込みは Firebase への set() のみで行い、
   結果はリアルタイムリスナー経由で currentState に反映される。
   ----------------------------------------------------------- */

function getDefaultState() {
  return {
    startTime: null,
    stage: 1,
    logSolved: false,
    valveInput: [],
    valveSolved: false,
    seedActive: false,
    seedStartTime: null,
    cleared: false,
    clearTime: null,
    gameOver: false,
  };
}

let currentState = getDefaultState();

function loadState() {
  return currentState;
}

function saveState(state) {
  currentState = state; // 楽観的に即時反映（自分の画面をすぐ更新するため）
  if (dbRef) {
    dbRef.set(state).catch((err) => {
      console.error("状態の同期に失敗しました。", err);
      showRoomStatus("同期エラー：通信状況を確認してください（" + err.message + "）", true);
    });
  }
}

function getRole() {
  try {
    return sessionStorage.getItem(ROLE_KEY);
  } catch (err) {
    return null;
  }
}

function setRole(role) {
  sessionStorage.setItem(ROLE_KEY, role);
}

function getRoomCode() {
  try {
    return sessionStorage.getItem(ROOM_KEY);
  } catch (err) {
    return null;
  }
}

function setRoomCode(code) {
  sessionStorage.setItem(ROOM_KEY, code);
}

function sanitizeRoomCode(raw) {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[.#$[\]/]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 24);
}

/* -----------------------------------------------------------
   ルーム接続
   ----------------------------------------------------------- */

function showRoomStatus(text, isError) {
  const el = document.getElementById("room-status");
  el.hidden = false;
  el.textContent = text;
  el.classList.toggle("room-status-error", Boolean(isError));
}

function revealRoleButtons(roomCode) {
  document.getElementById("room-gate").hidden = true;
  document.getElementById("role-buttons").hidden = false;
  showRoomStatus(`合言葉「${roomCode}」に接続中`, false);
}

function attachRoom(roomCode) {
  if (!firebaseReady) {
    showRoomStatus("Firebase が未設定です。firebase-config.js に設定値を貼り付けてください。", true);
    return;
  }
  if (dbRef) {
    dbRef.off();
  }
  dbRef = firebase.database().ref("rooms/" + roomCode + "/state");
  dbRef.on(
    "value",
    (snap) => {
      currentState = Object.assign(getDefaultState(), snap.val() || {});
      render();
    },
    (err) => {
      console.error("Firebase からの読み込みに失敗しました。", err);
      showRoomStatus("接続エラー：" + err.message, true);
    }
  );
}

document.getElementById("btn-room-join").addEventListener("click", () => {
  const input = document.getElementById("room-code-input");
  const roomCode = sanitizeRoomCode(input.value);
  if (!roomCode) return;
  setRoomCode(roomCode);
  attachRoom(roomCode);
  revealRoleButtons(roomCode);
});

/* -----------------------------------------------------------
   画面切り替え
   ----------------------------------------------------------- */

const screens = {
  title: document.getElementById("screen-title"),
  subject: document.getElementById("screen-subject"),
  operator: document.getElementById("screen-operator"),
  clear: document.getElementById("screen-clear"),
  gameover: document.getElementById("screen-gameover"),
};

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.remove("active"));
  screens[name].classList.add("active");
}

/* -----------------------------------------------------------
   タイマー表示
   ----------------------------------------------------------- */

function formatRemaining(ms) {
  const clamped = Math.max(0, ms);
  const totalSec = Math.floor(clamped / 1000);
  const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function updateTimerDisplay(state) {
  if (!state.startTime) return;
  const remaining = TIME_LIMIT_MS - (Date.now() - state.startTime);
  const text = formatRemaining(remaining);
  [document.getElementById("subject-timer"), document.getElementById("operator-timer")].forEach((el) => {
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("timer-warning", remaining <= 60 * 1000 && remaining > 0);
  });
}

/* -----------------------------------------------------------
   メイン render
   ----------------------------------------------------------- */

function render() {
  const state = loadState();
  const role = getRole();

  if (state.startTime && !state.cleared && !state.gameOver) {
    if (Date.now() - state.startTime >= TIME_LIMIT_MS) {
      state.gameOver = true;
      saveState(state);
    }
  }

  if (state.cleared) {
    renderClear(state);
    return;
  }
  if (state.gameOver) {
    renderGameOver();
    return;
  }
  if (!role || !dbRef) {
    showScreen("title");
    return;
  }
  if (role === "subject") {
    showScreen("subject");
    renderSubject(state);
  } else if (role === "operator") {
    showScreen("operator");
    renderOperator(state);
  } else {
    showScreen("title");
  }

  updateTimerDisplay(state);
}

function renderClear(state) {
  showScreen("clear");
  const el = document.getElementById("clear-time");
  if (state.startTime && state.clearTime) {
    const elapsed = state.clearTime - state.startTime;
    const totalSec = Math.floor(elapsed / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    el.textContent = `クリアタイム：${m}分${String(s).padStart(2, "0")}秒`;
  } else {
    el.textContent = "";
  }
}

function renderGameOver() {
  showScreen("gameover");
}

/* -----------------------------------------------------------
   被験者画面の描画
   ----------------------------------------------------------- */

const STAGE_LABEL = {
  1: "STAGE 1 — 警告灯の記録",
  2: "STAGE 2 — 隔壁バルブ制御",
  3: "STAGE 3 — 最終認証",
};

const VALVE_SYMBOL = { diamond: "◆", square: "■", triangle: "▲", circle: "●" };

function renderSubject(state) {
  document.getElementById("subject-stage-label").textContent = STAGE_LABEL[state.stage] || "";

  // --- Stage2: バルブ ---
  const valveDevice = document.getElementById("device-valve");
  valveDevice.classList.toggle("locked", state.stage < 2);
  document.querySelectorAll(".valve-btn").forEach((btn) => {
    btn.disabled = state.valveSolved;
  });
  const valveHistoryEl = document.getElementById("valve-history");
  valveHistoryEl.textContent =
    state.valveInput.length === 0
      ? "（未操作）"
      : state.valveInput.map((v) => VALVE_SYMBOL[v]).join(" → ");
  const valveMsg = document.getElementById("valve-message");
  if (state.valveSolved) {
    valveMsg.textContent = "正解。隔壁バルブが解放された。";
    valveMsg.className = "device-message msg-success";
  }

  // --- Stage3: 最終認証 ---
  const finalDevice = document.getElementById("device-final");
  finalDevice.classList.toggle("locked", state.stage < 3);
  document.querySelectorAll(".final-digit").forEach((input) => {
    input.disabled = state.cleared;
  });
}

/* -----------------------------------------------------------
   オペレーター画面の描画
   ----------------------------------------------------------- */

function setStatusPill(id, solved) {
  const el = document.getElementById(id);
  el.textContent = solved ? "SOLVED" : "UNSOLVED";
  el.className = "status-pill " + (solved ? "status-done" : "status-pending");
}

function renderOperator(state) {
  document.getElementById("operator-stage-label").textContent = STAGE_LABEL[state.stage] || "";

  setStatusPill("status-log", state.logSolved);
  setStatusPill("status-valve", state.valveSolved);
  setStatusPill("status-final", state.cleared);

  document.getElementById("stage1-input").disabled = state.logSolved;
  document.getElementById("stage1-submit").disabled = state.logSolved;
  const stage1Msg = document.getElementById("stage1-message");
  if (state.logSolved) {
    stage1Msg.textContent = "認証成功。依存関係グラフを復元した。";
    stage1Msg.className = "device-message msg-success";
  }

  document.getElementById("panel-stage2").classList.toggle("locked", state.stage < 2);
  document.getElementById("panel-stage3").classList.toggle("locked", state.stage < 3);

  const seedEl = document.getElementById("seed-display");
  if (state.seedActive && state.seedStartTime) {
    const remain = SEED_DURATION_MS - (Date.now() - state.seedStartTime);
    if (remain > 0) {
      seedEl.textContent = `SEED: ${STAGE3_SEED}（残り ${Math.ceil(remain / 1000)} 秒）`;
      seedEl.className = "seed-display seed-active";
    } else {
      state.seedActive = false;
      saveState(state);
      seedEl.textContent = "SIGNAL EXPIRED";
      seedEl.className = "seed-display seed-expired";
    }
  } else {
    seedEl.textContent = "SEED: ----";
    seedEl.className = "seed-display seed-idle";
  }
}

/* -----------------------------------------------------------
   タイトル画面
   ----------------------------------------------------------- */

function selectRole(role) {
  if (!dbRef) return;
  setRole(role);
  const state = loadState();
  if (!state.startTime) {
    state.startTime = Date.now();
    saveState(state);
  }
  render();
}

document.getElementById("btn-role-subject").addEventListener("click", () => selectRole("subject"));
document.getElementById("btn-role-operator").addEventListener("click", () => selectRole("operator"));

function resetGame() {
  if (dbRef) {
    saveState(getDefaultState());
  }
  try {
    sessionStorage.removeItem(ROLE_KEY);
  } catch (err) {
    /* ignore */
  }
  render();
}

document.getElementById("btn-reset-title").addEventListener("click", resetGame);
document.getElementById("btn-restart-clear").addEventListener("click", resetGame);
document.getElementById("btn-restart-gameover").addEventListener("click", resetGame);

/* -----------------------------------------------------------
   Stage1：オペレーター側 認証コード入力
   ----------------------------------------------------------- */

document.getElementById("stage1-submit").addEventListener("click", () => {
  const state = loadState();
  if (state.logSolved) return;

  const input = document.getElementById("stage1-input");
  const entered = input.value.trim();
  const msgEl = document.getElementById("stage1-message");

  if (entered.length < 4) {
    msgEl.textContent = "4桁のコードを入力してください。";
    msgEl.className = "device-message msg-error";
    return;
  }

  if (entered === STAGE1_CODE) {
    state.logSolved = true;
    state.stage = Math.max(state.stage, 2);
    saveState(state);
    render();
  } else {
    msgEl.textContent = "AUTH_FAILED — コードが一致しません。";
    msgEl.className = "device-message msg-error";
    input.value = "";
  }
});

/* -----------------------------------------------------------
   Stage2：被験者側 バルブ操作
   ----------------------------------------------------------- */

document.querySelectorAll(".valve-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const state = loadState();
    if (state.stage < 2 || state.valveSolved) return;

    state.valveInput.push(btn.dataset.valve);

    if (state.valveInput.length < STAGE2_ORDER.length) {
      saveState(state);
      render();
      return;
    }

    const isCorrect = state.valveInput.every((v, i) => v === STAGE2_ORDER[i]);
    const msgEl = document.getElementById("valve-message");

    if (isCorrect) {
      state.valveSolved = true;
      state.stage = Math.max(state.stage, 3);
      saveState(state);
      render();
    } else {
      state.valveInput = [];
      saveState(state);
      render();
      msgEl.textContent = "警告：操作順が誤っています。バルブが再ロックされました。";
      msgEl.className = "device-message msg-error";
    }
  });
});

/* -----------------------------------------------------------
   Stage3：オペレーター側 シード送信
   ----------------------------------------------------------- */

document.getElementById("seed-send").addEventListener("click", () => {
  const state = loadState();
  if (state.stage < 3 || state.cleared) return;

  state.seedActive = true;
  state.seedStartTime = Date.now();
  saveState(state);
  render();
});

/* -----------------------------------------------------------
   Stage3：被験者側 最終認証
   ----------------------------------------------------------- */

const finalDigits = Array.from(document.querySelectorAll(".final-digit"));
finalDigits.forEach((input, idx) => {
  input.addEventListener("input", () => {
    input.value = input.value.replace(/[^0-9]/g, "").slice(0, 1);
    if (input.value && idx < finalDigits.length - 1) {
      finalDigits[idx + 1].focus();
    }
  });
});

document.getElementById("final-submit").addEventListener("click", () => {
  const state = loadState();
  if (state.stage < 3 || state.cleared) return;

  const entered = finalDigits.map((i) => i.value || "").join("");
  const msgEl = document.getElementById("final-message");

  if (entered.length < 3) {
    msgEl.textContent = "3桁すべて入力してください。";
    msgEl.className = "device-message msg-error";
    return;
  }

  if (entered !== STAGE3_ANSWER) {
    msgEl.textContent = "認証コードが違います。";
    msgEl.className = "device-message msg-error";
    finalDigits.forEach((i) => (i.value = ""));
    finalDigits[0].focus();
    return;
  }

  const withinWindow =
    state.seedActive &&
    state.seedStartTime &&
    Date.now() - state.seedStartTime <= SEED_DURATION_MS;

  if (withinWindow) {
    state.cleared = true;
    state.clearTime = Date.now();
    saveState(state);
    render();
  } else {
    msgEl.textContent = "シード信号が切れました。オペレーターに再送信を依頼してください。";
    msgEl.className = "device-message msg-error";
  }
});

/* -----------------------------------------------------------
   初期化
   ----------------------------------------------------------- */

function initRoomUI() {
  const room = getRoomCode();
  if (!room) return;
  document.getElementById("room-code-input").value = room;
  attachRoom(room);
  revealRoleButtons(room);
}

initRoomUI();
render();
setInterval(render, TICK_INTERVAL_MS);
