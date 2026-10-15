import * as v from 'valibot';
import { command, query } from '$app/server';
import { remoteContext, runCommand, runQuery } from '$lib/server/remote-helpers';
import {
	countUnread,
	listNotifications,
	markAllRead,
	markRead
} from '$lib/server/services/notifications';

export const getUnreadCount = query(() => runQuery(() => countUnread(remoteContext())));

export const getNotifications = query(() => runQuery(() => listNotifications(remoteContext())));

export const openNotification = command(v.object({ id: v.string() }), ({ id }) =>
	runCommand(async () => {
		const res = await markRead(remoteContext(), id);
		void getUnreadCount().refresh();
		void getNotifications().refresh();
		return res;
	})
);

export const readAllNotifications = command(() =>
	runCommand(async () => {
		await markAllRead(remoteContext());
		void getUnreadCount().refresh();
		void getNotifications().refresh();
	})
);
