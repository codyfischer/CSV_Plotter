import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { DataPoint, CsvMetadata, PlotField, DEFAULT_COLORS } from '../models/data.model';

@Injectable({
  providedIn: 'root'
})
export class CsvService {
  private dataSubject = new BehaviorSubject<DataPoint[]>([]);
  private metadataSubject = new BehaviorSubject<CsvMetadata | null>(null);
  private availableFieldsSubject = new BehaviorSubject<PlotField[]>([]);
  
  public data$ = this.dataSubject.asObservable();
  public metadata$ = this.metadataSubject.asObservable();
  public availableFields$ = this.availableFieldsSubject.asObservable();

  constructor(private http: HttpClient) {
    // No automatic data loading - only through user upload
  }



  public parseFile(file: File): Promise<DataPoint[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const csvText = e.target?.result as string;
          const result = this.parseCsv(csvText);
          this.dataSubject.next(result.data);
          this.metadataSubject.next(result.metadata);
          this.availableFieldsSubject.next(result.fields);
          resolve(result.data);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  private parseCsv(csvText: string): { data: DataPoint[], metadata: CsvMetadata, fields: PlotField[] } {
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    
    // Analyze data to detect field types
    const metadata = this.analyzeHeaders(headers, lines.slice(1));
    
    // Parse data points
    const data = lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim());
      const dataPoint: any = {};
      
      headers.forEach((header, index) => {
        const value = values[index];
        
        if (header === metadata.dateTimeField) {
          dataPoint['datetime'] = new Date(value);
        } else if (header === metadata.latitudeField) {
          const lat = parseFloat(value);
          if (isNaN(lat)) {
            console.log('Invalid latitude value:', value, 'for header:', header);
          }
          dataPoint['latitude'] = lat;
        } else if (header === metadata.longitudeField) {
          const lng = parseFloat(value);
          if (isNaN(lng)) {
            console.log('Invalid longitude value:', value, 'for header:', header);
          }
          dataPoint['longitude'] = lng;
        } else if (metadata.numericFields.includes(header)) {
          // Handle null/empty values in numeric fields
          if (value === '' || value === 'null' || value === 'NULL' || value === 'undefined') {
            dataPoint[header] = null;
          } else {
            const numValue = parseFloat(value);
            dataPoint[header] = isNaN(numValue) ? null : numValue;
          }
        } else {
          dataPoint[header] = value;
        }
      });
      
      return dataPoint as DataPoint;
    });

    // Create available fields for plotting (numeric and categorical fields, excluding lat/lng)
    const numericPlotFields = metadata.numericFields
      .filter(field => field !== metadata.latitudeField && field !== metadata.longitudeField)
      .map((field, index) => ({
        key: field,
        label: this.formatFieldLabel(field),
        selected: index < 2, // Auto-select first 2 numeric fields
        color: DEFAULT_COLORS[index % DEFAULT_COLORS.length],
        dataType: 'number' as const
      }));

    const categoricalPlotFields = metadata.categoricalFields
      .map((field, index) => ({
        key: field,
        label: this.formatFieldLabel(field),
        selected: index < 1, // Auto-select first categorical field
        color: DEFAULT_COLORS[(numericPlotFields.length + index) % DEFAULT_COLORS.length],
        dataType: 'string' as const
      }));

    const fields = [...numericPlotFields, ...categoricalPlotFields];
    
    // Debug: Log the final field classification
    console.log('Final field classification:', {
      numericFields: numericPlotFields.map(f => ({ key: f.key, dataType: f.dataType })),
      categoricalFields: categoricalPlotFields.map(f => ({ key: f.key, dataType: f.dataType })),
      allFields: fields.map(f => ({ key: f.key, dataType: f.dataType }))
    });

    return { data, metadata, fields };
  }

  private analyzeHeaders(headers: string[], dataLines: string[]): CsvMetadata {
    const numericFields: string[] = [];
    const categoricalFields: string[] = [];
    let dateTimeField: string | null = null;
    let latitudeField: string | null = null;
    let longitudeField: string | null = null;

    // Analyze each header
    headers.forEach((header, index) => {
      const lowerHeader = header.toLowerCase();
      
      // Check for datetime field
      if (!dateTimeField && (lowerHeader.includes('date') || lowerHeader.includes('time'))) {
        dateTimeField = header;
        return;
      }
      
      // Check for latitude field
      if (!latitudeField && (lowerHeader.includes('lat') || lowerHeader === 'y')) {
        latitudeField = header;
        return;
      }
      
      // Check for longitude field
      if (!longitudeField && (lowerHeader.includes('lon') || lowerHeader.includes('lng') || lowerHeader === 'x')) {
        longitudeField = header;
        return;
      }
      
      // Check if field is numeric by testing sample values
      if (this.isNumericField(index, dataLines)) {
        numericFields.push(header);
      } else {
        // If not numeric, datetime, lat, or lng, it's categorical
        categoricalFields.push(header);
      }
    });

    console.log('CSV Analysis Results:', {
      headers,
      numericFields,
      categoricalFields,
      dateTimeField,
      latitudeField,
      longitudeField
    });

    return {
      headers,
      numericFields,
      categoricalFields,
      dateTimeField,
      latitudeField,
      longitudeField
    };
  }

  private isNumericField(columnIndex: number, dataLines: string[]): boolean {
    // Check ALL data in the column to determine if it's purely numeric (with possible nulls)
    let hasStringData = false;
    let hasNumericData = false;
    let totalValues = 0;
    
    // Debug: Log the first few values being tested for this column
    const sampleValues = dataLines.slice(0, Math.min(5, dataLines.length)).map(line => {
      const values = line.split(',');
      return values[columnIndex] ? values[columnIndex].trim() : '';
    });
    console.log(`Testing column ${columnIndex} for data types. Sample values:`, sampleValues);
    
    for (const line of dataLines) {
      const values = line.split(',');
      if (values[columnIndex]) {
        const value = values[columnIndex].trim();
        totalValues++;
        
        // Skip empty/null values for type detection
        if (value !== '' && value !== 'null' && value !== 'NULL' && value !== 'undefined') {
          if (!isNaN(parseFloat(value)) && isFinite(parseFloat(value))) {
            hasNumericData = true;
          } else {
            hasStringData = true;
          }
        }
      }
    }
    
    // A field is numeric if:
    // 1. It has numeric data
    // 2. It has NO string data (only numbers and nulls)
    // 3. We have enough data to analyze
    const isNumeric = hasNumericData && !hasStringData && totalValues > 0;
    
    console.log(`Column ${columnIndex}: hasNumericData=${hasNumericData}, hasStringData=${hasStringData}, totalValues=${totalValues}, isNumeric=${isNumeric}`);
    
    return isNumeric;
  }

  private formatFieldLabel(fieldName: string): string {
    return fieldName
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\b\w/g, l => l.toUpperCase());
  }

  public getCurrentData(): DataPoint[] {
    return this.dataSubject.value;
  }
}
