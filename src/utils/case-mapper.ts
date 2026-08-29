function snakeToCamelKey(key: string): string {
	return key.replace(/_([a-z0-9])/g, (_match: string, char: string) => char.toUpperCase());
}

function camelToSnakeKey(key: string): string {
	return key.replace(/[A-Z]/g, (char: string) => `_${char.toLowerCase()}`);
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

// Not recursive by design: callers pass a flat map of column names to
// values (e.g. for INSERT/UPDATE) where values are scalars or JSON-ready
// data, never nested objects needing their own key conversion.
export function camelToSnake(data: Record<string, unknown>): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(data)) {
		result[camelToSnakeKey(key)] = value;
	}

	return result;
}
