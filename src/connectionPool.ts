import { EventEmitter } from "node:events";

import { Connection } from "./connection";
import { connectionCreator, generateId } from "./utils";

import type { Config } from "./types";

export class ConnectionPool extends EventEmitter {
	config: Config;
	idleConnections: Connection[];
	inUseConnections: Set<string>;
	waitQueue: string[];
	state: "accepting" | "draining" | "destroyed";

	constructor(config: Config) {
		super();
		this.config = config;
		this.idleConnections = []; // Stack of idle connections
		this.inUseConnections = new Set(); // Connections currently in use
		this.waitQueue = []; // Queued acquire requests
		this.state = "accepting"; // 'accepting' | 'draining' | 'destroyed'

		this.init();
	}

	async init() {
		//INFO: Pre-allocate minConnections

		const minConnections = this.config.minConnections;

		for (let i = 0; i < minConnections; i++) {
			const id = generateId();

			const connection = new Connection(id, connectionCreator);

			this.idleConnections.push(connection);

			this.emit("connect", connection);
		}
	}

	async acquire(timeout = this.config.acquireTimeout) {
		// 1. Return idle connection if available
		// 2. Create new connection if pool not full
		// 3. Queue request if pool full
		// 4. Reject if timeout exceeded or pool destroyed
	}

	release(connection: Connection) {
		// TODO
		// 1. Validate connection health
		// 2. Return to idle pool or destroy
		// 3. Process next queued request
	}

	async drain() {
		// TODO
		// Stop accepting new requests, allow in-flight to finish
	}

	async destroy() {
		// TODO
		// Force-close everything immediately
	}

	getStats() {
		// TODO
		// Return { idle, inUse, waiting, total, state }
	}
}

/*

- initialize the ORM / DB driver [in my case its mock Db]

- First ConnectionPool will get initialized which is I think the init() method

- The n (its the minConnections) number of Connections will get created with id = 1,2 & state will be idle

- the init() metod will initialize the minConnections

- so after each & every connection is being created then "connect" event will get emmited [I am not sure about that]

- when any db query is done so first it uses these minConnections

- if there are more db querry requires then more connection will get created [acquire method will be used here]

- acquire will check if there is any idel connection and if not then it will create a new connection if the connection dosent exceeds maxConnections otherwise it will send it to queue

- drain method will first set the state to draining for stop acqueiring more requests and whatever connecction are still there it will IG destroy the connection and shut down

- destroy will destroy all connections and force shut down

- getStats will give the stats of the ConnectionPool

- ConnectionPool has a instance variable called state which states the lifecycle of the Pool


*/
