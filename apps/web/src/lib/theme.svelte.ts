type Theme = 'light' | 'dark';

/** app.html のインラインスクリプトが描画前に data-theme を設定済み */
class ThemeState {
	current = $state<Theme>('light');

	init() {
		this.current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
	}

	toggle() {
		this.current = this.current === 'dark' ? 'light' : 'dark';
		document.documentElement.dataset.theme = this.current;
		try {
			localStorage.setItem('theme', this.current);
		} catch {
			// 保存できなくても表示の切り替えは有効
		}
	}
}

export const theme = new ThemeState();
