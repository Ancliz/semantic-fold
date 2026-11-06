const loggedDebugKeys = new Set<string>();

/**
 * Emits a debug line once for a stable event key during the extension session
 */
export function debugOnce(key: string, message: string): void {
	if(loggedDebugKeys.has(key)) {
		return;
	}

	loggedDebugKeys.add(key);
	console.debug(message);
}

/**
 * Message text for an unknown caught value, for use in debug lines
 */
export function formatError(error: unknown): string {
	if(error instanceof Error) {
		return error.message;
	}

	return String(error);
}
