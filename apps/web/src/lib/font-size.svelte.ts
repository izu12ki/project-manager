export const FONT_SIZES = [
	{ value: 'normal', label: '標準' },
	{ value: 'large', label: '大' },
	{ value: 'xlarge', label: '特大' }
] as const;

export type FontSize = (typeof FONT_SIZES)[number]['value'];

/** app.html のインラインスクリプトが描画前に data-font-size を設定済み（標準のときは属性なし） */
class FontSizeState {
	current = $state<FontSize>('normal');

	init() {
		const v = document.documentElement.dataset.fontSize;
		this.current = v === 'large' || v === 'xlarge' ? v : 'normal';
	}

	set(size: FontSize) {
		this.current = size;
		if (size === 'normal') delete document.documentElement.dataset.fontSize;
		else document.documentElement.dataset.fontSize = size;
		try {
			if (size === 'normal') localStorage.removeItem('font-size');
			else localStorage.setItem('font-size', size);
		} catch {
			// 保存できなくても表示の切り替えは有効
		}
	}
}

export const fontSize = new FontSizeState();
