import type { ConnectionCreator } from "./types";

export class Connection {
	id: string;
	createdAt: number;
	lastUsedAt: number;
	state: "idle" | "in-use" | "destroyed";
	mock: null | ConnectionCreator;
	connectionCreator: () => ConnectionCreator;

	constructor(id: string, connectionCreator: () => ConnectionCreator) {
		this.id = id;
		this.createdAt = Date.now();
		this.lastUsedAt = Date.now();
		this.state = "idle";
		this.connectionCreator = connectionCreator;
		this.mock = null;

		this.init();
	}

	init() {
		const mockConnection = this.connectionCreator();
		this.mock = mockConnection;
	}

	async ping() {
		// INFO: Validate connection is healthy
		if (this.mock === null || this.state === "destroyed")
			throw new Error("Connection is not initialized or destroyed");

		const pong = await this.mock.ping();

		if (!pong) {
			this.close();
			return false;
		}

		return true;
	}

	async close() {
		// INFO: Clean up resources
		this.state = "destroyed";
		this.mock = null;
		return true;
	}
}
