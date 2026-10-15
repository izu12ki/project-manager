import type { BaseContext } from '../../context';
import type { IntegrationProviderId } from '../../db/schema';
import { slack } from './slack';
import type { ChannelConfig, UserChannelProvider } from './types';

export type { ChannelConfig, DirectMessage, UserChannelProvider } from './types';
export { toDirectMessage, type DmSource } from './message';

export const providers: Record<IntegrationProviderId, UserChannelProvider> = { slack };

/** そのサービスの資格情報が設定されていなければ null */
export function channelConfig(ctx: BaseContext, id: IntegrationProviderId): ChannelConfig | null {
	const token = { slack: ctx.slackBotToken }[id];
	return token ? { fetch: ctx.fetch, token } : null;
}
