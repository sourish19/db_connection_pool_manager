import type { ConnectionCreator } from "./types";

export class Connection {
	id: string;
	createdAt: number;
	lastUsedAt: number;
	state: "idle" | "in-use" | "destroyed";
	mock: null | ConnectionCreator;
	isMarkedForRemoval: boolean;
	connectionCreator: () => ConnectionCreator;

	constructor(id: string, connectionCreator: () => ConnectionCreator) {
		this.id = id;
		this.createdAt = Date.now();
		this.lastUsedAt = Date.now();
		this.state = "idle";
		this.connectionCreator = connectionCreator;
		this.mock = null;
		this.isMarkedForRemoval = false;

		this.init();
	}

	init() {
		const mockConnection = this.connectionCreator();
		this.mock = mockConnection;
	}

	async query(sql: string) {
		// INFO: Validate connection is healthy
		if (this.mock === null || this.state === "destroyed")
			throw new Error("Connection is not initialized or it is destroyed");

		try {
			const dbQuerry = await this.mock.query(sql);

			this.lastUsedAt = Date.now();

			return dbQuerry;
		} catch (err: any) {
			this.isMarkedForRemoval = true;
			throw new Error(err);
		}
	}

	async ping() {
		// INFO: Validate connection is healthy
		if (this.mock === null || this.state === "destroyed")
			throw new Error("Connection is not initialized or destroyed");

		try {
			const pong = await this.mock.ping();

			return pong;
		} catch (err: any) {
			throw new Error("Error occured");
		}
	}

	async close() {
		// INFO: Clean up resources
		if (this.mock === null || this.state === "destroyed")
			throw new Error("Connection is not initialized or destroyed");

		try {
			const closeDb = await this.mock.close();

			this.state = "destroyed";
			this.mock = null;

			return closeDb;
		} catch (err: any) {
			throw new Error("Error occured");
		}
	}
}
