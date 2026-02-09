import { playVoice, disposeVoice } from '../voice';

type MapPoint = { x: number; y: number };
type MapConfig = { units?: 'percent' | 'px'; points: Record<string, MapPoint> };
type MapResponse = {
	reply_text: string;
	map_point: number | string | null;
	user_text?: string | null;
	motion?: string | null;
	function?: string | null;
};

const API_BASE = 'http://127.0.0.1:8000';
const MAP_IMAGE_SRC = '/Resources/c_map_toyota.jpg';
const PIN_IMAGE_SRC = '/Resources/pin.png';
const OVERLAY_ID = 'map-overlay';
const DEFAULT_IMG_WIDTH = 1920;
const DEFAULT_IMG_HEIGHT = 1080;

let mapConfigPromise: Promise<MapConfig | null> | null = null;
let mapImageInfoPromise: Promise<{ width: number; height: number }> | null = null;

async function loadMapConfig(): Promise<MapConfig | null> {
	if (!mapConfigPromise) {
		mapConfigPromise = fetch('/map.json')
			.then(res => (res.ok ? (res.json() as Promise<MapConfig>) : null))
			.catch((): MapConfig | null => null);
	}
	return mapConfigPromise;
}

function removeOverlay(): void {
	if (typeof document === 'undefined') return;
	const existing = document.getElementById(OVERLAY_ID);
	if (existing) existing.remove();
}

function getCoords(config: MapConfig | null, point: number | string): MapPoint | null {
	if (!config || !config.points) return null;
	const key = String(point);
	const entry = config.points[key];
	if (!entry || typeof entry.x !== 'number' || typeof entry.y !== 'number') return null;
	return entry;
}

async function loadMapImageInfo(): Promise<{ width: number; height: number }> {
	if (mapImageInfoPromise) return mapImageInfoPromise;

	mapImageInfoPromise = new Promise(resolve => {
		const img = new Image();
		img.onload = () => {
			if (img.naturalWidth > 0 && img.naturalHeight > 0) {
				resolve({ width: img.naturalWidth, height: img.naturalHeight });
			} else {
				resolve({ width: DEFAULT_IMG_WIDTH, height: DEFAULT_IMG_HEIGHT });
			}
		};
		img.onerror = () => resolve({ width: DEFAULT_IMG_WIDTH, height: DEFAULT_IMG_HEIGHT });
		img.src = MAP_IMAGE_SRC;
	});

	return mapImageInfoPromise;
}

