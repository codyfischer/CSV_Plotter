export interface DataPoint {
  datetime: Date;
  latitude: number;
  longitude: number;
  [key: string]: any; // Allow dynamic fields
}

export interface PlotField {
  key: string;
  label: string;
  selected: boolean;
  color: string;
  dataType: 'number' | 'string' | 'date';
}

export interface TimeRange {
  start: Date;
  end: Date;
}

export interface HoverEvent {
  dataPoint: DataPoint;
  x: number;
  y: number;
}

export interface ZoomEvent {
  timeRange: TimeRange;
}

export interface CsvMetadata {
  headers: string[];
  numericFields: string[];
  categoricalFields: string[];
  dateTimeField: string | null;
  latitudeField: string | null;
  longitudeField: string | null;
}

// Default color palette for charts
export const DEFAULT_COLORS = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
  '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5'
];

// Color palette for categorical states
export const STATE_COLORS = [
  '#4CAF50', // Green
  '#F44336', // Red  
  '#FF9800', // Orange
  '#2196F3', // Blue
  '#9C27B0', // Purple
  '#795548', // Brown
  '#607D8B', // Blue Grey
  '#E91E63', // Pink
  '#00BCD4', // Cyan
  '#8BC34A'  // Light Green
];
