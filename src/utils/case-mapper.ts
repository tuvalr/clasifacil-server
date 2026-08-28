function snakeToCamelKey(key: string): string {
	return key.replace(/_([a-z0-9])/g, (_match: string, char: string) => char.toUpperCase());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

export function snakeToCamel<T>(row: Record<string, unknown>): T {
	const result: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(row)) {
		const camelKey = snakeToCamelKey(key);
		result[camelKey] = isPlainObject(value) ? snakeToCamel(value) : value;
	}

	return result as T;
}
