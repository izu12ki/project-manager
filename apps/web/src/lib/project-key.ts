/** プロジェクトキーの最大文字数 */
export const PROJECT_KEY_MAX = 25;
/** プロジェクトキーの正規表現（アンカーなし。正規表現に埋め込んで使う） */
export const PROJECT_KEY_PATTERN = '[A-Z][A-Z0-9_]{1,24}';
/** 入力欄の pattern（大文字化はサーバーで行う） */
export const PROJECT_KEY_INPUT_PATTERN = '[A-Za-z][A-Za-z0-9_]*';
/** 画面とエラーメッセージに出すキーの規則 */
export const PROJECT_KEY_RULE = '英字で始まる2〜25文字の英数字とアンダースコア（_）';
