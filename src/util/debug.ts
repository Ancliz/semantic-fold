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