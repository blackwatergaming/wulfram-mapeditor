'use client';

import { useMemo } from 'react';

import { CATALOG, hasModelForEntity, type AssetManifest, type BaseTemplate } from '@/lib/wulfram';

interface BaseTemplatePreviewProps {
  manifest: AssetManifest;
  scale: number;
  team: number;
  template: BaseTemplate;
  yawDegrees: number;
}

export function BaseTemplatePreview({ manifest, scale, team, template, yawDegrees }: BaseTemplatePreviewProps) {
  const layout = useMemo(() => {
    const yaw = yawDegrees * Math.PI / 180;
    const cosine = Math.cos(yaw);
    const sine = Math.sin(yaw);
    const units = template.units
      .filter((unit) => hasModelForEntity({ token: unit.token, subtype: unit.subtype, team }, manifest))
      .map((unit, index) => {
        const x = (unit.offset[0] * cosine - unit.offset[1] * sine) * scale;
        const y = -(unit.offset[0] * sine + unit.offset[1] * cosine) * scale;
        const item = CATALOG.find((candidate) => candidate.token === unit.token && (unit.token !== 'c' || candidate.subtype === unit.subtype));
        const radius = Math.max(2.5, (item?.footprint ?? 8) * scale * 0.34);
        return { index, unit, item, x, y, radius, yaw: unit.rotation[2] + yaw };
      });
    const extentX = units.flatMap((unit) => [unit.x - unit.radius, unit.x + unit.radius]);
    const extentY = units.flatMap((unit) => [unit.y - unit.radius, unit.y + unit.radius]);
    const minimumX = Math.min(...extentX, -10);
    const maximumX = Math.max(...extentX, 10);
    const minimumY = Math.min(...extentY, -10);
    const maximumY = Math.max(...extentY, 10);
    const padding = Math.max(8, Math.max(maximumX - minimumX, maximumY - minimumY) * 0.08);
    const bounds = {
      x: minimumX - padding,
      y: minimumY - padding,
      width: maximumX - minimumX + padding * 2,
      height: maximumY - minimumY + padding * 2,
    };
    return {
      units,
      skipped: template.units.length - units.length,
      bounds,
      viewBox: `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`,
    };
  }, [manifest, scale, team, template, yawDegrees]);

  return (
    <figure className={`template-preview team-${team}`}>
      <svg aria-label={`Top-down layout of ${template.name}`} preserveAspectRatio="xMidYMid meet" viewBox={layout.viewBox}>
        <defs>
          <pattern height="16" id={`template-grid-${template.id}`} patternUnits="userSpaceOnUse" width="16">
            <path d="M 16 0 L 0 0 0 16" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="0.6" />
          </pattern>
        </defs>
        <rect className="template-preview-grid" fill={`url(#template-grid-${template.id})`} height={layout.bounds.height} width={layout.bounds.width} x={layout.bounds.x} y={layout.bounds.y} />
        <g className="template-preview-units">
          {layout.units.map(({ index, unit, item, x, y, radius, yaw }) => {
            const label = item?.shortLabel ?? unit.token.toUpperCase();
            const isPad = unit.token === 'f' || unit.token === 'r';
            const isCargo = unit.token === 'c';
            return (
              <g className={`template-preview-unit token-${unit.token.charCodeAt(0)}`} key={`${index}-${unit.token}`} transform={`translate(${x} ${y})`}>
                <title>{item?.label ?? unit.token}</title>
                {isPad ? (
                  <rect height={radius * 1.55} rx={radius * 0.18} width={radius * 1.55} x={-radius * 0.775} y={-radius * 0.775} />
                ) : isCargo ? (
                  <rect height={radius * 1.2} transform="rotate(45)" width={radius * 1.2} x={-radius * 0.6} y={-radius * 0.6} />
                ) : (
                  <circle r={radius} />
                )}
                <line x1="0" x2={Math.cos(yaw) * radius * 1.35} y1="0" y2={-Math.sin(yaw) * radius * 1.35} />
                <text dominantBaseline="central" textAnchor="middle">{label}</text>
              </g>
            );
          })}
        </g>
      </svg>
      <figcaption>
        <span>TOP-DOWN · {layout.units.length} MODELED UNITS</span>
        {layout.skipped > 0 && <span>{layout.skipped} REMOVED TYPE{layout.skipped === 1 ? '' : 'S'} OMITTED</span>}
      </figcaption>
    </figure>
  );
}
