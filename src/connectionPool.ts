import { EventEmitter } from "node:events";

import { Connection } from "./connection";
import { connectionCreator, generateId } from "./utils";

import type { Config, WaitQueue } from "./types";

export class ConnectionPool extends EventEmitter {
	config: Config;
	idleConnections: Connection[];
	inUseConnections: Set<Connection>;
	waitQueue: WaitQueue[];
	state: "accepting" | "draining" | "destroyed";
	periodicCheckTimer!: NodeJS.Timeout | null;

	constructor(config: Config) {
		super();
		this.config = config;
		this.idleConnections = []; // Stack of idle connections
		this.inUseConnections = new Set(); // Connections currently in use
		this.waitQueue = []; // Queued acquire requests
		this.state = "accepting";

		this.init();
	}

	async init() {
		//INFO: Pre-allocate minConnections

		const minConnections = this.config.minConnections;

		// loop through minConnections and establish connections
		for (let i = 0; i < minConnections; i++) {
			const id = generateId();

			// TODO: Need to check this out
			try {
				const connection = new Connection(id, this.config.connectionCreator);

				this.idleConnections.push(connection);

				this.emit("connect", { connectionId: connection.id });
			} catch (err: any) {
				// ERROR: if the connection creation failed
				this.emit("error", { connectionId: id });
			}
		}

		// periodically check in the idleConnection which should get removed
		const timer = setInterval(
			() => this.removeIdleTimeoutConn(),
			this.config.connectionCheckInterval,
		);

		this.periodicCheckTimer = timer;
	}

	async acquire(timeout = this.config.acquireTimeout) {
		return new Promise((res, rej) => {
			// 1. Check for pool state & based on that do the other processing
			if (this.state === "destroyed" || this.state === "draining") {
				rej(new Error("Connection Pool is not accepting any request"));
				return;
			}

			const id = generateId();

			// 2. Start the timer
			const timer = setTimeout(() => {
				const queuedReqIdx = this.waitQueue.findIndex((req) => req.id === id);

				if (queuedReqIdx !== -1) {
					this.waitQueue.splice(queuedReqIdx, 1);
				}

				rej(new Error("Acquire Timeout"));
			}, timeout);

			// Helper function
			const connectionHelperHandler = (connection: Connection) => {
				clearTimeout(timer);
				connection.state = "in-use";
				this.inUseConnections.add(connection);
				this.emit("acquire", { connectionId: connection.id });
				res(connection);
			};

			// 3. Return idle connection if available
			const connection = this.idleConnections[0];

			if (connection) {
				this.idleConnections.shift();
				connectionHelperHandler(connection);
				return;
			}

			// 4. Create new connection if pool not full
			const poolSize = this.inUseConnections.size + this.idleConnections.length;

			if (poolSize < this.config.maxConnections) {
				try {
					const newConnection = new Connection(
						id,
						this.config.connectionCreator,
					);
					this.emit("connect", { connectionId: newConnection.id });
					connectionHelperHandler(newConnection);
					return;
				} catch (err: any) {
					// ERROR: if the connection creation failed
					clearTimeout(timer);
					this.emit("error");
					rej(new Error(err));
					return;
				}
			}

			// 5. Queue request if pool full
			const request = {
				id,
				res: connectionHelperHandler,
				rej,
				timer,
			};
			this.waitQueue.push(request);
		});
	}

	async release(connection: Connection) {
		try {
			// 1. Validate connection health
			const connectionHealth = await this.isHealthy(connection);

			if (!connectionHealth) {
			}
			// 2. Return to idle pool or destroy
			// 3. Process next queued request
		} catch (err: any) {}
	}

	async isHealthy(connection: Connection) {
		try {
			// 2. Ping the connection & check for its status
			const pong = await connection.ping();

			if (!pong)
				// If ping is false then close the connection
				return false;

			return true;
		} catch (err: any) {
			this.emit("error", err);
			return false;
		}
	}

	private async removeIdleTimeoutConn() {
		const idealConnToBeRemoved = this.idleConnections
			.map((val, idx) => ({ val, idx }))
			.filter((ele) => {
				// Take the connection last used time & get the curr time
				const connLastUsed = ele.val.lastUsedAt;
				const currTime = Date.now();

				// compare lastUsed & currTime (get the difference)
				const comparedTime = currTime - connLastUsed;
				// check if the compared time is greater than | equals or less than idleTimeout
				if (comparedTime >= this.config.idleTimeout) return;
			});

		// Loop through the connection that are to be get removed and close those conn
		for (const item of idealConnToBeRemoved) {
			try {
				await item.val.close();
			} catch (err: any) {
				this.emit("error", { err, connectionId: item.val.id });
			}
		}

		// Create a new array which dosent include the conn that are to be removed
		const filteredConnection = this.idleConnections.filter((remove, index) =>
			idealConnToBeRemoved.every((obj) => obj.val.id !== remove.id),
		);

		this.idleConnections = filteredConnection;

		return;
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
		// Return { idle, inUse, waiting, total, state }
		return {
			idle: this.idleConnections.length,
			inUse: this.inUseConnections.size,
			waiting: this.waitQueue.length,
			total: this.inUseConnections.size + this.idleConnections.length,
			state: this.state,
		};
	}
}
