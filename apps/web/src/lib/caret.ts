// textarea と同じ見た目のミラー要素を作り、pos の位置に置いた span の座標を測る
const COPIED = [
	'box-sizing',
	'width',
	'border-top-width',
	'border-right-width',
	'border-bottom-width',
	'border-left-width',
	'padding-top',
	'padding-right',
	'padding-bottom',
	'padding-left',
	'font-style',
	'font-variant',
	'font-weight',
	'font-stretch',
	'font-size',
	'line-height',
	'font-family',
	'text-align',
	'text-transform',
	'text-indent',
	'letter-spacing',
	'word-spacing',
	'tab-size'
];

export function caretRect(
	el: HTMLTextAreaElement,
	pos: number
): { left: number; top: number; bottom: number } {
	const cs = getComputedStyle(el);
	const mirror = document.createElement('div');
	for (const p of COPIED) mirror.style.setProperty(p, cs.getPropertyValue(p));
	mirror.style.setProperty('position', 'absolute');
	mirror.style.setProperty('visibility', 'hidden');
	mirror.style.setProperty('white-space', 'pre-wrap');
	mirror.style.setProperty('overflow-wrap', 'break-word');
	mirror.style.setProperty('top', '0');
	mirror.style.setProperty('left', '-9999px');
	mirror.textContent = el.value.slice(0, pos);
	const marker = document.createElement('span');
	marker.textContent = el.value.slice(pos) || '.';
	mirror.appendChild(marker);
	document.body.appendChild(mirror);
	const box = el.getBoundingClientRect();
	const left = box.left + marker.offsetLeft - el.scrollLeft;
	const top = box.top + marker.offsetTop - el.scrollTop;
	const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
	mirror.remove();
	return { left, top, bottom: top + lineHeight };
}
