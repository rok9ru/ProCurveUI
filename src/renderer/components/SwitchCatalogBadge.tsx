import React from 'react';
import type { SwitchCatalogEntry } from '@types/ipc';

interface Props {
  catalog: SwitchCatalogEntry;
}

// Known-hardware catalog badge — render only when a catalog entry exists;
// an unmatched model just means nobody's tested it yet, not an error, so
// callers should skip rendering this entirely rather than show an "unknown
// model" banner.
export default function SwitchCatalogBadge({ catalog }: Props) {
  return (
    <div style={{ marginBottom: 32, border: '1px solid rgba(255,255,255,0.1)', padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: catalog.notes ? 10 : 0, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: '13px', color: '#ffffff' }}>{catalog.family}</span>
        <span style={{
          padding: '2px 8px', fontSize: '10px', fontFamily: 'Geist Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.6px',
          color: catalog.webUi === 'modern' ? '#6ee7b7' : catalog.webUi === 'java-applet' ? '#fbbf24' : 'rgba(255,255,255,0.5)',
          border: `1px solid ${catalog.webUi === 'modern' ? 'rgba(16,185,129,0.3)' : catalog.webUi === 'java-applet' ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.2)'}`,
        }}>
          {catalog.webUi === 'modern' ? 'Web UI: modern' : catalog.webUi === 'java-applet' ? 'Web UI: requires Java' : 'Web UI: unknown'}
        </span>
        <span style={{
          padding: '2px 8px', fontSize: '10px', fontFamily: 'Geist Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.6px',
          color: catalog.tested ? '#6ee7b7' : 'rgba(255,255,255,0.5)',
          border: `1px solid ${catalog.tested ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.2)'}`,
        }}>
          {catalog.tested ? '✓ Tested' : 'Untested'}
        </span>
      </div>
      {catalog.notes && (
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px', lineHeight: 1.5 }}>{catalog.notes}</div>
      )}
    </div>
  );
}
