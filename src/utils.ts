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

const delay = (): Promise<void> => {
	const timeout = Math.floor(Math.random() * 5) + 1;

	return new Promise((res) => {
		setTimeout(res, timeout * 1000);
	});
};

const ping = async (): Promise<boolean> => {
	const generateRandomNum = Math.floor(Math.random() * 10) + 1;

	await delay();

	if (generateRandomNum < 8) {
		return true;
	} else if (generateRandomNum < 10) {
		return false;
	} else {
		throw new Error("Database Connection Error");
	}
};

const close = async () => {
	await delay();

	return {
		success: true,
		message: "Database Connection Closed",
	};
};

const query = async (sql: string) => {
	const generateRandomNum = Math.floor(Math.random() * 100) + 1;

	await delay();

	if (generateRandomNum !== 9) {
		return [{ success: true, message: "mock query from db" }];
	} else {
		throw new Error("Database Connection Error");
	}
};
