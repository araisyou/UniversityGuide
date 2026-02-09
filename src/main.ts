/**
 * Copyright(c) Live2D Inc. All rights reserved.
 *
 * Use of this source code is governed by the Live2D Open Software license
 * that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 */

import { LAppDelegate } from './lappdelegate';
import * as LAppDefine from './lappdefine';
import { runTool } from './functioncalling';
import { playMotionById } from './motion';
import { playVoice, disposeVoice } from './voice';
import type { LlmResponse } from './chatTypes';

type DemoElement = { el: HTMLElement; display: string };
const demoElements: DemoElement[] = [];
let demoVisible = false;

function registerDemoElement(el: HTMLElement): void {
  demoElements.push({ el, display: el.style.display || '' });
}

function setDemoVisible(visible: boolean): void {
  demoVisible = visible;
  demoElements.forEach(item => {
    item.el.style.display = visible ? item.display : 'none';
  });
}

/**
 * モーション切り替えボタンを設置する。
 */
function setupMotionControls(): void {
  const manager = LAppDelegate.getInstance().getMainLive2DManager();
  if (!manager) return;

  type MotionEntry = { group: string; index: number; label: string };
  const state = {
    index: 0,
    entries: LAppDefine.MotionList.map(name => ({ group: name, index: 0, label: name })) as MotionEntry[]
  };

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.right = '16px';
  container.style.bottom = '16px';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.alignItems = 'flex-end';
  container.style.gap = '8px';
  container.style.padding = '8px';
  container.style.background = 'rgba(0,0,0,0.4)';
  container.style.borderRadius = '12px';
  container.style.zIndex = '10';
  container.style.bottom = '72px';

  const label = document.createElement('span');
  label.style.color = '#fff';
  label.style.fontFamily = 'Arial, sans-serif';
  label.style.fontSize = '14px';

  const updateLabel = (): void => {
    label.textContent = state.entries[state.index]?.label ?? '';
  };
  updateLabel();

  // Haru.model3.json からモーションを列挙（グループ内も展開して Idle[0], Idle[1] 形式で選択可能にする）
  fetch('/Resources/Haru/Haru.model3.json')
    .then(res => (res.ok ? res.json() : null))
    .then(json => {
      const motions = json?.FileReferences?.Motions;
      if (!motions) return;
      const flat: MotionEntry[] = [];
      (Object.entries(motions) as [string, unknown][]).forEach(([group, arr]) => {
        if (Array.isArray(arr)) {
          arr.forEach((_, idx) => flat.push({ group, index: idx, label: `${group}[${idx}]` }));
        }
      });
      if (flat.length > 0) {
        state.entries = flat;
        state.index = 0;
        updateLabel();
      }
    })
    .catch(err => console.warn('failed to load model3.json', err));

  const controlsRow = document.createElement('div');
  controlsRow.style.display = 'flex';
  controlsRow.style.alignItems = 'center';
  controlsRow.style.gap = '8px';

  const prevBtn = document.createElement('button');
  prevBtn.textContent = '◀';
  prevBtn.style.padding = '6px 10px';

  const nextBtn = document.createElement('button');
  nextBtn.textContent = '▶';
  nextBtn.style.padding = '6px 10px';

  controlsRow.appendChild(prevBtn);
  controlsRow.appendChild(label);
  controlsRow.appendChild(nextBtn);

  const playCurrent = (): void => {
    const entry = state.entries[state.index];
    if (!entry) return;
    label.textContent = entry.label;
    manager.playMotion(entry.group, entry.index);
  };

  prevBtn.addEventListener('click', () => {
    const len = state.entries.length;
    if (len === 0) return;
    state.index = (state.index - 1 + len) % len;
    updateLabel();
  });

  nextBtn.addEventListener('click', () => {
    const len = state.entries.length;
    if (len === 0) return;
    state.index = (state.index + 1) % len;
    updateLabel();
  });

  const playBtn = document.createElement('button');
  playBtn.textContent = '再生';
  playBtn.style.padding = '6px 12px';
  playBtn.style.width = '100%';

  playBtn.addEventListener('click', () => {
    playCurrent();
  });

  container.appendChild(controlsRow);
  container.appendChild(playBtn);

  document.body.appendChild(container);
  registerDemoElement(container);
}

