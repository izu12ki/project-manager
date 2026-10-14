import MarkdownIt from 'markdown-it';
import { MENTION_SOURCE } from '$lib/mentions';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

const defaultLinkOpen =
	md.renderer.rules.link_open ??
	((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
	tokens[idx].attrSet('rel', 'noopener noreferrer nofollow');
	tokens[idx].attrSet('target', '_blank');
	return defaultLinkOpen(tokens, idx, options, env, self);
};

const defaultImage = md.renderer.rules.image!;

// 拡大表示（ImageLightbox）の対象にするため包む
md.renderer.rules.image = (tokens, idx, options, env, self) =>
	`<span class="md-img">${defaultImage(tokens, idx, options, env, self)}</span>`;

const mentionAt = new RegExp(`^${MENTION_SOURCE}`);

// '@' は markdown-it の text ルールの区切り文字なので、文中の '@' でもこのルールに届く
md.inline.ruler.before('link', 'mention', (state, silent) => {
	if (state.src.charCodeAt(state.pos) !== 0x40 /* @ */) return false;
	const m = mentionAt.exec(state.src.slice(state.pos));
	if (!m) return false;
	if (!silent) state.push('mention', '', 0).content = m[1];
	state.pos += m[0].length;
	return true;
});

md.renderer.rules.mention = (tokens, idx) =>
	`<span class="mention">@${md.utils.escapeHtml(tokens[idx].content)}</span>`;

export function renderMarkdown(src: string): string {
	return md.render(src);
}
