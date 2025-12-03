import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { DataPoint, PlotField, DEFAULT_COLORS } from './models/data.model';
import { CsvService } from './services/csv.service';
import { SyncService } from './services/sync.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'CSV Data Plotter';
  data: DataPoint[] = [];
  availableFields: PlotField[] = [];
  selectedFields: PlotField[] = [];
  
  private destroy$ = new Subject<void>();

  constructor(
    private csvService: CsvService,
    private syncService: SyncService
  ) {}

  ngOnInit(): void {
    this.csvService.data$
      .pipe(takeUntil(this.destroy$))
      .subscribe(data => {
        console.log('App component received data:', data.length, 'data points');
        this.data = data;
        
        // Set data bounds for zoom constraints
        if (data.length > 0) {
          const timeExtent = data.map(d => d.datetime);
          const minTime = new Date(Math.min(...timeExtent.map(d => d.getTime())));
          const maxTime = new Date(Math.max(...timeExtent.map(d => d.getTime())));
          
          this.syncService.setDataBounds({
            start: minTime,
            end: maxTime
          });
        }
      });

    this.csvService.availableFields$
      .pipe(takeUntil(this.destroy$))
      .subscribe(fields => {
        console.log('Available fields updated:', fields);
        this.availableFields = fields;
        // Auto-select first few fields when new data is loaded
        this.selectedFields = fields.filter(f => f.selected);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onFieldSelected(field: PlotField): void {
    // Create a copy with a unique color
    const selectedField = {
      ...field,
      selected: true,
      color: DEFAULT_COLORS[this.selectedFields.length % DEFAULT_COLORS.length]
    };
    this.selectedFields = [...this.selectedFields, selectedField];
    console.log('Field selected:', selectedField.key);
  }

  onFieldRemoved(field: PlotField): void {
    this.selectedFields = this.selectedFields.filter(f => f.key !== field.key);
    console.log('Field removed:', field.key);
  }

  onFileUpload(file: File): void {
    this.csvService.parseFile(file)
      .then(data => {
        console.log('File uploaded successfully:', data.length, 'data points');
      })
      .catch(error => {
        console.error('Error parsing file:', error);
      });
  }

  onClearZoom(): void {
    this.syncService.clearZoom();
  }
}