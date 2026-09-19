import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ConnectionPool } from "./connectionPool";
import { Connection } from "./connection";
import { connectionCreator, generateId } from "./utils";

describe("ConnectionPool", () => {
	let pool: ConnectionPool;
	const defaultConfig = {
		minConnections: 2,
		maxConnections: 5,
		acquireTimeout: 3000,
		idleTimeout: 10000,
		connectionCheckInterval: 5000,
		connectionCreator,
	};

	beforeEach(() => {
		pool = new ConnectionPool(defaultConfig);
	});

	afterEach(async () => {
		await pool.destroy();
	});

	// INFO: Initialization & setup --
	describe("Initialization", () => {
		it("should create minConnections on init", async () => {
			await new Promise((res) => setTimeout(res, 100));
			const stats = pool.getStats();
			expect(stats.idle).toBe(2);
			expect(stats.inUse).toBe(0);
			expect(stats.total).toBe(2);
		});

		it("should set pool state to accepting", async () => {
			const stats = pool.getStats();
			expect(stats.state).toBe("accepting");
		});
	});

	// INFO: acquire tests --
	describe("Acquire", () => {
		it("should return idle connection if available", async () => {
			const conn = await pool.acquire();
			expect(conn).toBeDefined();
			expect(conn.state).toBe("in-use");
		});

		it("should move connection from idle to in-use", async () => {
			const before = pool.getStats();
			const conn = await pool.acquire();
			const after = pool.getStats();

			expect(before.idle).toBe(2);
			expect(after.idle).toBe(1);
			expect(after.inUse).toBe(1);
		});

		it("should create new connection if pool not full", async () => {
			const conn1 = await pool.acquire();
			const conn2 = await pool.acquire();
			const conn3 = await pool.acquire();

			const stats = pool.getStats();
			expect(stats.total).toBe(3);
			expect(stats.inUse).toBe(3);
		});

		it("should not exceed maxConnections", async () => {
			const conns = [];
			for (let i = 0; i < 5; i++) {
				conns.push(await pool.acquire());
			}

			const stats = pool.getStats();
			expect(stats.total).toBe(5);
		});

		it("should queue request when pool full", async () => {
			const conns = [];
			for (let i = 0; i < 5; i++) {
				conns.push(await pool.acquire());
			}

			const acquirePromise = pool.acquire(1000);
			const stats = pool.getStats();
			expect(stats.waiting).toBe(1);

			pool.release(conns[0]);
			const conn = await acquirePromise;
			expect(conn).toBeDefined();
		});

		it("should reject on timeout", async () => {
			const conns = [];
			for (let i = 0; i < 5; i++) {
				conns.push(await pool.acquire());
			}

			let timeoutError = false;
			try {
				await pool.acquire(100);
			} catch (err) {
				timeoutError = true;
				expect(err.message).toContain("timeout");
			}
			expect(timeoutError).toBe(true);
		});

		it("should reject when pool is destroyed", async () => {
			await pool.destroy();

			let destroyedError = false;
			try {
				await pool.acquire();
			} catch (err) {
				destroyedError = true;
				expect(err.message).toContain("destroyed");
			}
			expect(destroyedError).toBe(true);
		});

		it("should reject when pool is draining", async () => {
			await pool.drain();

			let drainingError = false;
			try {
				await pool.acquire();
			} catch (err) {
				drainingError = true;
				expect(err.message).toContain("draining");
			}
			expect(drainingError).toBe(true);
		});

		it("should clean up timeout from queue on rejection", async () => {
			const conns = [];
			for (let i = 0; i < 5; i++) {
				conns.push(await pool.acquire());
			}

			try {
				await pool.acquire(100);
			} catch (err) {
				// ignore
			}

			const stats = pool.getStats();
			expect(stats.waiting).toBe(0);
		});
	});

	// INFO: release tests --
	describe("Release", () => {
		it("should return connection to idle pool", async () => {
			const conn = await pool.acquire();
			await pool.release(conn);

			const stats = pool.getStats();
			expect(stats.idle).toBe(2);
			expect(stats.inUse).toBe(0);
		});

		it("should update connection state to idle", async () => {
			const conn = await pool.acquire();
			await pool.release(conn);

			expect(conn.state).toBe("idle");
		});

		it("should process next queued request on release", async () => {
			const conns = [];
			for (let i = 0; i < 5; i++) {
				conns.push(await pool.acquire());
			}

			const acquirePromise = pool.acquire(5000);
			await new Promise((res) => setTimeout(res, 50));

			await pool.release(conns[0]);
			const conn = await acquirePromise;
			expect(conn).toBeDefined();

			const stats = pool.getStats();
			expect(stats.waiting).toBe(0);
		});

		it("should destroy unhealthy connection", async () => {
			const conn = await pool.acquire();
			conn.mock.ping = async () => false; // Mark unhealthy

			await pool.release(conn);
			const stats = pool.getStats();

			expect(conn.state).toBe("destroyed");
		});

		it("should process queue in FIFO order", async () => {
			const conns = [];
			for (let i = 0; i < 5; i++) {
				conns.push(await pool.acquire());
			}

			const order = [];
			const prom1 = pool.acquire(5000).then(() => order.push(1));
			const prom2 = pool.acquire(5000).then(() => order.push(2));
			const prom3 = pool.acquire(5000).then(() => order.push(3));

			await new Promise((res) => setTimeout(res, 50));

			pool.release(conns[0]);
			pool.release(conns[1]);
			pool.release(conns[2]);

			await Promise.all([prom1, prom2, prom3]);
			expect(order).toEqual([1, 2, 3]);
		});
	});

	// INFO: concurency tests --
	describe("Concurrency", () => {
		it("should handle 10 simultaneous acquires without race conditions", async () => {
			const acquirePromises: Promise<Connection>[] = [];

			for (let i = 0; i < 10; i++) {
				acquirePromises.push(pool.acquire());
			}

			// Wait for the first 5 connections to be acquired
			const acquiredConnections = await Promise.all(
				acquirePromises.slice(0, 5),
			);

			const stats = pool.getStats();

			expect(acquiredConnections.length).toBe(5);
			expect(stats.total).toBe(5);
			expect(stats.inUse).toBe(5);
			expect(stats.waiting).toBe(5);

			// Release one connection
			await pool.release(acquiredConnections[0]);

			// The first queued request should now resolve
			const queuedConnection = await acquirePromises[5];

			expect(queuedConnection).toBeDefined();

			const updatedStats = pool.getStats();

			expect(updatedStats.total).toBe(5);
			expect(updatedStats.inUse).toBe(5);
			expect(updatedStats.waiting).toBe(4);

			// Cleanup remaining acquired connections
			for (const connection of acquiredConnections.slice(1)) {
				await pool.release(connection);
			}

			await pool.release(queuedConnection);
		});

		it("should not exceed maxConnections under load", async () => {
			const promises = [];
			for (let i = 0; i < 50; i++) {
				promises.push(
					pool.acquire(1000).catch(() => {
						/* ignore timeout */
					}),
				);
			}

			await Promise.all(promises);
			const stats = pool.getStats();
			expect(stats.total).toBeLessThanOrEqual(5);
		});

		it("should handle interleaved acquire/release", async () => {
			const conns = [];
			for (let i = 0; i < 5; i++) {
				conns.push(await pool.acquire());
			}

			const promises = [
				pool.acquire(1000),
				pool.acquire(1000),
				pool.acquire(1000),
			];

			await new Promise((res) => setTimeout(res, 50));

			pool.release(conns[0]);
			pool.release(conns[1]);
			pool.release(conns[2]);

			const results = await Promise.all(promises);
			expect(results.length).toBe(3);
			expect(results.every((r) => r !== null)).toBe(true);
		});

		it("should not deadlock under stress", async () => {
			const promises = [];
			for (let i = 0; i < 100; i++) {
				promises.push(
					pool
						.acquire(500)
						.then((conn) => {
							setTimeout(() => pool.release(conn), Math.random() * 100);
						})
						.catch(() => {
							/* ignore */
						}),
				);
			}

			await Promise.race([
				Promise.all(promises),
				new Promise((_, rej) =>
					setTimeout(() => rej(new Error("Deadlock timeout")), 5000),
				),
			]);
		});
	});

	// INFO: timeout tests --
	describe("Timeout", () => {
		it("should reject after specified timeout", async () => {
			const conns = [];
			for (let i = 0; i < 5; i++) {
				conns.push(await pool.acquire());
			}

			const start = Date.now();
			try {
				await pool.acquire(500);
			} catch (err) {
				const elapsed = Date.now() - start;
				expect(elapsed).toBeGreaterThanOrEqual(450);
				expect(elapsed).toBeLessThan(1000);
			}
		});

		it("should use config default timeout", async () => {
			const conns = [];
			for (let i = 0; i < 5; i++) {
				conns.push(await pool.acquire());
			}

			const start = Date.now();
			try {
				await pool.acquire(); // Should use defaultConfig.acquireTimeout = 3000
			} catch (err) {
				const elapsed = Date.now() - start;
				expect(elapsed).toBeGreaterThanOrEqual(2900);
			}
		});

		it("should not leak resources on timeout", async () => {
			const conns = [];
			for (let i = 0; i < 5; i++) {
				conns.push(await pool.acquire());
			}

			try {
				await pool.acquire(100);
			} catch (err) {
				// ignore
			}

			const stats = pool.getStats();
			expect(stats.waiting).toBe(0);
		});
	});

	// INFO: health check & validation tests --
	describe("Health Check", () => {
		it("should validate connection with ping()", async () => {
			const conn = await pool.acquire();
			const isHealthy = await conn.ping();
			expect(isHealthy).toBe(true);
		});

		it("should mark unhealthy connections on release", async () => {
			const conn = await pool.acquire();
			conn.mock.ping = async () => false;

			await pool.release(conn);
			expect(conn.state).toBe("destroyed");
		});

		it("should remove stale idle connections", async () => {
			const config = {
				...defaultConfig,
				idleTimeout: 100,
				connectionCheckInterval: 150,
			};
			const pool2 = new ConnectionPool(config);

			const conn = await pool2.acquire();
			await pool2.release(conn);

			await new Promise((res) => setTimeout(res, 300));
			const stats = pool2.getStats();

			expect(stats.total).toBeGreaterThanOrEqual(config.minConnections); // Some should be cleaned up
			await pool2.destroy();
		});

		it("should maintain minConnections after cleanup", async () => {
			const config = {
				...defaultConfig,
				minConnections: 2,
				idleTimeout: 100,
				connectionCheckInterval: 150,
			};
			const pool2 = new ConnectionPool(config);

			await new Promise((res) => setTimeout(res, 300));
			const stats = pool2.getStats();

			expect(stats.idle).toBeGreaterThanOrEqual(2);
			await pool2.destroy();
		});
	});

	// INFO: drain tests --
	describe("Drain", () => {
		it("should set state to draining", async () => {
			await pool.drain();
			const stats = pool.getStats();
			expect(stats.state).toBe("draining");
		});

		it("should reject new acquire requests when draining", async () => {
			await pool.drain();

			let rejected = false;
			try {
				await pool.acquire();
			} catch (err) {
				rejected = true;
			}
			expect(rejected).toBe(true);
		});

		it("should allow in-flight operations to complete", async () => {
			const conns = [];
			for (let i = 0; i < 3; i++) {
				conns.push(await pool.acquire());
			}

			const drainPromise = pool.drain();
			const releasePromise = new Promise((res) => {
				setTimeout(() => {
					conns.forEach((c) => pool.release(c));
					res(null);
				}, 100);
			});

			await Promise.all([drainPromise, releasePromise]);
			const stats = pool.getStats();
			expect(stats.state).toBe("draining");
		});

		it("should allow multiple drain calls", async () => {
			await pool.drain();
			await pool.drain();
			const stats = pool.getStats();
			expect(stats.state).toBe("draining");
		});
	});

	// INFO: destroy tests --
	describe("Destroy", () => {
		it("should set state to destroyed", async () => {
			await pool.destroy();
			const stats = pool.getStats();
			expect(stats.state).toBe("destroyed");
		});

		it("should close all connections immediately", async () => {
			const conns = [];
			for (let i = 0; i < 3; i++) {
				conns.push(await pool.acquire());
			}

			await pool.destroy();
			conns.forEach((c) => expect(c.state).toBe("destroyed"));
		});

		it("should reject new acquire after destroy", async () => {
			await pool.destroy();

			let rejected = false;
			try {
				await pool.acquire();
			} catch (err) {
				rejected = true;
			}
			expect(rejected).toBe(true);
		});

		it("should allow acquire after drain (but before destroy)", async () => {
			const conn1 = await pool.acquire();
			await pool.drain();

			// Can't acquire while draining, but after drain resolves...
			// Actually, per requirements, drain is graceful but new acquires should still reject
			let rejected = false;
			try {
				await pool.acquire();
			} catch (err) {
				rejected = true;
			}
			expect(rejected).toBe(true);
		});
	});

	// INFO: event emission tests --
	describe("Event Emission", () => {
		it("should emit connect event when creating a new connection", async () => {
			let connectEmitted = false;

			pool.on("connect", (data) => {
				connectEmitted = true;

				expect(data.connectionId).toBeDefined();
			});

			// Acquire all minimum pre-allocated connections
			const connections: Connection[] = [];

			for (let i = 0; i < defaultConfig.minConnections; i++) {
				connections.push(await pool.acquire());
			}

			// This should create a new connection
			const newConnection = await pool.acquire();

			expect(newConnection).toBeDefined();
			expect(connectEmitted).toBe(true);

			// Cleanup
			for (const connection of connections) {
				await pool.release(connection);
			}

			await pool.release(newConnection);
		});

		it("should emit release event when connection released", async () => {
			let releaseEmitted = false;
			pool.on("release", (data) => {
				releaseEmitted = true;
			});

			const conn = await pool.acquire();
			await pool.release(conn);
			expect(releaseEmitted).toBe(true);
		});

		it("should emit drain event when pool drains", async () => {
			let drainEmitted = false;
			pool.on("drain", () => {
				drainEmitted = true;
			});

			await pool.drain();
			expect(drainEmitted).toBe(true);
		});
		it("should emit error event on connection failure", async () => {
			let errorEmitted = false;

			const badConfig = {
				...defaultConfig,
				minConnections: 0,
				connectionCreator: () => {
					throw new Error("Connection failed");
				},
			};

			const badPool = new ConnectionPool(badConfig);

			badPool.on("error", (err) => {
				errorEmitted = true;
				expect(err).toBeDefined();
			});

			try {
				await badPool.acquire();
			} catch (err) {
				// Expected failure
			}

			expect(errorEmitted).toBe(true);

			await badPool.destroy();
		});
	});

	// INFO: stats tests --
	describe("getStats", () => {
		it("should return correct stats structure", async () => {
			const stats = pool.getStats();

			expect(stats).toHaveProperty("idle");
			expect(stats).toHaveProperty("inUse");
			expect(stats).toHaveProperty("waiting");
			expect(stats).toHaveProperty("total");
			expect(stats).toHaveProperty("state");
		});

		it("should reflect accurate pool state", async () => {
			const conn1 = await pool.acquire();
			const conn2 = await pool.acquire();

			const stats = pool.getStats();
			expect(stats.idle).toBe(0);
			expect(stats.inUse).toBe(2);
			expect(stats.total).toBe(2);
		});

		it("should count queued requests", async () => {
			const conns = [];
			for (let i = 0; i < 5; i++) {
				conns.push(await pool.acquire());
			}

			const acquirePromise = pool.acquire(5000);
			await new Promise((res) => setTimeout(res, 50));

			const stats = pool.getStats();
			expect(stats.waiting).toBe(1);
		});
	});

	// INFO: edge cases tests --
	describe("Edge Cases", () => {
		// This test is a bit flaky one
		it("should handle rapid acquire/release cycles", async () => {
			for (let i = 0; i < 50; i++) {
				const conn = await pool.acquire();
				await pool.release(conn);
			}

			const stats = pool.getStats();
			expect(stats.inUse).toBe(0);
			expect(stats.waiting).toBe(0);
			expect(stats.total).toBeLessThanOrEqual(defaultConfig.maxConnections);
			expect(stats.idle).toBe(stats.total);
		});

		it("should handle connection creation failure gracefully", async () => {
			const badConfig = {
				...defaultConfig,
				minConnections: 0, // Don't pre-allocate
				connectionCreator: () => {
					throw new Error("DB unavailable");
				},
			};
			const badPool = new ConnectionPool(badConfig);

			let rejected = false;
			try {
				await badPool.acquire(1000);
			} catch (err) {
				rejected = true;
			}
			expect(rejected).toBe(true);

			await badPool.destroy();
		});

		it("should survive drain/acquire cycles", async () => {
			// First cycle
			await pool.drain();
			let stats = pool.getStats();
			expect(stats.state).toBe("draining");

			// New pool for second cycle
			const pool2 = new ConnectionPool(defaultConfig);
			const conn = await pool2.acquire();
			pool2.release(conn);

			stats = pool2.getStats();
			expect(stats.state).toBe("accepting");

			await pool2.destroy();
		});

		it("should not crash on release of same connection twice", async () => {
			const conn = await pool.acquire();

			pool.release(conn);
			// Second release might be no-op or error depending on design
			pool.release(conn);

			const stats = pool.getStats();
			expect(stats.inUse).toBeLessThanOrEqual(1);
		});

		it("should handle minConnections = 0", async () => {
			const config = { ...defaultConfig, minConnections: 0 };
			const pool2 = new ConnectionPool(config);

			await new Promise((res) => setTimeout(res, 100));
			const stats = pool2.getStats();
			expect(stats.idle).toBe(0);

			await pool2.destroy();
		});

		it("should handle minConnections = maxConnections", async () => {
			const config = {
				...defaultConfig,
				minConnections: 5,
				maxConnections: 5,
			};
			const pool2 = new ConnectionPool(config);

			await new Promise((res) => setTimeout(res, 100));
			const stats = pool2.getStats();
			expect(stats.total).toBe(5);
			expect(stats.idle).toBe(5);

			const conns = [];
			for (let i = 0; i < 5; i++) {
				conns.push(await pool2.acquire());
			}
			expect(pool2.getStats().inUse).toBe(5);

			await pool2.destroy();
		});
	});

	// INFO: resource leak tests --
	describe("Resource Cleanup", () => {
		// this is a bit flaky one since my ping is random
		it("should not leak connections on repeated acquire/release", async () => {
			const initialStats = pool.getStats();

			for (let i = 0; i < 100; i++) {
				const conn = await pool.acquire();
				await pool.release(conn);
			}

			const finalStats = pool.getStats();

			expect(finalStats.total).toBe(initialStats.total);
			expect(finalStats.inUse).toBe(0);
			expect(finalStats.waiting).toBe(0);
			expect(finalStats.idle).toBe(finalStats.total);

			expect(finalStats.total).toBeLessThanOrEqual(
				defaultConfig.maxConnections,
			);
		});
		it("should not leak queue items on timeout", async () => {
			const conns = [];
			for (let i = 0; i < 5; i++) {
				conns.push(await pool.acquire());
			}

			const promises = [];
			for (let i = 0; i < 20; i++) {
				promises.push(
					pool.acquire(100).catch(() => {
						/* ignore */
					}),
				);
			}

			await Promise.all(promises);
			const stats = pool.getStats();
			expect(stats.waiting).toBe(0);
		});

		it("should clean up timers on destroy", async () => {
			await pool.destroy();
			const stats = pool.getStats();
			expect(stats.state).toBe("destroyed");
			// If timers not cleaned, process would hang
		});
	});
});