/**
 * 左側に音声再生ボタンを設置し、リップシンクさせる。
 */
function setupVoiceButton(): void {
  const manager = LAppDelegate.getInstance().getMainLive2DManager();
  if (!manager) return;

  const audioPath = 'Resources/Haru/sounds/haru_Info_04.wav';
  const audio = new Audio(audioPath);
  audio.preload = 'auto';

  const btn = document.createElement('button');
  btn.textContent = 'Voice';
  btn.style.position = 'fixed';
  btn.style.left = '16px';
  btn.style.bottom = '16px';
  btn.style.padding = '8px 12px';
  btn.style.zIndex = '10';

  btn.addEventListener('click', () => {
    // 音声を再生しつつリップシンクに音源を渡す
    audio.currentTime = 0;
    audio.play();
    manager.playLipSyncFromFile(audioPath);
  });

  document.body.appendChild(btn);
  registerDemoElement(btn);
}

/**
 * 簡易チャットUI（テキスト入力と返信表示）。LLM連携は後で繋ぐ前提。
 */
function setupChatUI(): void {
  type InputMode = 'text' | 'voice';
  const API_BASE = 'http://127.0.0.1:8000';

  const panel = document.createElement('div');
  panel.style.position = 'fixed';
  panel.style.left = '16px';
  panel.style.top = '16px';
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
  panel.style.gap = '8px';
  panel.style.width = '280px';
  panel.style.padding = '12px';
  panel.style.background = 'rgba(0,0,0,0.4)';
  panel.style.borderRadius = '12px';
  panel.style.zIndex = '10';

  const modeState: { mode: InputMode; blob: Blob | null; recording: boolean } = {
    mode: 'text',
    blob: null,
    recording: false
  };

  const modeRow = document.createElement('div');
  modeRow.style.display = 'flex';
  modeRow.style.gap = '12px';
  modeRow.style.alignItems = 'center';

  const textRadio = document.createElement('input');
  textRadio.type = 'radio';
  textRadio.name = 'input-mode';
  textRadio.value = 'text';
  textRadio.checked = true;

  const textLabel = document.createElement('label');
  textLabel.textContent = '文章入力';
  textLabel.style.color = '#fff';

  const voiceRadio = document.createElement('input');
  voiceRadio.type = 'radio';
  voiceRadio.name = 'input-mode';
  voiceRadio.value = 'voice';

  const voiceLabel = document.createElement('label');
  voiceLabel.textContent = '音声入力';
  voiceLabel.style.color = '#fff';

  modeRow.appendChild(textRadio);
  modeRow.appendChild(textLabel);
  modeRow.appendChild(voiceRadio);
  modeRow.appendChild(voiceLabel);

  const input = document.createElement('textarea');
  input.rows = 3;
  input.placeholder = 'メッセージを入力';
  input.style.resize = 'vertical';
  input.style.width = '100%';

  const sendBtn = document.createElement('button');
  sendBtn.textContent = '送信';

  const recordBtn = document.createElement('button');
  recordBtn.textContent = '録音開始';
  recordBtn.style.display = 'none';

  const recordStatus = document.createElement('div');
  recordStatus.style.color = '#fff';
  recordStatus.style.fontSize = '12px';
  recordStatus.textContent = '';

  const replyText = document.createElement('div');
  replyText.style.color = '#fff';
  replyText.style.fontSize = '14px';

  const replyJson = document.createElement('pre');
  replyJson.style.margin = '0';
  replyJson.style.maxHeight = '180px';
  replyJson.style.overflow = 'auto';
  replyJson.style.color = '#fff';
  replyJson.style.background = 'rgba(255,255,255,0.06)';
  replyJson.style.padding = '8px';
  replyJson.style.borderRadius = '8px';

  const replyJsonTool = document.createElement('pre');
  replyJsonTool.style.margin = '0';
  replyJsonTool.style.maxHeight = '180px';
  replyJsonTool.style.overflow = 'auto';
  replyJsonTool.style.color = '#fff';
  replyJsonTool.style.background = 'rgba(255,255,255,0.06)';
  replyJsonTool.style.padding = '8px';
  replyJsonTool.style.borderRadius = '8px';

  async function postJson<T>(url: string, body: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  async function transcribeVoice(blob: Blob): Promise<string> {
    const fd = new FormData();
    fd.append('file', blob, 'voice.webm');
    try {
      const res = await fetch(`${API_BASE}/api/stt`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { text: string };
      return json.text;
    } catch (err) {
      console.error('文字起こしに失敗しました', err);
      return '（文字起こしに失敗しました）';
    }
  }

  function updateMode(mode: InputMode) {
    modeState.mode = mode;
    modeState.blob = null;
    modeState.recording = false;
    recordBtn.textContent = '録音開始';
    recordStatus.textContent = '';
    recordBtn.style.display = mode === 'voice' ? 'block' : 'none';
  }

  textRadio.addEventListener('change', () => {
    if (textRadio.checked) updateMode('text');
  });
  voiceRadio.addEventListener('change', () => {
    if (voiceRadio.checked) updateMode('voice');
  });

  let mediaRecorder: MediaRecorder | null = null;
  let chunkList: BlobPart[] = [];
  let forceVoice = false;

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      recordStatus.textContent = '録音に非対応のブラウザです';
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunkList = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) chunkList.push(e.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunkList, { type: 'audio/webm' });
        modeState.blob = blob;
        modeState.recording = false;
        recordBtn.textContent = '録音開始';
        recordStatus.textContent = '録音完了';
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorder.start();
      modeState.recording = true;
      recordBtn.textContent = '録音停止';
      recordStatus.textContent = '録音中...';
    } catch (err) {
      recordStatus.textContent = '録音開始に失敗しました';
      console.error(err);
    }
  }

  function stopRecording() {
    if (mediaRecorder && modeState.recording) {
      mediaRecorder.stop();
    }
  }

  recordBtn.addEventListener('click', () => {
    if (modeState.recording) {
      stopRecording();
    } else {
      startRecording();
    }
  });

  async function sendMessage() {
    disposeVoice();

    let userText = input.value.trim();

    if (modeState.mode === 'voice' || forceVoice) {
      if (!modeState.blob) {
        recordStatus.textContent = '録音データがありません';
        return;
      }
      userText = await transcribeVoice(modeState.blob);
      recordStatus.textContent = '文字起こし完了';
      modeState.blob = null;
    }

    try {
      const response = await postJson<LlmResponse>('/api/classify', {
        user_text: userText
      });

      replyText.textContent = response.reply_text;
      replyJson.textContent = JSON.stringify(response, null, 2);
      replyJsonTool.textContent = '';

      const motionId = response.motion ?? null;

      if (response.reply_text) {
        await playVoice(response.reply_text, {
          onPlay: motionId ? () => playMotionById(motionId) : undefined
        });
      } else if (motionId) {
        // 返答文が無い場合でもモーションだけは再生する
        playMotionById(motionId);
      }

      if (response.function) {
        const toolResult = await runTool({
          type: 'tool',
          name: response.function,
          args: null,
          user_text: userText
        });
        if (toolResult) {
          replyJsonTool.textContent = JSON.stringify(toolResult, null, 2);
        }
      }
    } catch (err) {
      replyText.textContent = 'サーバー呼び出しに失敗しました';
      replyJson.textContent = String(err);
    }
  }

  sendBtn.addEventListener('click', () => {
    void sendMessage();
  });

  let spaceRecording = false;
  let listeningOverlay: HTMLDivElement | null = null;

  function showListening() {
    if (listeningOverlay) return;
    const div = document.createElement('div');
    div.style.position = 'fixed';
    div.style.left = '50%';
    div.style.top = '50%';
    div.style.transform = 'translate(-50%, -50%)';
    div.style.padding = '10px 14px';
    div.style.background = 'rgba(0,0,0,0.75)';
    div.style.color = '#fff';
    div.style.fontSize = '14px';
    div.style.fontFamily = 'Arial, sans-serif';
    div.style.borderRadius = '10px';
    div.style.boxShadow = '0 8px 20px rgba(0,0,0,0.35)';
    div.style.zIndex = '200';
    div.textContent = '聞き取っています…';
    document.body.appendChild(div);
    listeningOverlay = div;
  }

  function hideListening() {
    if (listeningOverlay && listeningOverlay.parentNode) {
      listeningOverlay.parentNode.removeChild(listeningOverlay);
    }
    listeningOverlay = null;
  }

  window.addEventListener(
    'keydown',
    e => {
      if (e.code !== 'Space') return;
      if (spaceRecording) return;
      spaceRecording = true;
      e.preventDefault();
      forceVoice = true;
      const manager = LAppDelegate.getInstance().getMainLive2DManager();
      manager?.playMotion('Listen');
      showListening();
      if (!modeState.recording) {
        void startRecording();
      }
    },
    { passive: false }
  );

  window.addEventListener(
    'keyup',
    e => {
      if (e.code !== 'Space') return;
      if (!spaceRecording) return;
      spaceRecording = false;
      e.preventDefault();
      forceVoice = true;
      if (modeState.recording) {
        stopRecording();
        // 録音停止のonstopでblobがセットされるので少し待って送信
        window.setTimeout(() => {
          void sendMessage();
          forceVoice = false;
          hideListening();
        }, 150);
      } else {
        forceVoice = false;
        hideListening();
      }
    },
    { passive: false }
  );

  panel.appendChild(modeRow);
  panel.appendChild(input);
  panel.appendChild(recordBtn);
  panel.appendChild(recordStatus);
  panel.appendChild(sendBtn);
  panel.appendChild(replyText);
  panel.appendChild(replyJson);
  panel.appendChild(replyJsonTool);

  document.body.appendChild(panel);
  registerDemoElement(panel);
}

