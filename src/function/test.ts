function renderOverlay(text: string) {
	if (typeof document === 'undefined') return { ok: false, reason: 'no DOM' };

	const existing = document.getElementById('test-tool-overlay');
	if (existing) existing.remove();

	const backdrop = document.createElement('div');
	backdrop.id = 'test-tool-overlay';
	backdrop.style.position = 'fixed';
	backdrop.style.inset = '0';
	backdrop.style.display = 'flex';
	backdrop.style.alignItems = 'center';
	backdrop.style.justifyContent = 'center';
	backdrop.style.zIndex = '999';
	backdrop.style.pointerEvents = 'none';

	const panel = document.createElement('div');
	panel.style.minWidth = '280px';
	panel.style.minHeight = '160px';
	panel.style.background = '#fff';
	panel.style.color = '#000';
	panel.style.display = 'flex';
	panel.style.alignItems = 'center';
	panel.style.justifyContent = 'center';
	panel.style.fontFamily = 'Arial, sans-serif';
	panel.style.fontSize = '24px';
	panel.style.boxShadow = '0 12px 32px rgba(0,0,0,0.25)';
	panel.style.borderRadius = '12px';
	panel.textContent = text;

	backdrop.appendChild(panel);
	document.body.appendChild(backdrop);
	return { ok: true };
}

export default function run(payload?: unknown) {
	const userText =
		payload && typeof payload === 'object' && 'user_text' in payload
			? // eslint-disable-next-line @typescript-eslint/no-explicit-any
				((payload as any).user_text as string | null)
			: null;

	const text = userText && userText.trim().length > 0 ? userText : 'テスト';
	console.log('test tool executed', payload);
	const result = renderOverlay(text);
	return { ok: true, echo: payload ?? null, overlay: result.ok };
}
