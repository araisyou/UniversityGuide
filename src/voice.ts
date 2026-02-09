// VOICEVOX をブラウザから呼び出すクライアント。エンジンが HTTP で動いている前提。
// 音声はディスクに保存せず Blob URL でメモリ再生する。

import { LAppDelegate } from './lappdelegate';

type AudioQuery = {
  accent_phrases: unknown[];
  speedScale: number;
  pitchScale: number;
  intonationScale: number;
  volumeScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
  outputSamplingRate: number;
  outputStereo: boolean;
  kana: string;
};

const VOICEVOX_BASE = 'http://127.0.0.1:50021';
const DEFAULT_SPEAKER = 0; // 四国めたん

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
type QueueItem = {
  text: string;
  onPlay?: () => void;
  resolve: (ok: boolean) => void;
  reject: (err: unknown) => void;
};
const queue: QueueItem[] = [];
let runner: Promise<void> | null = null;
let warmupPromise: Promise<void> | null = null;
let warmedUp = false;

type PlayOptions = { onPlay?: () => void };

function cleanup() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

async function playLoop(): Promise<void> {
  if (runner) return runner;

  runner = (async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) continue;
      try {
        const ok = await playSingle(item.text, { onPlay: item.onPlay });
        item.resolve(ok);
      } catch (err) {
        item.reject(err);
      }
    }
    runner = null;
  })();

  return runner;
}

async function createAudioQuery(text: string, speaker: number): Promise<AudioQuery> {
  const res = await fetch(
    `${VOICEVOX_BASE}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`,
    {
      method: 'POST'
    }
  );
  if (!res.ok) {
    throw new Error(`audio_query に失敗しました: ${res.status}`);
  }
  return (await res.json()) as AudioQuery;
}

async function synthesize(query: AudioQuery, speaker: number): Promise<Blob> {
  const res = await fetch(`${VOICEVOX_BASE}/synthesis?speaker=${speaker}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query)
  });
  if (!res.ok) {
    throw new Error(`synthesis に失敗しました: ${res.status}`);
  }
  return await res.blob();
}

// エンジン初回の遅延を減らすため、サイレントに一度合成してウォームアップする
function warmupVoice(): Promise<void> | null {
  if (warmedUp) return null;
  if (warmupPromise) return warmupPromise;

  warmupPromise = (async () => {
    try {
      const query = await createAudioQuery('。', DEFAULT_SPEAKER);
      // 音量を下げてサイレント合成（再生はしない）
      query.volumeScale = 0;
      const blob = await synthesize(query, DEFAULT_SPEAKER);
      const url = URL.createObjectURL(blob);
      URL.revokeObjectURL(url);
      warmedUp = true;
    } catch (err) {
      console.warn('VOICEVOX warmup failed (continuing without warm cache)', err);
    } finally {
      warmupPromise = null;
    }
  })();

  return warmupPromise;
}

/**
 * テキストを VOICEVOX で音声化して再生する。前回の音声はクリーンアップする。
 */
export async function playVoice(text: string, options?: PlayOptions): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  if (text.trim().length === 0) return false;

  void warmupVoice();

  const p = new Promise<boolean>((resolve, reject) => {
    queue.push({ text, onPlay: options?.onPlay, resolve, reject });
  });
  void playLoop();
  return p;
}

/**
 * 現在の音声を停止・破棄する。次の入力を受け付ける前に呼び出す。
 */
export function disposeVoice(): void {
  while (queue.length > 0) {
    const item = queue.shift();
    item?.resolve(false);
  }
  runner = null;
  cleanup();
}

async function playSingle(text: string, options?: PlayOptions): Promise<boolean> {
  cleanup();

  try {
    const query = await createAudioQuery(text, DEFAULT_SPEAKER);
    const blob = await synthesize(query, DEFAULT_SPEAKER);
    currentUrl = URL.createObjectURL(blob);
    currentAudio = new Audio(currentUrl);

    const manager = LAppDelegate.getInstance().getMainLive2DManager();
    if (manager) {
      manager.playLipSyncFromFile(currentUrl);
    }

    await currentAudio.play();

    // 再生が開始できたタイミングでモーションなどを同期開始する
    if (options?.onPlay) {
      try {
        options.onPlay();
      } catch (err) {
        console.warn('onPlay callback failed', err);
      }
    }

    await new Promise<void>(resolve => {
      const finalize = () => {
        cleanup();
        resolve();
      };
      currentAudio?.addEventListener('ended', finalize, { once: true });
      currentAudio?.addEventListener('error', finalize, { once: true });
    });
    return true;
  } catch (err) {
    console.error('音声合成に失敗しました', err);
    cleanup();
    return false;
  }
}
