import type { ConnectionCreator } from "./types";

export const generateId = () => {
	return Bun.randomUUIDv7();
};

export const connectionCreator = (): ConnectionCreator => {
	return {
		ping,
		close,
		query,
	};
};

const ping = () => {
	return new Promise((res, rej) => {});
};

const close = () => {
	return new Promise((res, rej) => {});
};

const query = () => {
	return new Promise((res, rej) => {});
};
