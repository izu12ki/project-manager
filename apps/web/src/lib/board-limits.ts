/**
 * カンバンの各列に最初に出すカードの数と、下へスクロールしたときに足す数。完了の列は最近完了にしたもの
 * （position の大きい方）から、それ以外の列は上（position の小さい方）から出す
 */
export const BOARD_PAGE_SIZE = 25;
/** 1 列に読み込めるカードの数の上限。超える分は課題一覧で見る（1 回の表示の CPU 時間を抑える） */
export const BOARD_COLUMN_MAX = 500;

/**
 * 列の課題の数を数える上限。超える列は「100+」と出す（数えるために列のすべての課題を読むと、
 * D1 の読み取りがプロジェクトの課題の数だけ増えるため）
 */
export const BOARD_COUNT_LIMIT = 100;

/** 列（ステータスのキー）ごとに読み込むカードの数。書いていない列は BOARD_PAGE_SIZE */
export type BoardLimits = Record<string, number>;
