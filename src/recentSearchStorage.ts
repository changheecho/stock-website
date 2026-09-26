export const RECENT_SEARCHES_KEY = 'stock-website:recent-searches'
export const MAX_RECENT_SEARCHES = 10

export function parseRecentSearches(value: string | null): string[] {
  if (!value) return []

  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
      .filter((item, index, items) => items.indexOf(item) === index)
      .slice(0, MAX_RECENT_SEARCHES)
  } catch {
    return []
  }
}

export function addRecentSearch(searches: string[], search: string): string[] {
  const normalized = search.trim()
  if (!normalized) return searches

  return [normalized, ...searches.filter((item) => item !== normalized)].slice(0, MAX_RECENT_SEARCHES)
}
