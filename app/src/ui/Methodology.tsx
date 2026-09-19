/**
 * Methodology panel (PRD F18) - reachable from every view.
 *
 * Renders constants.json (F19) directly, so what is on screen is by definition
 * what the model ran on. Every entry shows its value and either its source or
 * the label "assumption"; values the team has not confirmed show "placeholder".
 */
import { useMemo, useState } from 'react'
import { allEntries, type Status } from '../model/constants'

const STATUS_STYLE: Record<Status, { label: string; cls: string }> = {
  source: { label: 'sourced', cls: 'tag tag-source' },
  assumption: { label: 'assumption', cls: 'tag tag-assumption' },
  placeholder: { label: 'placeholder', cls: 'tag tag-placeholder' },
}

const GROUP_TITLES: Record<string, string> = {
  grid: 'Grid',
  fuel: 'Fuel (§9.1)',
  conditions: 'Fire weather and moisture (§9.2)',
  consequence: 'Consequence of loss (§9.3)',
  allocation: 'Budget allocation (§9.4)',
  scenarios: 'Season scenarios (§9.5)',
  workforce: 'Workforce',
  data_sources: 'Data sources, licences and substitutions',
}

function render(v: unknown): string {
  if (v === null) return 'none (uncapped)'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function Methodology({ onClose }: { onClose: () => void }) {
  const [filter, setFilter] = useState<'all' | Status>('all')
  const entries = useMemo(() => allEntries(), [])

  const counts = useMemo(() => {
    const c: Record<string, number> = { source: 0, assumption: 0, placeholder: 0 }
    for (const { e } of entries) c[e.status] = (c[e.status] ?? 0) + 1
    return c
  }, [entries])

  const groups = useMemo(() => {
    const g = new Map<string, typeof entries>()
    for (const item of entries) {
      if (filter !== 'all' && item.e.status !== filter) continue
      const top = item.path.split('.')[0]
      if (!g.has(top)) g.set(top, [])
      g.get(top)!.push(item)
    }
    return g
  }, [entries, filter])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2>Methodology</h2>
            <p className="muted">
              Every constant the model uses, read straight from{' '}
              <code>constants.json</code> — the same file the data pipeline runs on.
            </p>
          </div>
          <button className="btn-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="filter-row">
          {(['all', 'source', 'assumption', 'placeholder'] as const).map((f) => (
            <button
              key={f}
              className={`chip ${filter === f ? 'chip-on' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all'
                ? `All ${entries.length}`
                : `${STATUS_STYLE[f].label} ${counts[f] ?? 0}`}
            </button>
          ))}
        </div>

        <p className="callout">
          <strong>Placeholder</strong> means the team has not confirmed the figure.
          Effectiveness ranges, capacity caps, the asset-class cap, the moisture
          scale and the workforce rate are all illustrative and must not be cited.
        </p>

        <div className="modal-body">
          {[...groups.entries()].map(([top, items]) => (
            <section key={top}>
              <h3>{GROUP_TITLES[top] ?? top}</h3>
              <table className="const-table">
                <tbody>
                  {items.map(({ path, e }) => (
                    <tr key={path}>
                      <td className="c-path">
                        <div className="c-label">{e.label ?? path.split('.').pop()}</div>
                        <code>{path}</code>
                      </td>
                      <td className="c-value">
                        <span className="val">{render(e.value)}</span>
                        {e.unit ? <span className="unit"> {e.unit}</span> : null}
                      </td>
                      <td className="c-status">
                        <span className={STATUS_STYLE[e.status].cls}>
                          {STATUS_STYLE[e.status].label}
                        </span>
                      </td>
                      <td className="c-source">{e.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
