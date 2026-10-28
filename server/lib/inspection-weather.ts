// The single list shared by the column, the Zod schema and the editor.
export const INSPECTION_WEATHER = ['clear', 'cloudy', 'rain', 'snow'] as const;
export type InspectionWeather = (typeof INSPECTION_WEATHER)[number];
