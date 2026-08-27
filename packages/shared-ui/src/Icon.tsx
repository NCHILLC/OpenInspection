import React from "react";

const ICON_PATHS: Record<string, string> = {
  dashboard:  '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  calendar:   '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  contacts:   '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
  check:      '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  message:    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  store:      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/>',
  bell:       '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/>',
  search:     '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>',
  arrowR:     '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  chevR:      '<path d="m9 18 6-6-6-6"/>',
  chevL:      '<path d="m15 18-6-6 6-6"/>',
  chevD:      '<path d="M19 9l-7 7-7-7"/>',
  chevU:      '<path d="M5 15l7-7 7 7"/>',
  download:   '<path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>',
  plus:       '<path d="M12 5v14M5 12h14"/>',
  x:          '<path d="M6 18L18 6M6 6l12 12"/>',
  edit:       '<path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>',
  share:      '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>',
  mail:       '<path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>',
  camera:     '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  mic:        '<rect x="9" y="2" width="6" height="11" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v3M8 21h8"/>',
  print:      '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
  back:       '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  moon:       '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun:        '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  filter:     '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>',
  panel:      '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  card:       '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  zap:        '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
  clock:      '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  panelRC:    '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/><polyline points="10 9 7 12 10 15"/>',
  panelRO:    '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/><polyline points="7 9 10 12 7 15"/>',
  wrench:     '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  minusCircle:'<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  alertTriangle: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  tag:        '<path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.24L3 3a2 2 0 0 0-2 2l.24 6.59a2 2 0 0 0 .59 1.42l9.58 9.58a2 2 0 0 0 2.82 0l6.36-6.36a2 2 0 0 0 0-2.82z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  checkMini:  '<path d="M20 6 9 17l-5-5"/>',
  copy:       '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  move:       '<path d="M5 9 2 12l3 3"/><path d="M9 5l3-3 3 3"/><path d="M15 19l-3 3-3-3"/><path d="M19 9l3 3-3 3"/><path d="M2 12h20"/><path d="M12 2v20"/>',
  trash:      '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  flag:       '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="3"/>',
};

export interface IconProps {
  name: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function Icon({ name, size = 16, strokeWidth = 2, className = "" }: IconProps) {
  const path = ICON_PATHS[name];
  if (!path) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      dangerouslySetInnerHTML={{ __html: path }}
    />
  );
}
