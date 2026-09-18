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

const delay = (delayTime: number): Promise<void> => {
	const timeout = Math.floor(Math.random() * 5) + 1;

	return new Promise((res) => {
		setTimeout(res, timeout * delayTime);
	});
};

const ping = async () => {
	const generateRandomNum = Math.floor(Math.random() * 100) + 1;

	await delay(10);

	if (generateRandomNum !== 8 && generateRandomNum !== 71) {
		return true;
	} else if (generateRandomNum === 8) {
		return false;
	} else if (generateRandomNum === 71) {
		throw new Error("Database Connection Error");
	}
};

const close = async () => {
	const generateRandomNum = Math.floor(Math.random() * 10) + 1;

	await delay(20);

	if (generateRandomNum !== 8) {
		return {
			success: true,
			message: "Database Connection Closed",
		};
	} else {
		throw new Error("Database Connection Error");
	}
};

const query = async (sql: string) => {
	const generateRandomNum = Math.floor(Math.random() * 100) + 1;

	await delay(30);

	if (generateRandomNum !== 9) {
		return [{ success: true, message: "mock query from db" }];
	} else {
		throw new Error("Database Query Error");
	}
};