/**
 * デモ画面を表示するための隠しトリガー（右上5クリック）。
 */
function setupDemoToggle(): void {
  let tapCount = 0;
  let tapTimer: number | null = null;

  const hitArea = document.createElement('div');
  hitArea.style.position = 'fixed';
  hitArea.style.top = '0';
  hitArea.style.right = '0';
  hitArea.style.width = '72px';
  hitArea.style.height = '72px';
  hitArea.style.zIndex = '50';
  hitArea.style.cursor = 'default';
  hitArea.style.background = 'transparent';

  const resetTap = (): void => {
    tapCount = 0;
    if (tapTimer !== null) {
      window.clearTimeout(tapTimer);
      tapTimer = null;
    }
  };

  hitArea.addEventListener('click', () => {
    tapCount += 1;
    if (tapTimer !== null) {
      window.clearTimeout(tapTimer);
    }
    tapTimer = window.setTimeout(resetTap, 1500);

    if (tapCount >= 5) {
      resetTap();
      setDemoVisible(!demoVisible);
      console.info(`Demo UI ${demoVisible ? 'shown' : 'hidden'}`);
    }
  });

  document.body.appendChild(hitArea);
}

window.addEventListener(
  'load',
  (): void => {
    // Initialize WebGL and create the application instance
    if (!LAppDelegate.getInstance().initialize()) {
      return;
    }

    LAppDelegate.getInstance().run();

    // モーション切り替えUI
    setupMotionControls();

    // 音声＋リップシンク再生ボタン
    setupVoiceButton();

    // テキストチャットUI（LLM未接続）
    setupChatUI();

    // 初期状態は通常画面（デモUI非表示）
    setDemoVisible(false);

    // 右上5クリックでデモUIをトグル
    setupDemoToggle();
  },
  { passive: true }
);

/**
 * 終了時の処理
 */
window.addEventListener(
  'beforeunload',
  (): void => LAppDelegate.releaseInstance(),
  { passive: true }
);
