import { Component, Input, Output, EventEmitter } from '@angular/core';
import { PlotField } from '../../models/data.model';
import { SyncService } from '../../services/sync.service';

@Component({
  selector: 'app-field-selector',
  templateUrl: './field-selector.component.html',
  styleUrls: ['./field-selector.component.scss']
})
export class FieldSelectorComponent {
  @Input() availableFields: PlotField[] = [];
  @Input() selectedFields: PlotField[] = [];
  @Output() fieldSelected = new EventEmitter<PlotField>();
  @Output() fieldRemoved = new EventEmitter<PlotField>();
  @Output() fileUpload = new EventEmitter<File>();
  @Output() clearZoom = new EventEmitter<void>();

  selectedFieldKey: string = '';
  hasZoom: boolean = false;

  constructor(private syncService: SyncService) {
    // Track if there's an active zoom
    this.syncService.zoom$.subscribe(timeRange => {
      this.hasZoom = timeRange !== null;
    });
  }

  get unselectedFields(): PlotField[] {
    const selectedKeys = this.selectedFields.map(f => f.key);
    return this.availableFields.filter(field => !selectedKeys.includes(field.key));
  }

  onFieldSelectionChange(): void {
    if (this.selectedFieldKey) {
      const field = this.availableFields.find(f => f.key === this.selectedFieldKey);
      if (field) {
        this.fieldSelected.emit(field);
        this.selectedFieldKey = '';
      }
    }
  }

  onFieldRemove(field: PlotField): void {
    this.fieldRemoved.emit(field);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      this.fileUpload.emit(file);
      // Reset file input
      input.value = '';
    }
  }

  onZoomOut(): void {
    const currentZoom = this.syncService.getCurrentZoom();
    if (currentZoom) {
      // Expand the current time range by 50% on each side
      const currentSpan = currentZoom.end.getTime() - currentZoom.start.getTime();
      const expansion = currentSpan * 0.5;
      
      const newStart = new Date(currentZoom.start.getTime() - expansion);
      const newEnd = new Date(currentZoom.end.getTime() + expansion);
      
      this.syncService.emitZoom({
        start: newStart,
        end: newEnd
      });
    }
  }

  onClearZoom(): void {
    this.clearZoom.emit();
  }
}