import MarkdownIt from 'markdown-it';

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

export function renderMarkdown(src: string): string {
	return md.render(src);
}
