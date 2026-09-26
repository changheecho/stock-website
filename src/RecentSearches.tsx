import { Clock3, X } from 'lucide-react'

type Props = {
  searches: string[]
  onClear: () => void
  onRemove: (search: string) => void
  onSelect: (search: string) => void
}

export default function RecentSearches({ searches, onClear, onRemove, onSelect }: Props) {
  if (searches.length === 0) return null

  return <section className="recent-searches" aria-labelledby="recent-searches-title">
    <div className="recent-searches-heading">
      <h2 id="recent-searches-title"><Clock3 size={15} />최근 검색어</h2>
      <button type="button" onClick={onClear}>전체 삭제</button>
    </div>
    <ul>{searches.map((search) => <li key={search}>
      <button type="button" className="recent-search-select" onClick={() => onSelect(search)}>{search}</button>
      <button type="button" className="recent-search-remove" onClick={() => onRemove(search)} aria-label={`${search} 삭제`}><X size={13} /></button>
    </li>)}</ul>
  </section>
}
