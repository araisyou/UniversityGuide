import { playVoice, disposeVoice } from '../voice';
import { LAppDelegate } from '../lappdelegate';

type ChatPayload = {
	user_text?: string | null;
};

type ChatResponse = {
	reply_text: string;
	motion?: string | null;
};

const API_BASE = 'http://127.0.0.1:8000';

async function callChatApi(userText: string): Promise<ChatResponse> {
	const res = await fetch(`${API_BASE}/api/chat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ user_text: userText })
	});
	if (!res.ok) {
		throw new Error(`chat api failed: ${res.status}`);
	}
	return (await res.json()) as ChatResponse;
}

export default async function run(payload?: unknown) {
	if (typeof document === 'undefined') return { ok: false, reason: 'no DOM' };

	const userText =
		payload && typeof payload === 'object' && 'user_text' in payload
			? // eslint-disable-next-line @typescript-eslint/no-explicit-any
				((payload as any).user_text as string | null)
			: null;
	const textForApi = userText && userText.trim().length > 0 ? userText : 'こんにちは';

	const apiRes = await callChatApi(textForApi);
	const reply = apiRes.reply_text ?? '';
	const motionId = apiRes.motion ?? null;

	if (reply) {
		disposeVoice();
		const manager = LAppDelegate.getInstance().getMainLive2DManager();
		void playVoice(reply, {
			onPlay: motionId ? () => manager?.playMotion(motionId) : undefined
		});
	} else if (motionId) {
		const manager = LAppDelegate.getInstance().getMainLive2DManager();
		manager?.playMotion(motionId);
	}

	return {reply_text: reply, motion: motionId };
}
