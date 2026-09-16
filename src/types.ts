import type { Connection } from "./connection";

export type Config = {
	minConnections: number; // Minimum idle connections to maintain
	maxConnections: number; // Maximum total connections
	acquireTimeout: number; // ms to wait for an available connection
	idleTimeout: number; // ms before an idle connection is destroyed
	connectionCheckInterval: number; // ms between health checks
	connectionCreator: () => ConnectionCreator;
};

export type ConnectionCreator = {
	query: (sql: string) => Promise<unknown>;
	ping: () => Promise<unknown>;
	close: () => Promise<unknown>;
};

export type WaitQueue = {
	id: string;
	res: (connection: Connection) => void;
	rej: (reason?: any) => void;
	timer: NodeJS.Timeout;
};
