export class Connection {
	id: string;
	createdAt: Number;
	lastUsedAt: Number;
	state: "idle" | "in-use" | "destroyed";

	constructor(id: string, connectionCreator) {
		this.id = id;
		this.createdAt = Date.now();
		this.lastUsedAt = Date.now();
		this.state = "idle"; // 'idle' | 'in-use' | 'destroyed'
	}

	async ping() {
		// TODO: Validate connection is healthy
	}

	async close() {
		// TODO: Clean up resources
	}
}