function renderOverlay(replyText: string, coords: MapPoint | null, units: 'percent' | 'px', imgSize: { width: number; height: number }): void {
	if (typeof document === 'undefined') return;
	removeOverlay();

	const wrapper = document.createElement('div');
	wrapper.id = OVERLAY_ID;
	wrapper.style.position = 'fixed';
	wrapper.style.inset = '0';
	wrapper.style.display = 'flex';
	wrapper.style.alignItems = 'center';
	wrapper.style.justifyContent = 'center';
	wrapper.style.background = 'rgba(0,0,0,0.55)';
	wrapper.style.zIndex = '120';

	const panel = document.createElement('div');
	panel.style.position = 'relative';
	panel.style.background = `url('${MAP_IMAGE_SRC}') center / contain no-repeat`;
	panel.style.borderRadius = '12px';
	panel.style.boxShadow = '0 12px 32px rgba(0,0,0,0.35)';
	panel.style.overflow = 'hidden';

	let resizeObserver: ResizeObserver | null = null;

	const teardown = () => {
		if (resizeObserver) {
			resizeObserver.disconnect();
			resizeObserver = null;
		}
		window.removeEventListener('resize', placePin);
		window.removeEventListener('keydown', onKeyDown);
	};

	const sizePanel = () => {
		const { width: imgW, height: imgH } = imgSize;
		const maxW = window.innerWidth * 0.8;
		const maxH = window.innerHeight * 0.85;
		const scale = Math.min(maxW / imgW, maxH / imgH, 1);
		panel.style.width = `${imgW * scale}px`;
		panel.style.height = `${imgH * scale}px`;
	};

	const placePin = () => {
		sizePanel();
		// remove previous markers to avoid duplicates on resize
		panel.querySelectorAll('[data-pin-overlay="1"]').forEach(el => el.remove());

		const rect = panel.getBoundingClientRect();
		const { width: imgW, height: imgH } = imgSize;
		const scale = Math.min(rect.width / imgW, rect.height / imgH);
		const drawW = imgW * scale;
		const drawH = imgH * scale;
		const offsetX = (rect.width - drawW) / 2;
		const offsetY = (rect.height - drawH) / 2;

		if (coords) {
			const pin = document.createElement('div');
			pin.dataset.pinOverlay = '1';
			pin.style.position = 'absolute';
			pin.style.width = '32px';
			pin.style.height = '48px';

			const baseX = units === 'percent' ? (coords.x / 100) * imgW : coords.x;
			const baseY = units === 'percent' ? (coords.y / 100) * imgH : coords.y;
			const left = offsetX + baseX * scale;
			const top = offsetY + baseY * scale;

			pin.style.left = `${left}px`;
			pin.style.top = `${top}px`;
			pin.style.transform = 'translate(-50%, -100%)';
			pin.style.background = `url('${PIN_IMAGE_SRC}') center / contain no-repeat`;
			pin.style.filter = 'drop-shadow(0 4px 8px rgba(0,0,0,0.45))';
			pin.style.pointerEvents = 'none';
			pin.style.backgroundColor = 'transparent';
			pin.style.borderRadius = '50%';
			panel.appendChild(pin);
		} else {
			const fallback = document.createElement('div');
			fallback.dataset.pinOverlay = '1';
			fallback.textContent = '位置データがありません';
			fallback.style.position = 'absolute';
			fallback.style.left = '50%';
			fallback.style.top = '50%';
			fallback.style.transform = 'translate(-50%, -50%)';
			fallback.style.color = '#fff';
			fallback.style.fontSize = '16px';
			fallback.style.padding = '8px 12px';
			fallback.style.background = 'rgba(0,0,0,0.5)';
			fallback.style.borderRadius = '8px';
			panel.appendChild(fallback);
		}

	};

	const onKeyDown = (ev: KeyboardEvent) => {
		if (ev.code === 'Space') {
			ev.preventDefault();
			teardown();
			removeOverlay();
		}
	};

	const closeBtn = document.createElement('button');
	closeBtn.textContent = '閉じる';
	closeBtn.style.position = 'absolute';
	closeBtn.style.top = '12px';
	closeBtn.style.right = '12px';
	closeBtn.style.padding = '6px 10px';
	closeBtn.style.borderRadius = '8px';
	closeBtn.style.border = 'none';
	closeBtn.style.cursor = 'pointer';
	closeBtn.style.background = 'rgba(0,0,0,0.65)';
	closeBtn.style.color = '#fff';
	closeBtn.style.backdropFilter = 'blur(6px)';
	closeBtn.addEventListener('click', ev => {
		ev.stopPropagation();
		teardown();
		removeOverlay();
	});
	panel.appendChild(closeBtn);

	wrapper.appendChild(panel);
	document.body.appendChild(wrapper);

	// パネルがDOMに入った後で計算し、リサイズにも追従
	placePin();
	resizeObserver = new ResizeObserver(() => placePin());
	resizeObserver.observe(panel);
	window.addEventListener('resize', placePin);
	window.addEventListener('keydown', onKeyDown);
}

async function callMapApi(userText: string): Promise<MapResponse | null> {
	try {
		const res = await fetch(`${API_BASE}/api/map`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ user_text: userText })
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return (await res.json()) as MapResponse;
	} catch (err) {
		console.error('map api failed', err);
		return null;
	}
}

export default async function run(payload?: unknown) {
	if (typeof document === 'undefined') return { ok: false, reason: 'no DOM' };

	const userText =
		payload && typeof payload === 'object' && 'user_text' in payload
			? // eslint-disable-next-line @typescript-eslint/no-explicit-any
				((payload as any).user_text as string | null)
			: null;

	const text = userText && userText.trim().length > 0 ? userText : '地図を開きます';

	const mapRes = await callMapApi(text);
	if (!mapRes) {
		const imgInfo = await loadMapImageInfo();
		renderOverlay('地図呼び出しに失敗しました', null, 'percent', imgInfo);
		return { ok: false };
	}

	const config = await loadMapConfig();
	const coords = mapRes.map_point && Number(mapRes.map_point) !== 0 ? getCoords(config, mapRes.map_point) : null;
	const imgInfo = await loadMapImageInfo();
	const units = (config?.units ?? 'percent') as 'percent' | 'px';

	renderOverlay(mapRes.reply_text, coords, units, imgInfo);

	disposeVoice();
	void playVoice(mapRes.reply_text);

	return {
		reply_text: mapRes.reply_text,
		map_point: mapRes.map_point
	};
}
