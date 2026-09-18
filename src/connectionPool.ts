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

		for (let i = 0; i < minConnections; i++) {
			const id = generateId();

			try {
				const connection = new Connection(id, this.config.connectionCreator);

				this.idleConnections.push(connection);

				this.emit("connect", connection);
			} catch (err: any) {
				// ERROR: if the connection creation failed
				this.emit("error");
				return;
			}
		}
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

	release(connection: Connection) {
		// 1. Validate connection health
		// 2. Return to idle pool or destroy
		// 3. Process next queued request
	}

	async isHealthy(connection: Connection) {
		// 1. Remove connection that exceeds the idleTime
		// TODO: currently this runs everytime so need to add some conditions
		await this.removeIdleTimeoutConn();

		try {
			// 2. Check if the connecction is marked for removal, if yes then just remove it
			const isConnMarkedForRemoval = connection.isMarkedForRemoval;

			if (isConnMarkedForRemoval) {
				const closeConn = await connection.close();
				return false;
			}

			// 3. Ping the connection & check for its status
			const pong = await connection.ping();

			if (!pong) {
				// If ping is false then close the connection
				const isClosed = await connection.close();
				return false;
			}

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
